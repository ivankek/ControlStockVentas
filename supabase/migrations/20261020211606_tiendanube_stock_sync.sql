begin;
create table public.tiendanube_stock_jobs (
 account_id uuid not null references public.tiendanube_accounts(id) on delete cascade,
 listing_key text not null check(listing_key ~ '^[0-9]+:[0-9]+$'),
 revision bigint not null default 1,
 status text not null default 'pending' check(status in ('pending','running','done','error')),
 lease uuid, lease_until timestamptz, error text, confirmed_stock bigint,
 updated_at timestamptz not null default now(), primary key(account_id,listing_key)
);
alter table public.tiendanube_stock_jobs enable row level security;
revoke all on public.tiendanube_stock_jobs from public,anon,authenticated;
grant all on public.tiendanube_stock_jobs to service_role;

create function public.enqueue_nube_stock(p_account uuid,p_key text) returns void
language sql security invoker set search_path=public as $$
 insert into tiendanube_stock_jobs(account_id,listing_key) values(p_account,p_key)
 on conflict(account_id,listing_key) do update set revision=tiendanube_stock_jobs.revision+1,
 status='pending',error=null,updated_at=now();
$$;
create function public.nube_catalog_enqueue() returns trigger
language plpgsql security invoker set search_path=public as $$
declare k text;
begin
 for k in select key from jsonb_each_text(new.links) order by key loop
  perform enqueue_nube_stock(new.id,k);
 end loop;
 return new;
end $$;
create trigger nube_catalog_enqueue after update of links on public.tiendanube_accounts
for each row execute function public.nube_catalog_enqueue();
create function public.nube_inventory_enqueue() returns trigger
language plpgsql security invoker set search_path=public as $$
declare m record;
begin
 if new.stock is distinct from old.stock then
  for m in select a.id,l.key from tiendanube_accounts a cross join lateral jsonb_each_text(a.links) l
   where l.value=new.variant_id::text order by a.id,l.key loop
   perform enqueue_nube_stock(m.id,m.key);
  end loop;
 end if;
 return new;
end $$;
create trigger nube_inventory_enqueue after update of stock on public.supplier_inventory
for each row execute function public.nube_inventory_enqueue();

create function public.claim_nube_stock(p_actor uuid) returns jsonb
language plpgsql security invoker set search_path=public as $$
declare j tiendanube_stock_jobs%rowtype; result jsonb;
begin
 select q.* into j from tiendanube_stock_jobs q join tiendanube_accounts a on a.id=q.account_id
 where (q.status in ('pending','running') or (q.status='error' and q.updated_at<now()-interval '5 minutes'))
 and (q.lease_until is null or q.lease_until<now())
 and (p_actor is null or a.owner_id=p_actor or exists(select 1 from app_profiles where id=p_actor and role='ADMIN')
 or exists(select 1 from supplier_variants v join supplier_products p on p.id=v.product_id
 where v.id::text=a.links->>q.listing_key and p.supplier_id=p_actor))
 order by q.updated_at,q.account_id,q.listing_key for update of q skip locked limit 1;
 if not found then return null; end if;
 update tiendanube_stock_jobs set status='running',lease=gen_random_uuid(),lease_until=now()+interval '3 minutes',error=null
 where account_id=j.account_id and listing_key=j.listing_key returning * into j;
 select jsonb_build_object('accountId',a.id,'storeId',a.store_id,'encryptedToken',a.encrypted_token,
 'key',j.listing_key,'revision',j.revision,'lease',j.lease,'stock',i.stock,
 'allowed',exists(select 1 from app_profiles ap where ap.id=a.owner_id and (ap.role='ADMIN' or
 (ap.role='USER' and exists(select 1 from supplier_sellers ss where ss.seller_user_id=a.owner_id and ss.supplier_id=p.supplier_id and ss.active)))))
 into result from tiendanube_accounts a
 left join supplier_variants v on v.id::text=a.links->>j.listing_key
 left join supplier_products p on p.id=v.product_id
 left join supplier_inventory i on i.variant_id=v.id where a.id=j.account_id;
 return result;
end $$;

create function public.finish_nube_stock(p_account uuid,p_key text,p_lease uuid,p_revision bigint,p_error text,p_stock bigint) returns void
language plpgsql security invoker set search_path=public as $$
declare j tiendanube_stock_jobs%rowtype;
begin
 -- Same locking order as a catalog save: account, then queue row.
 perform 1 from tiendanube_accounts where id=p_account for update;
 select * into j from tiendanube_stock_jobs where account_id=p_account and listing_key=p_key for update;
 if not found or j.lease is distinct from p_lease then return; end if;
 if p_error is null and j.revision=p_revision then
  if p_stock is null or p_stock<0 then raise exception 'Stock inválido.'; end if;
  update tiendanube_accounts a set products=(select coalesce(jsonb_agg(case when p->>'id'=split_part(p_key,':',1)
   then jsonb_set(p,'{variants}',(select coalesce(jsonb_agg(case when v->>'id'=split_part(p_key,':',2)
     then jsonb_set(v,'{stock}',to_jsonb(p_stock)) else v end),'[]') from jsonb_array_elements(p->'variants') v)) else p end),'[]')
   from jsonb_array_elements(a.products) p),version=version+1 where id=p_account;
 end if;
 update tiendanube_stock_jobs set status=case when revision<>p_revision then 'pending' when p_error is null then 'done' else 'error' end,
 error=case when revision=p_revision then p_error else null end,
 confirmed_stock=case when p_error is null then p_stock else confirmed_stock end,
 lease=null,lease_until=null,updated_at=now() where account_id=p_account and listing_key=p_key;
end $$;

do $$ declare f record; begin
 for f in select oid::regprocedure signature from pg_proc where pronamespace='public'::regnamespace
 and proname in ('enqueue_nube_stock','nube_catalog_enqueue','nube_inventory_enqueue','claim_nube_stock','finish_nube_stock') loop
 execute format('revoke all on function %s from public,anon,authenticated',f.signature);
 execute format('grant execute on function %s to service_role',f.signature);
 end loop;
end $$;
-- Existing associations also need their initial stock sent after deployment.
insert into tiendanube_stock_jobs(account_id,listing_key)
select a.id,l.key from tiendanube_accounts a cross join lateral jsonb_each_text(a.links) l;
commit;
