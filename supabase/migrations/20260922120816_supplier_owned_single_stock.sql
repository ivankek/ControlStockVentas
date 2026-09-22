-- Run once, together with the matching app deployment. Resets only the supplier catalog.
-- A private backup preserves previous products, prices, stock and associations.
begin;
lock table public.supplier_products, public.supplier_variants, public.supplier_inventory,
 public.supplier_costs, public.inventory_movements, public.listing_mappings,
 public.legacy_catalog_assignments, public.account_states in access exclusive mode;
create schema if not exists inventory_archive;
revoke all on schema inventory_archive from public, anon, authenticated;
create table inventory_archive.catalog_before_single_stock as
 select now() backed_up_at,
 (select coalesce(jsonb_agg(t),'[]') from public.supplier_products t) products,
 (select coalesce(jsonb_agg(t),'[]') from public.supplier_variants t) variants,
 (select coalesce(jsonb_agg(t),'[]') from public.supplier_inventory t) inventory,
 (select coalesce(jsonb_agg(t),'[]') from public.supplier_costs t) costs,
 (select coalesce(jsonb_agg(t),'[]') from public.inventory_movements t) movements,
 (select coalesce(jsonb_agg(t),'[]') from public.listing_mappings t) mappings,
 (select coalesce(jsonb_agg(t),'[]') from public.legacy_catalog_assignments t) assignments,
 (select coalesce(jsonb_agg(jsonb_build_object('owner_id',owner_id,'supplierProducts',state->'supplierProducts','supplierLinks',state->'supplierLinks')),'[]') from public.account_states) legacy;
revoke all on inventory_archive.catalog_before_single_stock from public, anon, authenticated;
alter table inventory_archive.catalog_before_single_stock enable row level security;
delete from public.listing_mappings;
delete from public.inventory_movements;
delete from public.supplier_costs;
delete from public.supplier_inventory;
delete from public.supplier_variants;
delete from public.supplier_products;
delete from public.legacy_catalog_assignments;
update public.account_states set state=state || '{"supplierProducts":[],"supplierLinks":{}}'::jsonb,version=version+1,updated_at=now();
alter table public.supplier_inventory drop column reserved_stock;
alter table public.supplier_inventory rename column physical_stock to stock;
alter table public.inventory_movements drop column reserved_before, drop column reserved_after;
-- Retired import must not reintroduce seller-owned catalogs.
drop function public.assign_legacy_catalog(uuid,uuid,uuid);

create or replace function public.inventory_command(p_actor uuid,p_action jsonb) returns void
language plpgsql security invoker set search_path=public as $$
declare r text; t text:=p_action->>'type'; supplier uuid; prod uuid; variant uuid; account uuid;
 target uuid; inv supplier_inventory%rowtype; delta bigint; key text; item text; variation text; payload jsonb; mv inventory_movements%rowtype;
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
  raise exception 'El catálogo anterior se retiró. El proveedor debe crear sus productos.';
 elsif t='product' then
  supplier:=(p_action->>'supplierId')::uuid;
  if not(r='ADMIN' or (r='SUPPLIER' and supplier=p_actor)) then raise exception 'No podés administrar este proveedor.'; end if;
  perform 1 from app_profiles where id=supplier and role='SUPPLIER' for share;
  if not found then raise exception 'Proveedor inexistente.'; end if;
  prod:=(p_action->>'productId')::uuid; variant:=(p_action->>'variantId')::uuid;
  if p_action->>'stock' is null or (p_action->>'stock')::bigint not between 0 and 1000000000 then raise exception 'Stock inválido.'; end if;
  if (prod is null) <> (variant is null) then raise exception 'Producto y variante requeridos juntos.'; end if;
  if variant is not null then
   -- Lock/version covers product metadata, price and stock as one atomic edit.
   select i.* into inv from supplier_inventory i join supplier_variants v on v.id=i.variant_id
    join supplier_products p on p.id=v.product_id
    where i.variant_id=variant and v.product_id=prod and p.supplier_id=supplier for update of i;
   if not found then raise exception 'Producto ajeno o inexistente.'; end if;
   if p_action->>'expectedVersion' is null or inv.version<>(p_action->>'expectedVersion')::bigint then raise exception 'El producto cambió. Actualizá y revisá los cambios.'; end if;
  end if;
  if prod is null then
   if variant is not null then raise exception 'Producto requerido.'; end if;
   insert into supplier_products(supplier_id,name) values(supplier,p_action->>'name') returning id into prod;
  else
   update supplier_products set name=p_action->>'name' where id=prod and supplier_id=supplier;
   if not found then raise exception 'Producto ajeno o inexistente.'; end if;
  end if;
  if variant is null then
   insert into supplier_variants(product_id,name,sku) values(prod,'Única',trim(p_action->>'sku')) returning id into variant;
   insert into supplier_inventory(variant_id) values(variant);
   select * into inv from supplier_inventory where variant_id=variant for update;
  else
   update supplier_variants set name='Única',sku=trim(p_action->>'sku') where id=variant and product_id=prod;
   if not found then raise exception 'Variante ajena o inexistente.'; end if;
  end if;
  insert into supplier_costs values(variant,(p_action->>'date')::date,(p_action->>'cents')::bigint)
   on conflict(variant_id,valid_from) do update set cents=excluded.cents;
  update supplier_inventory set stock=(p_action->>'stock')::bigint,version=version+1 where variant_id=variant;
  if inv.stock<>(p_action->>'stock')::bigint then
   insert into inventory_movements(variant_id,type,quantity_delta,stock_before,stock_after,source,note,actor_id,request_id)
    values(variant,'CORRECTION',(p_action->>'stock')::bigint-inv.stock,inv.stock,(p_action->>'stock')::bigint,'manual','Producto y stock guardados',p_actor,gen_random_uuid());
  end if;
 elsif t='adjust' then
  variant:=(p_action->>'variantId')::uuid;
  select sp.supplier_id into supplier from supplier_variants sv join supplier_products sp on sp.id=sv.product_id where sv.id=variant;
  if supplier is null or not(r='ADMIN' or (r='SUPPLIER' and supplier=p_actor)) then raise exception 'No podés ajustar este inventario.'; end if;
  -- PostgreSQL row lock serializes stock + movement even across application instances.
  select * into strict inv from supplier_inventory where variant_id=variant for update;
  select * into mv from inventory_movements where actor_id=p_actor and request_id=(p_action->>'requestId')::uuid;
  if found then
  if mv.variant_id<>variant or mv.quantity_delta<>(p_action->>'delta')::bigint or mv.type<>p_action->>'movementType' or mv.note is distinct from p_action->>'note' then raise exception 'Identificador de ajuste reutilizado con otros datos.'; end if;
   return;
  end if;
  if inv.version<>(p_action->>'expectedVersion')::bigint then raise exception 'El stock cambió. Actualizá y revisá el ajuste.'; end if;
  if p_action->>'movementType' not in ('MANUAL_ADJUSTMENT','RESTOCK','CORRECTION') then raise exception 'Solo movimientos manuales.'; end if;
  delta:=(p_action->>'delta')::bigint;
  if p_action->>'movementType'='RESTOCK' and delta<=0 then raise exception 'Una reposición debe agregar unidades.'; end if;
  if length(trim(coalesce(p_action->>'note','')))=0 then raise exception 'Explicá el motivo del ajuste.'; end if;
  if delta=0 then raise exception 'No hay cambios de stock.'; end if;
  update supplier_inventory set stock=stock+delta,version=version+1 where variant_id=variant;
  insert into inventory_movements(variant_id,type,quantity_delta,stock_before,stock_after,source,note,actor_id,request_id)
   values(variant,p_action->>'movementType',delta,inv.stock,inv.stock+delta,'manual',p_action->>'note',p_actor,(p_action->>'requestId')::uuid);
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

create or replace function public.inventory_snapshot(p_actor uuid) returns jsonb
language plpgsql security invoker set search_path=public as $$
declare r text; result jsonb;
begin
 select role into r from app_profiles where id=p_actor;
 if r is null then raise exception 'Perfil inexistente. Aplicá la migración.'; end if;
 with visible_variants as (
  select v.id,v.product_id,p.supplier_id,p.name product_name,v.name,v.sku,i.stock,i.version,
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
commit;
