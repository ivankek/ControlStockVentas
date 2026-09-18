-- Additive migration. Run with the old deployment stopped, then deploy the new code.
begin;
create table public.app_profiles (
 id uuid primary key references auth.users(id),
 role text not null default 'USER' check (role in ('ADMIN','USER','SUPPLIER')),
 display_name text not null default '', created_at timestamptz not null default now()
);
insert into public.app_profiles(id,display_name) select id,coalesce(email,id::text) from auth.users;
create function public.create_app_profile() returns trigger language plpgsql security definer set search_path=public as $$
begin insert into app_profiles(id,display_name) values(new.id,coalesce(new.email,new.id::text)); return new; end $$;
create trigger create_app_profile after insert on auth.users for each row execute function public.create_app_profile();
create table public.supplier_sellers (
 supplier_id uuid not null references app_profiles(id), seller_user_id uuid not null references app_profiles(id),
 active boolean not null default true, primary key(supplier_id,seller_user_id), check(supplier_id<>seller_user_id)
);
create table public.meli_accounts (
 id uuid primary key default gen_random_uuid(), owner_id uuid not null references app_profiles(id),
 seller_id text not null unique, nickname text, encrypted_tokens text not null,
 created_at timestamptz not null default now(), updated_at timestamptz not null default now(),
 catalog_version bigint not null default 0,
 refresh_owner uuid, refresh_until timestamptz
);
insert into meli_accounts(owner_id,seller_id,encrypted_tokens,updated_at)
 select owner_id,seller_id,encrypted_tokens,updated_at from meli_connections;
create index on meli_accounts(owner_id);
create table public.supplier_products (
 id uuid primary key default gen_random_uuid(), supplier_id uuid not null references app_profiles(id),
 name text not null check(length(name) between 1 and 200),
 legacy_owner uuid references app_profiles(id), legacy_id text,
 unique(legacy_owner,legacy_id), created_at timestamptz not null default now()
);
create table public.supplier_variants (
 id uuid primary key default gen_random_uuid(), product_id uuid not null references supplier_products(id),
 name text not null default 'Única', sku text not null check(length(trim(sku)) between 1 and 100), unique(product_id,name)
);
create table public.supplier_costs (
 variant_id uuid not null references supplier_variants(id), valid_from date not null,
 cents bigint not null check(cents between 0 and 100000000000), primary key(variant_id,valid_from)
);
create table public.supplier_inventory (
 variant_id uuid primary key references supplier_variants(id), physical_stock bigint not null default 0,
 reserved_stock bigint not null default 0, safety_stock bigint not null default 0,
 version bigint not null default 0,
 check(physical_stock between 0 and 1000000000), check(reserved_stock between 0 and physical_stock),
 check(safety_stock between 0 and 1000000000)
);
create table public.inventory_movements (
 id uuid primary key default gen_random_uuid(), variant_id uuid not null references supplier_variants(id),
 type text not null check(type in ('MANUAL_ADJUSTMENT','RESTOCK','CORRECTION','SALE','CANCELLATION','RETURN')),
 quantity_delta bigint not null, stock_before bigint not null, stock_after bigint not null,
 reserved_before bigint not null, reserved_after bigint not null, safety_before bigint not null, safety_after bigint not null,
 source text not null, external_reference text, note text, actor_id uuid not null references app_profiles(id),
 request_id uuid not null, created_at timestamptz not null default now(), unique(actor_id,request_id),
 check(stock_after = stock_before + quantity_delta)
);
create index on inventory_movements(variant_id,created_at desc);
create table public.meli_listings (
 account_id uuid not null references meli_accounts(id), item_id text not null,
 payload jsonb not null, updated_at timestamptz not null default now(), primary key(account_id,item_id),
 check(payload->>'id'=item_id)
);
insert into meli_listings(account_id,item_id,payload)
 select a.id,l->>'id',l from account_states s join meli_accounts a on a.owner_id=s.owner_id
 cross join lateral jsonb_array_elements(coalesce(s.state->'listings','[]')) l
 where l->>'seller_id'=a.seller_id;
create table public.listing_mappings (
 account_id uuid not null, item_id text not null, variation_id text not null default '0',
 variant_id uuid not null references supplier_variants(id), units_per_sale integer not null default 1 check(units_per_sale between 1 and 10000),
 mode text not null default 'REAL' check(mode in ('REAL','FIXED')), fixed_quantity bigint,
 primary key(account_id,item_id,variation_id), foreign key(account_id,item_id) references meli_listings(account_id,item_id),
 check((mode='REAL' and fixed_quantity is null) or (mode='FIXED' and fixed_quantity is not null and fixed_quantity between 0 and 1000000000))
);
create index on listing_mappings(variant_id);
create table public.legacy_catalog_assignments (
 owner_id uuid primary key references app_profiles(id), supplier_id uuid not null references app_profiles(id),
 actor_id uuid not null references app_profiles(id), created_at timestamptz not null default now()
);

-- A single transaction migrates an explicitly selected catalog, including cost history and every link.
create function public.assign_legacy_catalog(p_actor uuid,p_owner uuid,p_supplier uuid) returns void
language plpgsql security invoker set search_path=public as $$
declare s jsonb; product jsonb; c jsonb; prod uuid; variant uuid; link record; item record; v jsonb; k text; found_link boolean;
begin
 if not exists(select 1 from app_profiles where id=p_actor and role='ADMIN') then raise exception 'Solo ADMIN puede asignar catálogos.'; end if;
 if not exists(select 1 from app_profiles where id=p_supplier and role='SUPPLIER') then raise exception 'Seleccioná un SUPPLIER.'; end if;
 select state into s from account_states where owner_id=p_owner for update;
 if s is null then raise exception 'No existe catálogo anterior.'; end if;
 if exists(select 1 from legacy_catalog_assignments where owner_id=p_owner) then raise exception 'Este catálogo ya fue asignado.'; end if;
 if not exists(select 1 from app_profiles where id=p_owner and role in ('USER','ADMIN')) then raise exception 'El propietario anterior debe ser vendedor.'; end if;
 insert into supplier_sellers values(p_supplier,p_owner,true) on conflict(supplier_id,seller_user_id) do update set active=true;
 for product in select value from jsonb_array_elements(coalesce(s->'supplierProducts','[]')) loop
  insert into supplier_products(supplier_id,name,legacy_owner,legacy_id) values(p_supplier,product->>'name',p_owner,product->>'id') returning id into prod;
  insert into supplier_variants(product_id,sku) values(prod,coalesce(nullif(trim(product->>'sku'),''),'LEGACY-'||left(replace(coalesce(product->>'id',prod::text),'-',''),12))) returning id into variant;
  insert into supplier_inventory(variant_id) values(variant);
  for c in select value from jsonb_array_elements(coalesce(product->'costs','[]')) loop
   insert into supplier_costs values(variant,(c->>'from')::date,(c->>'cents')::bigint);
  end loop;
 end loop;
 for link in select * from jsonb_each(coalesce(s->'supplierLinks','{}')) loop
  select sv.id into variant from supplier_products sp join supplier_variants sv on sv.product_id=sp.id
   where sp.legacy_owner=p_owner and sp.legacy_id=link.value->>'supplierId';
  if variant is null then raise exception 'Asociación anterior sin producto: %. No se migró nada.',link.key; end if;
  found_link:=false;
  for item in select l.* from meli_listings l join meli_accounts a on a.id=l.account_id where a.owner_id=p_owner loop
   for v in select value from jsonb_array_elements(case when jsonb_array_length(coalesce(item.payload->'variations','[]'))=0 then '[{"id":"0"}]'::jsonb else item.payload->'variations' end) loop
    k:=item.item_id||':'||(v->>'id');
    if link.key=k or (v->>'id'='0' and link.key='up:'||(item.payload->>'user_product_id')) then
     found_link:=true;
     -- Exact item mapping takes precedence over the legacy UP fallback.
     if link.key like 'up:%' and (s->'supplierLinks') ? k then continue; end if;
     if exists(select 1 from listing_mappings m where m.account_id=item.account_id and m.item_id=item.item_id and m.variation_id=v->>'id') then
      raise exception 'La publicación % ya tiene una asociación nueva. Revisar antes de migrar; no se cambió nada.',k;
     end if;
     insert into listing_mappings(account_id,item_id,variation_id,variant_id,units_per_sale)
      values(item.account_id,item.item_id,v->>'id',variant,(link.value->>'units')::int);
    end if;
   end loop;
  end loop;
  if not found_link then raise exception 'Asociación % sin publicación importada. Revisar antes de migrar; no se cambió nada.',link.key; end if;
 end loop;
 insert into legacy_catalog_assignments values(p_owner,p_supplier,p_actor,now());
end $$;

-- All mutations require the verified server-side actor. Not callable by browser roles.
create function public.inventory_command(p_actor uuid,p_action jsonb) returns void
language plpgsql security invoker set search_path=public as $$
declare r text; t text:=p_action->>'type'; supplier uuid; prod uuid; variant uuid; account uuid;
 target uuid; inv supplier_inventory%rowtype; delta bigint; reserve bigint; safety bigint; key text; item text; variation text; payload jsonb; mv inventory_movements%rowtype;
begin
 select role into r from app_profiles where id=p_actor for share;
 if r is null then raise exception 'Perfil inexistente.'; end if;
 if t='role' then
  if r<>'ADMIN' then raise exception 'Solo ADMIN puede cambiar roles.'; end if;
  target:=(p_action->>'userId')::uuid;
  perform 1 from app_profiles where id=target for update;
  if p_action->>'role' not in ('USER','SUPPLIER') or not exists(select 1 from app_profiles where id=target and role<>'ADMIN') then raise exception 'Cambio de rol no permitido.'; end if;
  if (select role from app_profiles where id=target) <> p_action->>'role' and (
   exists(select 1 from meli_accounts where owner_id=target) or exists(select 1 from supplier_products where supplier_id=target) or
   exists(select 1 from supplier_sellers where supplier_id=target or seller_user_id=target)) then raise exception 'El usuario ya tiene cuentas, productos o relaciones. No se puede cambiar su rol.'; end if;
  update app_profiles set role=p_action->>'role' where id=target;
 elsif t='relationship' then
  if r<>'ADMIN' then raise exception 'Solo ADMIN gestiona relaciones.'; end if;
  supplier:=(p_action->>'supplierId')::uuid; target:=(p_action->>'sellerId')::uuid;
  perform 1 from app_profiles where id in (supplier,target) order by id for share;
  if not exists(select 1 from app_profiles where id=supplier and role='SUPPLIER') or not exists(select 1 from app_profiles where id=target and role in ('USER','ADMIN')) then raise exception 'Relación inválida.'; end if;
  insert into supplier_sellers values(supplier,target,(p_action->>'active')::boolean) on conflict(supplier_id,seller_user_id) do update set active=excluded.active;
 elsif t='assignLegacy' then
  perform assign_legacy_catalog(p_actor,(p_action->>'ownerId')::uuid,(p_action->>'supplierId')::uuid);
 elsif t='product' then
  supplier:=(p_action->>'supplierId')::uuid;
  if not(r='ADMIN' or (r='SUPPLIER' and supplier=p_actor)) then raise exception 'No podés administrar este proveedor.'; end if;
  perform 1 from app_profiles where id=supplier and role='SUPPLIER' for share;
  if not found then raise exception 'Proveedor inexistente.'; end if;
  prod:=(p_action->>'productId')::uuid; variant:=(p_action->>'variantId')::uuid;
  if prod is null then
   if variant is not null then raise exception 'Producto requerido.'; end if;
   insert into supplier_products(supplier_id,name) values(supplier,p_action->>'name') returning id into prod;
  else
   update supplier_products set name=p_action->>'name' where id=prod and supplier_id=supplier;
   if not found then raise exception 'Producto ajeno o inexistente.'; end if;
  end if;
  if variant is null then
   insert into supplier_variants(product_id,name,sku) values(prod,p_action->>'variantName',trim(p_action->>'sku')) returning id into variant;
   insert into supplier_inventory(variant_id) values(variant);
  else
   update supplier_variants set name=p_action->>'variantName',sku=trim(p_action->>'sku') where id=variant and product_id=prod;
   if not found then raise exception 'Variante ajena o inexistente.'; end if;
  end if;
  insert into supplier_costs values(variant,(p_action->>'date')::date,(p_action->>'cents')::bigint)
   on conflict(variant_id,valid_from) do update set cents=excluded.cents;
 elsif t='adjust' then
  variant:=(p_action->>'variantId')::uuid;
  select sp.supplier_id into supplier from supplier_variants sv join supplier_products sp on sp.id=sv.product_id where sv.id=variant;
  if supplier is null or not(r='ADMIN' or (r='SUPPLIER' and supplier=p_actor)) then raise exception 'No podés ajustar este inventario.'; end if;
  -- PostgreSQL row lock serializes stock + movement even across application instances.
  select * into strict inv from supplier_inventory where variant_id=variant for update;
  select * into mv from inventory_movements where actor_id=p_actor and request_id=(p_action->>'requestId')::uuid;
  if found then
   if mv.variant_id<>variant or mv.quantity_delta<>(p_action->>'delta')::bigint or mv.reserved_after<>(p_action->>'reserved')::bigint or mv.safety_after<>(p_action->>'safety')::bigint or mv.type<>p_action->>'movementType' or mv.note is distinct from p_action->>'note' then raise exception 'Identificador de ajuste reutilizado con otros datos.'; end if;
   return;
  end if;
  if inv.version<>(p_action->>'expectedVersion')::bigint then raise exception 'El stock cambió. Actualizá y revisá el ajuste.'; end if;
  if p_action->>'movementType' not in ('MANUAL_ADJUSTMENT','RESTOCK','CORRECTION') then raise exception 'Solo movimientos manuales.'; end if;
  delta:=(p_action->>'delta')::bigint; reserve:=(p_action->>'reserved')::bigint; safety:=(p_action->>'safety')::bigint;
  if p_action->>'movementType'='RESTOCK' and delta<=0 then raise exception 'Una reposición debe agregar unidades.'; end if;
  if length(trim(coalesce(p_action->>'note','')))=0 then raise exception 'Explicá el motivo del ajuste.'; end if;
  if delta=0 and reserve=inv.reserved_stock and safety=inv.safety_stock then raise exception 'No hay cambios de stock.'; end if;
  update supplier_inventory set physical_stock=physical_stock+delta,reserved_stock=reserve,safety_stock=safety,version=version+1 where variant_id=variant;
  insert into inventory_movements(variant_id,type,quantity_delta,stock_before,stock_after,reserved_before,reserved_after,safety_before,safety_after,source,note,actor_id,request_id)
   values(variant,p_action->>'movementType',delta,inv.physical_stock,inv.physical_stock+delta,inv.reserved_stock,reserve,inv.safety_stock,safety,'manual',p_action->>'note',p_actor,(p_action->>'requestId')::uuid);
 elsif t='mapping' then
  account:=(p_action->>'accountId')::uuid; variant:=(p_action->>'variantId')::uuid;
  if not exists(select 1 from meli_accounts where id=account and (owner_id=p_actor or r='ADMIN')) or r='SUPPLIER' then raise exception 'Cuenta ajena o no permitida.'; end if;
  if variant is not null then
   select sp.supplier_id into supplier from supplier_variants sv join supplier_products sp on sp.id=sv.product_id where sv.id=variant;
   if supplier is null then raise exception 'Variante inexistente.'; end if;
   if r<>'ADMIN' then
    perform 1 from supplier_sellers where supplier_id=supplier and seller_user_id=p_actor and active for share;
    if not found then raise exception 'No tenés relación activa con este proveedor.'; end if;
   end if;
  end if;
  for key in select jsonb_array_elements_text(p_action->'keys') loop
   item:=split_part(key,':',1); variation:=split_part(key,':',2);
   select l.payload into payload from meli_listings l where l.account_id=account and l.item_id=item for share;
   if payload is null or (variation='0' and jsonb_array_length(payload->'variations')>0) or (variation<>'0' and not exists(select 1 from jsonb_array_elements(payload->'variations') v where v->>'id'=variation)) then raise exception 'Publicación o variante inválida.'; end if;
   if variant is null then delete from listing_mappings where account_id=account and item_id=item and variation_id=variation;
   else
    insert into listing_mappings values(account,item,variation,variant,(p_action->>'units')::int,p_action->>'mode',case when p_action->>'mode'='FIXED' then (p_action->>'fixed')::bigint end)
     on conflict(account_id,item_id,variation_id) do update set variant_id=excluded.variant_id,units_per_sale=excluded.units_per_sale,
      mode=case when (p_action->>'preservePolicy')::boolean then listing_mappings.mode else excluded.mode end,
      fixed_quantity=case when (p_action->>'preservePolicy')::boolean then listing_mappings.fixed_quantity else excluded.fixed_quantity end;
   end if;
  end loop;
 else raise exception 'Operación desconocida.';
 end if;
end $$;

-- Atomic identity check + upsert. An existing seller can never move to another app user.
create function public.save_meli_account(p_actor uuid,p_seller text,p_tokens text,p_nickname text default null) returns uuid
language plpgsql security invoker set search_path=public as $$
declare account uuid;
begin
 perform 1 from app_profiles where id=p_actor and role in ('ADMIN','USER') for share;
 if not found then raise exception 'Este perfil no puede conectar Mercado Libre.'; end if;
 insert into meli_accounts(owner_id,seller_id,encrypted_tokens,nickname) values(p_actor,p_seller,p_tokens,p_nickname)
 on conflict(seller_id) do update set encrypted_tokens=excluded.encrypted_tokens,nickname=coalesce(excluded.nickname,meli_accounts.nickname),updated_at=now(),refresh_owner=null,refresh_until=null
 where meli_accounts.owner_id=p_actor returning id into account;
 if account is null then raise exception 'Esta cuenta de Mercado Libre ya pertenece a otro usuario.'; end if;
 return account;
end $$;

-- Refresh token rotation is serialized with a DB lease, not a Node lock.
create function public.lease_meli_refresh(p_actor uuid,p_account uuid,p_lease uuid,p_expected text) returns boolean
language sql security invoker set search_path=public as $$
 with changed as (update meli_accounts set refresh_owner=p_lease,refresh_until=now()+interval '60 seconds'
 where id=p_account and owner_id=p_actor and encrypted_tokens=p_expected and (refresh_until is null or refresh_until<now())
 returning id) select exists(select 1 from changed)
$$;
create function public.finish_meli_refresh(p_actor uuid,p_account uuid,p_lease uuid,p_tokens text) returns boolean
language sql security invoker set search_path=public as $$
 with changed as (update meli_accounts set encrypted_tokens=coalesce(p_tokens,encrypted_tokens),updated_at=now(),refresh_owner=null,refresh_until=null
 where id=p_account and owner_id=p_actor and refresh_owner=p_lease returning id) select exists(select 1 from changed)
$$;

create function public.save_meli_catalog(p_actor uuid,p_account uuid,p_expected bigint,p_items jsonb) returns void
language plpgsql security invoker set search_path=public as $$
declare a meli_accounts%rowtype; item jsonb;
begin
 perform 1 from app_profiles where id=p_actor and role in ('ADMIN','USER') for share;
 if not found then raise exception 'Perfil no habilitado.'; end if;
 select * into strict a from meli_accounts where id=p_account and owner_id=p_actor for update;
 if a.catalog_version<>p_expected then raise exception 'Otra importación modificó el catálogo. Volvé a consultar.'; end if;
 for item in select value from jsonb_array_elements(p_items) loop
  if item->>'seller_id'<>a.seller_id then raise exception 'Publicación de otra cuenta.'; end if;
  insert into meli_listings values(a.id,item->>'id',item,now()) on conflict(account_id,item_id)
   do update set payload=excluded.payload,updated_at=now() where meli_listings.payload is distinct from excluded.payload;
 end loop;
 update meli_accounts set catalog_version=catalog_version+1 where id=a.id;
end $$;

-- RLS denies direct client access. Only authenticated server handlers use service_role.
do $$ declare t text; f record; begin
 foreach t in array array['app_profiles','supplier_sellers','meli_accounts','supplier_products','supplier_variants','supplier_costs','supplier_inventory','inventory_movements','meli_listings','listing_mappings','legacy_catalog_assignments'] loop
  execute format('alter table public.%I enable row level security',t);
  execute format('revoke all on public.%I from anon,authenticated',t);
  execute format('grant all on public.%I to service_role',t);
 end loop;
 for f in select oid::regprocedure as signature from pg_proc where pronamespace='public'::regnamespace and proname in ('create_app_profile','assign_legacy_catalog','inventory_command','save_meli_account','lease_meli_refresh','finish_meli_refresh','save_meli_catalog') loop
  execute format('revoke all on function %s from public,anon,authenticated',f.signature);
  execute format('grant execute on function %s to service_role',f.signature);
 end loop;
end $$;
create function public.inventory_snapshot(p_actor uuid) returns jsonb
language plpgsql security invoker set search_path=public as $$
declare r text; result jsonb;
begin
 select role into r from app_profiles where id=p_actor;
 if r is null then raise exception 'Perfil inexistente. Aplicá la migración.'; end if;
 with visible_variants as (
  select v.id,v.product_id,p.supplier_id,p.name product_name,v.name,v.sku,i.physical_stock,i.reserved_stock,i.safety_stock,i.version,
   coalesce((select jsonb_agg(jsonb_build_object('from',c.valid_from,'cents',c.cents) order by c.valid_from) from supplier_costs c where c.variant_id=v.id),'[]') costs
  from supplier_variants v join supplier_products p on p.id=v.product_id join supplier_inventory i on i.variant_id=v.id
  where r='ADMIN' or (r='SUPPLIER' and p.supplier_id=p_actor) or (r='USER' and exists(select 1 from supplier_sellers ss where ss.supplier_id=p.supplier_id and ss.seller_user_id=p_actor and ss.active))
 ), visible_mappings as (
  select m.*,a.seller_id,a.owner_id,a.nickname,l.payload->>'title' title,l.payload->>'user_product_id' user_product_id,
   case when m.variation_id='0' then (l.payload->>'available_quantity')::bigint else
    (select (v->>'available_quantity')::bigint from jsonb_array_elements(l.payload->'variations') v where v->>'id'=m.variation_id) end ml_quantity
  from listing_mappings m join visible_variants v on v.id=m.variant_id join meli_accounts a on a.id=m.account_id join meli_listings l on l.account_id=m.account_id and l.item_id=m.item_id
  where r in ('ADMIN','SUPPLIER') or a.owner_id=p_actor
 )
 select jsonb_build_object(
  'profile',(select to_jsonb(p) from app_profiles p where id=p_actor),
  'people',coalesce((select jsonb_agg(p) from app_profiles p where r='ADMIN' or id=p_actor or id in(select supplier_id from visible_variants) or (r='SUPPLIER' and id in(select owner_id from visible_mappings))),'[]'),
  'accounts',coalesce((select jsonb_agg(jsonb_build_object('id',id,'owner_id',owner_id,'seller_id',seller_id,'nickname',nickname,'updated_at',updated_at)) from meli_accounts where owner_id=p_actor or r='ADMIN'),'[]'),
  'relationships',coalesce((select jsonb_agg(ss) from supplier_sellers ss where r='ADMIN' or supplier_id=p_actor or seller_user_id=p_actor),'[]'),
  'variants',coalesce((select jsonb_agg(v order by product_name,name) from visible_variants v),'[]'),
  'mappings',coalesce((select jsonb_agg(m) from visible_mappings m),'[]'),
  'movements',coalesce((select jsonb_agg(m order by created_at desc) from (select im.* from inventory_movements im join visible_variants v on v.id=im.variant_id where r in ('ADMIN','SUPPLIER') order by created_at desc limit 200) m),'[]'),
  'legacy',coalesce((select jsonb_agg(jsonb_build_object('owner_id',s.owner_id,'count',jsonb_array_length(coalesce(s.state->'supplierProducts','[]')),'assigned_supplier_id',a.supplier_id)) from account_states s left join legacy_catalog_assignments a on a.owner_id=s.owner_id where (r='ADMIN' or s.owner_id=p_actor) and jsonb_array_length(coalesce(s.state->'supplierProducts','[]'))>0),'[]')
 ) into result;
 return result;
end $$;
revoke all on function public.inventory_snapshot(uuid) from public,anon,authenticated;
grant execute on function public.inventory_snapshot(uuid) to service_role;
commit;
