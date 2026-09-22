begin;
create table public.sales_stock_config (
 id boolean primary key default true check(id),
 activated_at timestamptz not null default now(),
 worker_token text not null default (gen_random_uuid()::text||gen_random_uuid()::text)
);
insert into public.sales_stock_config(id) values(true);
create table public.sales_stock_jobs (
 account_id uuid not null references public.meli_accounts(id), order_id text not null check(order_id ~ '^[1-9][0-9]{0,31}$'),
 revision bigint not null default 1, status text not null default 'pending' check(status in ('pending','running','done')),
 lease uuid, lease_until timestamptz, next_attempt timestamptz not null default now(),
 processed boolean not null default false, error text, warning text,
 updated_at timestamptz not null default now(), primary key(account_id,order_id)
);
create index on public.sales_stock_jobs(next_attempt) where status<>'done';
create table public.sales_stock_debits (
 account_id uuid not null, order_id text not null, variant_id uuid not null references public.supplier_variants(id),
 units bigint not null check(units>0), deducted bigint not null check(deducted>=0), created_at timestamptz not null default now(),
 primary key(account_id,order_id,variant_id), foreign key(account_id,order_id) references public.sales_stock_jobs(account_id,order_id)
);
do $$ declare t text; begin
 foreach t in array array['sales_stock_config','sales_stock_jobs','sales_stock_debits'] loop
 execute format('alter table public.%I enable row level security',t);
 execute format('revoke all on public.%I from public,anon,authenticated',t);
 execute format('grant all on public.%I to service_role',t);
 end loop;
end $$;
create function public.authorize_stock_worker(p_token text) returns boolean language sql security invoker set search_path=public as $$
 select exists(select 1 from sales_stock_config where worker_token=p_token and length(p_token)>60);
$$;
create function public.enqueue_sale_stock(p_seller text,p_order text) returns boolean
language plpgsql security invoker set search_path=public as $$
declare a uuid;
begin
 select id into a from meli_accounts where seller_id=p_seller;
 if a is null then return false; end if;
 insert into sales_stock_jobs(account_id,order_id) values(a,p_order)
 on conflict(account_id,order_id) do update set revision=sales_stock_jobs.revision+1,status='pending',next_attempt=now(),updated_at=now();
 return true;
end $$;
create function public.claim_sale_stock() returns jsonb
language plpgsql security invoker set search_path=public as $$
declare j sales_stock_jobs%rowtype;
begin
 select * into j from sales_stock_jobs where status<>'done' and next_attempt<=now() and (lease_until is null or lease_until<now())
 order by next_attempt,account_id,order_id for update skip locked limit 1;
 if not found then return null; end if;
 update sales_stock_jobs set status='running',lease=gen_random_uuid(),lease_until=now()+interval '5 minutes'
 where account_id=j.account_id and order_id=j.order_id returning * into j;
 return (select jsonb_build_object('accountId',j.account_id,'orderId',j.order_id,'lease',j.lease,'revision',j.revision,'ownerId',a.owner_id,'sellerId',a.seller_id)
 from meli_accounts a where a.id=j.account_id);
end $$;
create function public.fail_sale_stock(p_account uuid,p_order text,p_lease uuid,p_error text) returns void
language sql security invoker set search_path=public as $$
 update sales_stock_jobs set status='pending',error=left(p_error,500),lease=null,lease_until=null,next_attempt=now()+interval '1 minute',updated_at=now()
 where account_id=p_account and order_id=p_order and lease=p_lease;
$$;
-- Only server-verified orders enter this function. Browser roles cannot call it.
create function public.apply_sale_stock(p_account uuid,p_order text,p_lease uuid,p_revision bigint,p_sale jsonb) returns void
language plpgsql security invoker set search_path=public as $$
declare j sales_stock_jobs%rowtype; a meli_accounts%rowtype; line jsonb; m record; inv supplier_inventory%rowtype;
 totals jsonb:='{}'; variant text; n bigint; actual bigint; issue text:=''; closed timestamptz;
begin
 select * into j from sales_stock_jobs where account_id=p_account and order_id=p_order for update;
 if not found or p_lease is null or j.lease is distinct from p_lease then return; end if;
 select * into strict a from meli_accounts where id=p_account;
 if p_sale->>'id' is distinct from p_order or p_sale->>'sellerId' is distinct from a.seller_id then raise exception 'Orden ajena.'; end if;
 if j.processed then
  issue:=coalesce(j.warning,'');
  if p_sale->>'status'='cancelled' and exists(select 1 from sales_stock_debits where account_id=p_account and order_id=p_order) then
   issue:='Venta cancelada después del descuento: revisar devolución de stock manualmente.';
  end if;
 elsif p_sale->>'status'='paid' then
  closed:=(p_sale->>'confirmedAt')::timestamptz;
  if closed is null then raise exception 'Venta sin fecha de confirmación.'; end if;
  if closed>now()+interval '5 minutes' then raise exception 'Fecha de venta inválida.'; end if;
  if closed >= (select activated_at from sales_stock_config) then
   if jsonb_typeof(p_sale->'lines') is distinct from 'array' or jsonb_array_length(p_sale->'lines')=0 then raise exception 'Venta sin líneas.'; end if;
   for line in select value from jsonb_array_elements(p_sale->'lines') loop
    n:=(line->>'quantity')::bigint;
    if n is null or n not between 1 and 1000000000 then raise exception 'Cantidad inválida.'; end if;
    select lm.variant_id,lm.units_per_sale into m from listing_mappings lm
     join supplier_variants v on v.id=lm.variant_id join supplier_products p on p.id=v.product_id
     where lm.account_id=p_account and lm.item_id=line->>'itemId' and lm.variation_id=line->>'variationId'
     and (exists(select 1 from app_profiles where id=a.owner_id and role='ADMIN') or
      exists(select 1 from supplier_sellers where supplier_id=p.supplier_id and seller_user_id=a.owner_id and active));
    if not found then issue:=issue||'Sin asociación activa: '||(line->>'itemId')||'. '; continue; end if;
    variant:=m.variant_id::text;
    totals:=jsonb_set(totals,array[variant],to_jsonb(coalesce((totals->>variant)::bigint,0)+n*m.units_per_sale));
   end loop;
   -- Stable locking order prevents two sellers from consuming the same units concurrently.
   for variant in select key from jsonb_each(totals) order by key loop
    select * into strict inv from supplier_inventory where variant_id=variant::uuid for update;
    n:=(totals->>variant)::bigint; actual:=least(inv.stock,n);
    insert into sales_stock_debits(account_id,order_id,variant_id,units,deducted) values(p_account,p_order,variant::uuid,n,actual);
    update supplier_inventory set stock=stock-actual,version=version+1 where variant_id=variant::uuid;
    insert into inventory_movements(variant_id,type,quantity_delta,stock_before,stock_after,source,external_reference,note,actor_id,request_id)
     values(variant::uuid,'SALE',-actual,inv.stock,inv.stock-actual,'mercadolibre',p_order,'Venta confirmada',a.owner_id,gen_random_uuid());
    if actual<n then issue:=issue||'Stock insuficiente: faltaron '||(n-actual)::text||' unidades. '; end if;
    -- Enqueue even when the product was already at zero.
    for m in select distinct account_id,item_id from listing_mappings where variant_id=variant::uuid order by account_id,item_id loop
     perform enqueue_listing_stock(m.account_id,m.item_id);
    end loop;
   end loop;
  end if;
  update sales_stock_jobs set processed=true where account_id=p_account and order_id=p_order;
 end if;
 update sales_stock_jobs set status=case when revision<>p_revision then 'pending' else 'done' end,
 error=null,warning=nullif(issue,''),lease=null,lease_until=null,next_attempt=now(),updated_at=now()
 where account_id=p_account and order_id=p_order;
end $$;
-- Null actor is used ONLY by the server worker. All functions remain service-only.
create or replace function public.visible_stock_job(p_actor uuid,p_account uuid,p_item text) returns boolean
language sql stable security invoker set search_path=public as $$
 select p_actor is null or exists(select 1 from app_profiles p join meli_accounts a on a.id=p_account where p.id=p_actor and
 (p.role='ADMIN' or (p.role='USER' and a.owner_id=p_actor) or (p.role='SUPPLIER' and exists(
 select 1 from listing_mappings m join supplier_variants v on v.id=m.variant_id join supplier_products s on s.id=v.product_id
 where m.account_id=p_account and m.item_id=p_item and s.supplier_id=p_actor))));
$$;
create function public.sale_stock_status(p_actor uuid) returns jsonb
language sql stable security invoker set search_path=public as $$
 select coalesce(jsonb_agg(t),'[]') from (
 select j.order_id,j.status,j.error,j.warning,j.updated_at from sales_stock_jobs j join meli_accounts a on a.id=j.account_id
 join app_profiles p on p.id=p_actor
 where (p.role='ADMIN' or a.owner_id=p_actor or exists(select 1 from sales_stock_debits d join supplier_variants v on v.id=d.variant_id
 join supplier_products sp on sp.id=v.product_id where d.account_id=j.account_id and d.order_id=j.order_id and sp.supplier_id=p_actor))
 and (j.error is not null or j.warning is not null or j.status<>'done') order by j.updated_at desc limit 100) t;
$$;
-- Interactive retries are immediate. The background worker retries failed PUTs
-- after five minutes, preventing a network error from stranding shared stock.
create or replace function public.claim_stock_sync(p_actor uuid,p_retry boolean default false) returns jsonb
language plpgsql security invoker set search_path=public as $$
declare j listing_stock_jobs%rowtype; result jsonb;
begin
 select * into j from listing_stock_jobs q where
 (q.status in ('pending','running') or (q.status='error' and
   (p_retry or (p_actor is null and q.updated_at<now()-interval '5 minutes'))))
 and (q.lease_until is null or q.lease_until<now()) and visible_stock_job(p_actor,q.account_id,q.item_id)
 order by q.updated_at,q.account_id,q.item_id for update skip locked limit 1;
 if not found then return null; end if;
 update listing_stock_jobs set status='running',lease=gen_random_uuid(),lease_until=now()+interval '5 minutes',error=null
 where account_id=j.account_id and item_id=j.item_id returning * into j;
 select jsonb_build_object('accountId',j.account_id,'itemId',j.item_id,'revision',j.revision,'lease',j.lease,
 'ownerId',a.owner_id,'sellerId',a.seller_id,'targets',coalesce((select jsonb_agg(jsonb_build_object('variationId',m.variation_id,'stock',i.stock))
 from listing_mappings m join supplier_inventory i on i.variant_id=m.variant_id
 where m.account_id=j.account_id and m.item_id=j.item_id),'[]')) into result
 from meli_accounts a where a.id=j.account_id;
 return result;
end $$;
do $$ declare f record; begin
 for f in select oid::regprocedure signature from pg_proc where pronamespace='public'::regnamespace and proname in
 ('authorize_stock_worker','enqueue_sale_stock','claim_sale_stock','fail_sale_stock','apply_sale_stock','sale_stock_status') loop
 execute format('revoke all on function %s from public,anon,authenticated',f.signature);
 execute format('grant execute on function %s to service_role',f.signature);
 end loop;
end $$;
commit;
