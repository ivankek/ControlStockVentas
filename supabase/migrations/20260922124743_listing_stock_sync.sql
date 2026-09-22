-- Additive: durable stock updates, without resetting products or associations.
begin;
create table public.listing_stock_jobs (
 account_id uuid not null, item_id text not null,
 revision bigint not null default 1, status text not null default 'pending' check(status in ('pending','running','done','error')),
 lease uuid, lease_until timestamptz, error text, updated_at timestamptz not null default now(),
 primary key(account_id,item_id), foreign key(account_id,item_id) references public.meli_listings(account_id,item_id)
);
alter table public.listing_stock_jobs enable row level security;
revoke all on public.listing_stock_jobs from public,anon,authenticated;
grant all on public.listing_stock_jobs to service_role;

create function public.enqueue_listing_stock(p_account uuid,p_item text) returns void
language sql security invoker set search_path=public as $$
 insert into listing_stock_jobs(account_id,item_id) values(p_account,p_item)
 on conflict(account_id,item_id) do update set revision=listing_stock_jobs.revision+1,
 status='pending',error=null,updated_at=now();
 -- Preserve an existing lease: a new revision must wait for an in-flight PUT.
$$;
create function public.stock_changed_enqueue() returns trigger
language plpgsql security invoker set search_path=public as $$
declare m record;
begin
 if new.stock is distinct from old.stock then
  for m in select distinct account_id,item_id from listing_mappings where variant_id=new.variant_id order by account_id,item_id loop
   perform enqueue_listing_stock(m.account_id,m.item_id);
  end loop;
 end if;
 return new;
end $$;
create trigger stock_changed_enqueue after update of stock on public.supplier_inventory
for each row execute function public.stock_changed_enqueue();
create function public.mapping_changed_enqueue() returns trigger
language plpgsql security invoker set search_path=public as $$
begin
 if tg_op='DELETE' then
  perform enqueue_listing_stock(old.account_id,old.item_id); return old;
 end if;
 perform enqueue_listing_stock(new.account_id,new.item_id); return new;
end $$;
create trigger mapping_changed_enqueue after insert or update or delete on public.listing_mappings
for each row execute function public.mapping_changed_enqueue();

create function public.visible_stock_job(p_actor uuid,p_account uuid,p_item text) returns boolean
language sql stable security invoker set search_path=public as $$
 select exists(select 1 from app_profiles p join meli_accounts a on a.id=p_account where p.id=p_actor and
 (p.role='ADMIN' or (p.role='USER' and a.owner_id=p_actor) or (p.role='SUPPLIER' and exists(
 select 1 from listing_mappings m join supplier_variants v on v.id=m.variant_id join supplier_products s on s.id=v.product_id
 where m.account_id=p_account and m.item_id=p_item and s.supplier_id=p_actor))));
$$;
create function public.stock_sync_status(p_actor uuid) returns jsonb
language sql stable security invoker set search_path=public as $$
 select coalesce(jsonb_agg(t),'[]') from (
 select j.account_id,j.item_id,j.status,j.error,j.updated_at,l.payload->>'title' title
 from listing_stock_jobs j join meli_listings l using(account_id,item_id)
 where visible_stock_job(p_actor,j.account_id,j.item_id)
 order by (j.status='done'),j.updated_at desc limit 200) t;
$$;
create function public.claim_stock_sync(p_actor uuid,p_retry boolean default false) returns jsonb
language plpgsql security invoker set search_path=public as $$
declare j listing_stock_jobs%rowtype; result jsonb;
begin
 select * into j from listing_stock_jobs q where
 (q.status in ('pending','running') or (p_retry and q.status='error'))
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
create function public.finish_stock_sync(p_account uuid,p_item text,p_lease uuid,p_revision bigint,p_error text,p_quantities jsonb) returns void
language plpgsql security invoker set search_path=public as $$
declare j listing_stock_jobs%rowtype; q jsonb;
begin
 select * into j from listing_stock_jobs where account_id=p_account and item_id=p_item for update;
 if j.lease is distinct from p_lease then return; end if;
 if p_error is null and j.revision=p_revision then
  -- Only patch stock, preserving unrelated catalog data imported concurrently.
  for q in select value from jsonb_array_elements(coalesce(p_quantities,'[]')) loop
   if q->>'variationId'='0' then
    update meli_listings set payload=jsonb_set(payload,'{available_quantity}',q->'stock'),updated_at=now() where account_id=p_account and item_id=p_item;
   else
    update meli_listings set payload=jsonb_set(payload,'{variations}',
     (select jsonb_agg(case when v->>'id'=q->>'variationId' then jsonb_set(v,'{available_quantity}',q->'stock') else v end)
      from jsonb_array_elements(payload->'variations') v)),updated_at=now() where account_id=p_account and item_id=p_item;
   end if;
  end loop;
 end if;
 update listing_stock_jobs set status=case when revision<>p_revision then 'pending' when p_error is null then 'done' else 'error' end,
 error=case when revision=p_revision then left(p_error,500) end,lease=null,lease_until=null,updated_at=now()
 where account_id=p_account and item_id=p_item;
end $$;
do $$ declare f record; begin
 for f in select oid::regprocedure signature from pg_proc where pronamespace='public'::regnamespace and proname in
 ('enqueue_listing_stock','stock_changed_enqueue','mapping_changed_enqueue','visible_stock_job','stock_sync_status','claim_stock_sync','finish_stock_sync') loop
 execute format('revoke all on function %s from public,anon,authenticated',f.signature);
 execute format('grant execute on function %s to service_role',f.signature);
 end loop;
end $$;
commit;
