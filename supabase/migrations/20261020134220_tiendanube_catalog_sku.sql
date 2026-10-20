-- Tokens and catalogs are server-only. All operations verify the owning actor.
create table public.tiendanube_accounts (
 id uuid primary key default gen_random_uuid(),
 owner_id uuid not null references public.app_profiles(id),
 store_id text not null unique check(store_id ~ '^[0-9]+$'),
 name text not null,
 encrypted_token text not null,
 products jsonb not null default '[]' check(jsonb_typeof(products)='array'),
 links jsonb not null default '{}' check(jsonb_typeof(links)='object'),
 version bigint not null default 0,
 updated_at timestamptz not null default now()
);
create index tiendanube_accounts_owner on public.tiendanube_accounts(owner_id);
alter table public.tiendanube_accounts enable row level security;
revoke all on public.tiendanube_accounts from public, anon, authenticated;
grant all on public.tiendanube_accounts to service_role;

create function public.save_tiendanube_account(p_actor uuid,p_store text,p_name text,p_token text)
returns uuid language plpgsql security invoker set search_path=public as $$
declare result uuid;
begin
 perform 1 from app_profiles where id=p_actor and role in ('ADMIN','USER') for share;
 if not found then raise exception 'Este perfil no puede conectar tiendas.'; end if;
 insert into tiendanube_accounts(owner_id,store_id,name,encrypted_token) values(p_actor,p_store,p_name,p_token)
 on conflict(store_id) do update set name=excluded.name,encrypted_token=excluded.encrypted_token,updated_at=now()
 where tiendanube_accounts.owner_id=p_actor returning id into result;
 if result is null then raise exception 'Esta tienda ya pertenece a otro usuario de la aplicación.'; end if;
 return result;
end $$;

create function public.save_tiendanube_catalog(p_actor uuid,p_account uuid,p_expected bigint,p_products jsonb,p_links jsonb)
returns void language plpgsql security invoker set search_path=public as $$
declare a tiendanube_accounts%rowtype; link record; visible jsonb;
begin
 perform 1 from app_profiles where id=p_actor and role in ('ADMIN','USER') for share;
 if not found then raise exception 'Perfil no permitido.'; end if;
 select * into a from tiendanube_accounts where id=p_account and owner_id=p_actor for update;
 if not found then raise exception 'Tienda ajena o inexistente.'; end if;
 if a.version<>p_expected then raise exception 'El catálogo cambió. Actualizá y volvé a intentar.'; end if;
 if jsonb_typeof(p_products)<>'array' or jsonb_typeof(p_links)<>'object' then raise exception 'Catálogo inválido.'; end if;
 visible:=inventory_snapshot(p_actor)->'variants';
 for link in select key,value from jsonb_each_text(p_links) loop
  if not exists(select 1 from jsonb_array_elements(visible) v where v->>'id'=link.value) then raise exception 'Producto de proveedor no permitido.'; end if;
  if not exists(select 1 from jsonb_array_elements(p_products) p cross join lateral jsonb_array_elements(p->'variants') v where (p->>'id')||':'||(v->>'id')=link.key) then raise exception 'Variante de tienda inexistente.'; end if;
 end loop;
 -- A refresh or an unsuccessful SKU lookup must never remove existing links.
 update tiendanube_accounts set products=p_products,links=links||p_links,version=version+1,updated_at=now() where id=p_account;
end $$;

create function public.sync_meli_sku(p_actor uuid,p_account uuid,p_expected bigint,p_items jsonb,p_links jsonb)
returns void language plpgsql security invoker set search_path=public as $$
declare link record; units integer;
begin
 perform 1 from meli_accounts where id=p_account and owner_id=p_actor for update;
 if not found then raise exception 'Cuenta ajena o inexistente.'; end if;
 if jsonb_typeof(p_links)<>'object' then raise exception 'Asociaciones inválidas.'; end if;
 perform save_meli_catalog(p_actor,p_account,p_expected,p_items);
 for link in select key,value from jsonb_each_text(p_links) loop
  select units_per_sale into units from listing_mappings
   where account_id=p_account and item_id=split_part(link.key,':',1) and variation_id=split_part(link.key,':',2) for update;
  perform inventory_command(p_actor,jsonb_build_object('type','mapping','accountId',p_account,
   'keys',jsonb_build_array(link.key),'variantId',link.value,'units',coalesce(units,1),
   'mode','REAL','fixed',null,'preservePolicy',true));
 end loop;
end $$;
revoke all on function public.save_tiendanube_account(uuid,text,text,text),public.save_tiendanube_catalog(uuid,uuid,bigint,jsonb,jsonb),public.sync_meli_sku(uuid,uuid,bigint,jsonb,jsonb) from public,anon,authenticated;
grant execute on function public.save_tiendanube_account(uuid,text,text,text),public.save_tiendanube_catalog(uuid,uuid,bigint,jsonb,jsonb),public.sync_meli_sku(uuid,uuid,bigint,jsonb,jsonb) to service_role;
