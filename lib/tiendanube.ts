import { z } from "zod";
import { admin, required } from "./server";
import { sellerProfile } from "./inventory-server";
import { unseal } from "./crypto";
import { normalizeNubeProduct, type NubeProduct } from "./tiendanube-catalog";

export async function nubeGet(store: string, token: string, path: string) {
  z.string().regex(/^\d+$/).parse(store);
  for (let attempt = 0; attempt < 3; attempt++) {
    const response = await fetch(`https://api.tiendanube.com/2025-03/${store}${path}`, {
      headers: { Authentication: `bearer ${token}`, "User-Agent": `Despachos (${required("APP_URL")})` },
      cache: "no-store", signal: AbortSignal.timeout(30000),
    });
    if (response.ok) return response.json();
    if ([429, 500, 502, 503, 504].includes(response.status) && attempt < 2) {
      await new Promise((resolve) => setTimeout(resolve, 1000 * (attempt + 1))); continue;
    }
    throw Error(response.status === 401 || response.status === 403
      ? "Tiendanube rechazó el acceso. Revisá el ID de tienda, el token y el permiso de lectura de productos."
      : `Tiendanube no pudo completar la consulta (${response.status}).`);
  }
}
export async function nubeAccount(user: string, id: string | null) {
  await sellerProfile(user);
  const { data, error } = await admin().from("tiendanube_accounts").select("*").eq("owner_id", user).eq("id", z.uuid().parse(id)).single();
  if (error || !data) throw Error("Seleccioná una tienda propia de Tiendanube.");
  return data;
}
export async function fetchNubeProducts(account: { store_id: string; encrypted_token: string }) {
  const { token } = unseal<{ token: string }>(account.encrypted_token);
  const products = new Map<string, NubeProduct>();
  for (let page = 1; page <= 101; page++) {
    const raw = await nubeGet(account.store_id, token, `/products?page=${page}&per_page=100&sort_by=created-at-ascending`);
    if (!Array.isArray(raw)) throw Error("Tiendanube devolvió un catálogo inválido.");
    const before = products.size;
    raw.forEach((item) => { const p = normalizeNubeProduct(item); products.set(p.id, p); });
    if (products.size > 10000) throw Error("El catálogo supera 10.000 productos. No se guardaron cambios.");
    if (raw.length < 100) return [...products.values()];
    if (products.size === before) throw Error("No se pudo completar la paginación de Tiendanube.");
  }
  throw Error("No se pudo completar el catálogo de Tiendanube.");
}
