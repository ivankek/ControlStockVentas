import { z } from "zod";
import { admin, readState } from "./server";
import { canConnect, type AppUser, type InventorySnapshot } from "./inventory";
import type { Listing } from "./listings";
import type { State } from "./domain";
import { emptyBusiness, type Business } from "./business";

export async function profile(user: string): Promise<AppUser> {
  const { data, error } = await admin().from("app_profiles").select("id,role,display_name").eq("id", user).single();
  if (error || !data) throw Error("No se pudo leer tu perfil. Aplicá la migración 002_inventory.");
  return data as AppUser;
}
export async function sellerProfile(user: string) {
  const p = await profile(user);
  if (!canConnect(p.role)) throw Error("El perfil SUPPLIER no puede operar cuentas Mercado Libre.");
  return p;
}
export async function snapshot(user: string): Promise<InventorySnapshot> {
  const { data, error } = await admin().rpc("inventory_snapshot", { p_actor: user });
  if (error) throw Error("No se pudo consultar inventario y permisos. Verificá la migración 002_inventory.");
  return data as InventorySnapshot;
}
export async function accountFor(user: string, accountId?: string | null) {
  await sellerProfile(user);
  let query = admin().from("meli_accounts").select("id,owner_id,seller_id,nickname,catalog_version").eq("owner_id", user);
  if (accountId) query = query.eq("id", z.uuid().parse(accountId));
  const { data, error } = await query.limit(2);
  if (error || !data?.length) throw Error("Primero seleccioná una cuenta propia de Mercado Libre.");
  if (data.length !== 1) throw Error("Seleccioná la cuenta de Mercado Libre para esta consulta.");
  return data[0] as { id: string; owner_id: string; seller_id: string; nickname: string | null; catalog_version: number };
}
export function requestedAccount(request: Request) { return new URL(request.url).searchParams.get("account"); }
export async function scopedBusiness(user: string, account: { id: string; seller_id: string }, business?: Business) {
  const value = business ?? emptyBusiness();
  const legacy = await admin().from("meli_connections").select("seller_id").eq("owner_id", user).maybeSingle();
  if (legacy.error) throw Error("No se pudo verificar el origen de las notas anteriores.");
  const previousSeller = legacy.data?.seller_id ?? (await admin().from("meli_accounts").select("seller_id").eq("owner_id", user).eq("id", account.id).maybeSingle()).data?.seller_id;
  return { ...value, notes: Object.fromEntries(Object.entries(value.notes).filter(([, note]) => note.accountId ? note.accountId === account.id : previousSeller === account.seller_id)) };
}
export async function accountListings(accountId: string): Promise<Listing[]> {
  const items: Listing[] = [];
  for (let offset = 0; ; offset += 1000) {
    const { data, error } = await admin().from("meli_listings").select("payload").eq("account_id", accountId).order("item_id").range(offset, offset + 999);
    if (error) throw Error("No se pudo leer el catálogo.");
    items.push(...data.map((row) => row.payload as Listing));
    if (data.length < 1000) return items;
  }
}
// Adapter preserves existing dispatch/profit rules. Variant id is the cost product id.
export async function catalogState(user: string, accountId: string): Promise<State> {
  const [{ state }, inventory, listings] = await Promise.all([readState(user), snapshot(user), accountListings(accountId)]);
  const assigned = inventory.legacy.some((row) => row.owner_id === user && row.assigned_supplier_id);
  const ids = new Set(listings.map((l) => l.id));
  const legacyListings = (state.listings ?? []).filter((l) => ids.has(l.id));
  const legacyLinks = Object.fromEntries(Object.entries(state.supplierLinks ?? {}).filter(([key]) => key.startsWith("up:") ? legacyListings.some((l) => `up:${l.user_product_id}` === key) : ids.has(key.split(":")[0])));
  const links = assigned ? {} : legacyLinks;
  for (const mapping of inventory.mappings.filter((m) => m.account_id === accountId))
    links[`${mapping.item_id}:${mapping.variation_id}`] = { supplierId: mapping.variant_id, units: mapping.units_per_sale };
  return { ...state, listings, supplierLinks: links, supplierProducts: [
    ...(!assigned ? state.supplierProducts ?? [] : []),
    ...inventory.variants.map((v) => ({ id: v.id, name: `${v.product_name}${v.name === "Única" ? "" : ` · ${v.name}`}`, costs: v.costs })),
  ] };
}
