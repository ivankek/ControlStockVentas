import { z } from "zod";
import { admin, required } from "./server";
import { unseal } from "./crypto";

type Job = { accountId: string; storeId: string; encryptedToken: string; key: string; revision: number; lease: string; stock: number | null; allowed: boolean };
export function nubeStockMatches(raw: unknown, product: string, variant: string, stock: number) {
  const item = z.object({ id: z.union([z.number().int().safe(), z.string()]), product_id: z.union([z.number().int().safe(), z.string()]), stock_management: z.boolean(), stock: z.number().int().nonnegative().nullable() }).parse(raw);
  if (String(item.id) !== variant || String(item.product_id) !== product) throw Error("La variante de Tiendanube cambió. Actualizá el catálogo y revisá su asociación.");
  return item.stock_management && item.stock === stock;
}
async function request(job: Job, stock?: number) {
  const [product, variant] = job.key.split(":");
  if (![job.storeId, product, variant].every((id) => /^\d+$/.test(id))) throw Error("Identificador de Tiendanube inválido.");
  const { token } = unseal<{ token: string }>(job.encryptedToken);
  const response = await fetch(`https://api.tiendanube.com/2025-03/${job.storeId}/products/${product}/variants/${variant}`, {
    method: stock === undefined ? "GET" : "PUT",
    headers: { Authentication: `bearer ${token}`, "Content-Type": "application/json", "User-Agent": `Despachos (${required("APP_URL")})` },
    ...(stock === undefined ? {} : { body: JSON.stringify({ stock_management: true, stock }) }),
    cache: "no-store", signal: AbortSignal.timeout(15000),
  });
  if (!response.ok) throw Error([401,403].includes(response.status)
    ? "Tiendanube rechazó el acceso. Habilitá escritura de productos y reconectá la tienda."
    : `No se pudo actualizar el stock en Tiendanube (${response.status}). Se reintentará automáticamente.`);
  return response.json();
}
export async function syncNextNubeStock(actor: string | null) {
  required("TOKEN_ENCRYPTION_KEY"); required("APP_URL");
  const db = admin();
  const claimed = await db.rpc("claim_nube_stock", { p_actor: actor });
  if (claimed.error) throw Error("No se pudo consultar la cola de stock de Tiendanube.");
  const job = claimed.data as Job | null;
  if (!job) return false;
  let error: string | null = null;
  try {
    if (!job.allowed || job.stock === null) throw Error("El producto del proveedor ya no está disponible para esta tienda. Revisá la asociación.");
    const stock = z.number().int().min(0).max(1000000000).parse(job.stock);
    const [product, variant] = job.key.split(":");
    if (!nubeStockMatches(await request(job), product, variant, stock)) {
      let writeError: unknown;
      try { await request(job, stock); } catch (e) { writeError = e; }
      // A timeout can occur after the provider accepted the PUT. Read before retrying.
      if (!nubeStockMatches(await request(job), product, variant, stock)) throw writeError ?? Error("El stock todavía no coincide. Se reintentará automáticamente.");
    }
  } catch (e) { error = e instanceof z.ZodError ? "Tiendanube devolvió una variante incompleta." : e instanceof Error && e.name === "Error" ? e.message : "No se pudo confirmar el stock. Se reintentará automáticamente."; }
  const finished = await db.rpc("finish_nube_stock", { p_account: job.accountId, p_key: job.key, p_lease: job.lease, p_revision: job.revision, p_error: error, p_stock: job.stock });
  if (finished.error) throw Error("No se pudo guardar el resultado de stock de Tiendanube.");
  return true;
}
export async function syncPendingNubeStock(actor: string) {
  const deadline = Date.now() + 60000;
  for (let count = 0; count < 30 && Date.now() < deadline; count++) if (!await syncNextNubeStock(actor)) break;
}
