-- Require a stable SKU for every supplier product. Existing blank records receive a traceable legacy SKU.
begin;
update public.supplier_variants
set sku = 'LEGACY-' || left(replace(id::text, '-', ''), 12)
where sku is null or length(trim(sku)) = 0;
alter table public.supplier_variants alter column sku set not null;
alter table public.supplier_variants add constraint supplier_variants_sku_not_blank check (length(trim(sku)) between 1 and 100);
commit;
