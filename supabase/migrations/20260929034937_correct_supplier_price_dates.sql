-- Correct only the date of the price current on 2026-09-29.
-- No prices are deleted or merged. Conflicting histories abort the transaction.
begin;
lock table public.supplier_inventory, public.supplier_costs in share row exclusive mode;
create temporary table september_prices on commit drop as
 with current_prices as (
  select distinct on (variant_id) variant_id,valid_from,cents from public.supplier_costs
  where valid_from <= date '2026-09-29' order by variant_id,valid_from desc
 )
 -- Equal consecutive prices have one effective start, even if saved repeatedly.
 select p.variant_id,min(h.valid_from) valid_from from current_prices p
 join public.supplier_costs h on h.variant_id=p.variant_id and h.valid_from<=p.valid_from
 and h.valid_from>coalesce((select max(d.valid_from) from public.supplier_costs d
  where d.variant_id=p.variant_id and d.valid_from<=p.valid_from and d.cents<>p.cents),'-infinity'::date)
 group by p.variant_id;
do $$
begin
 if exists(select 1 from public.supplier_costs c join september_prices p using(variant_id)
   where c.valid_from<>p.valid_from
   and c.valid_from between least(date '2026-09-01',p.valid_from) and greatest(date '2026-09-01',p.valid_from)) then
  raise exception 'Hay otro precio en el período a corregir. Revisá el historial antes de cambiar la fecha; no se modificó ningún precio.';
 end if;
end $$;
update public.supplier_costs c set valid_from=date '2026-09-01'
 from september_prices p where c.variant_id=p.variant_id and c.valid_from=p.valid_from
 and c.valid_from<>date '2026-09-01';

-- Separate application fix: allow the editor to move an existing price date.
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
  -- A date-only correction moves the existing price, rather than leaving a later duplicate.
  if p_action->>'originalCostDate' is not null and p_action->>'originalCostDate' <> p_action->>'date' then
   if not exists(select 1 from supplier_costs where variant_id=variant
      and valid_from=(p_action->>'originalCostDate')::date and cents=(p_action->>'cents')::bigint) then
    raise exception 'El precio cambió. Actualizá el producto antes de corregir su vigencia.';
   end if;
   if exists(select 1 from supplier_costs where variant_id=variant
      and valid_from between least((p_action->>'date')::date,(p_action->>'originalCostDate')::date)
      and greatest((p_action->>'date')::date,(p_action->>'originalCostDate')::date)
      and valid_from<>(p_action->>'originalCostDate')::date) then
    raise exception 'La fecha se cruza con otro precio del historial. Revisá las vigencias.';
   end if;
   update supplier_costs set valid_from=(p_action->>'date')::date
      where variant_id=variant and valid_from=(p_action->>'originalCostDate')::date;
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
revoke all on function public.inventory_command(uuid,jsonb) from public, anon, authenticated;
grant execute on function public.inventory_command(uuid,jsonb) to service_role;
commit;

