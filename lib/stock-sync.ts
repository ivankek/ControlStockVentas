import { z } from "zod";
import { admin } from "./server";
import { access } from "./meli";

export type StockTarget = { variationId: string; stock: number };
type Job = { accountId: string; ownerId: string; sellerId: string; itemId: string; revision: number; lease: string; targets: StockTarget[] };
const itemSchema = z.object({
  id: z.string(), seller_id: z.number().int().safe(), status: z.string(),
  available_quantity: z.number().int().nonnegative(), catalog_listing: z.boolean().optional(),
  stock_locations: z.unknown().optional(),
  shipping: z.object({ logistic_type: z.string().optional() }).optional(),
  variations: z.array(z.object({ id: z.union([z.number().int().safe(), z.string()]), available_quantity: z.number().int().nonnegative() })).default([]),
});
export function stockUpdate(raw: unknown, itemId: string, sellerId: string, targets: StockTarget[]) {
  const item = itemSchema.parse(raw);
  if (item.id !== itemId || String(item.seller_id) !== sellerId) throw Error("La publicación no pertenece a la cuenta asociada.");
  if (item.catalog_listing) throw Error("Publicación de catálogo: sincronización todavía no implementada.");
  if (item.shipping?.logistic_type === "fulfillment" || (item.stock_locations && JSON.stringify(item.stock_locations) !== "[]")) throw Error("Stock administrado por depósitos o Full: requiere otra modalidad de sincronización.");
  if (!["active", "paused"].includes(item.status)) throw Error("La publicación está cerrada o no admite cambios de stock en su estado actual.");
  for (const t of targets) {
    z.number().int().min(0).max(1000000000).parse(t.stock);
    if (t.variationId === "0" ? item.variations.length > 0 : !item.variations.some((v) => String(v.id) === t.variationId)) throw Error("Las variantes de la publicación cambiaron. Importá el catálogo y revisá la asociación.");
  }
  const matches = targets.every((t) => (t.variationId === "0" ? item.available_quantity : item.variations.find((v) => String(v.id) === t.variationId)?.available_quantity) === t.stock);
  // ML requires all variation IDs in a parent PUT; omitting them can delete variants.
  const body = item.variations.length ? { variations: item.variations.map((v) => {
    const target = targets.find((t) => t.variationId === String(v.id));
    return target ? { id: v.id, available_quantity: target.stock } : { id: v.id };
  }) } : { available_quantity: targets[0]?.stock };
  return { matches, body };
}
async function request(itemId: string, token: string, body?: unknown) {
  const response = await fetch(`https://api.mercadolibre.com/items/${encodeURIComponent(itemId)}`, {
    method: body ? "PUT" : "GET", headers: { Authorization: `Bearer ${token}`, "Content-Type": "application/json", "x-format-new": "true" },
    body: body ? JSON.stringify(body) : undefined, cache: "no-store", signal: AbortSignal.timeout(15000),
  });
  if (!response.ok) {
    if (response.status === 401 || response.status === 403) throw Error("Mercado Libre rechazó el acceso. El vendedor debe revisar los permisos y reconectar su cuenta.");
    throw Error(`Mercado Libre rechazó la actualización (${response.status}). Revisá la publicación y reintentá.`);
  }
  return response.json();
}
export async function syncNextStock(actor: string, retry = false) {
  const db = admin();
  const claimed = await db.rpc("claim_stock_sync", { p_actor: actor, p_retry: retry });
  if (claimed.error) throw Error("No se pudo iniciar la sincronización. Verificá la migración de stock.");
  const job = claimed.data as Job | null;
  if (!job) return false;
  let error: string | null = null;
  try {
    if (job.targets.length) {
      // The job was authorized by SQL from stored mappings, never client-supplied account IDs.
      const tokens = await access(job.ownerId, job.accountId);
      const current = await request(job.itemId, tokens.access_token);
      const update = stockUpdate(current, job.itemId, job.sellerId, job.targets);
      if (!update.matches) {
        await request(job.itemId, tokens.access_token, update.body);
        const confirmed = await request(job.itemId, tokens.access_token);
        if (!stockUpdate(confirmed, job.itemId, job.sellerId, job.targets).matches) throw Error("Mercado Libre no confirmó la cantidad enviada. Puede requerir stock por User Product; revisá la publicación.");
      }
    }
  } catch (e) {
    error = e instanceof z.ZodError ? "Mercado Libre devolvió datos incompletos de la publicación." : e instanceof Error && e.name === "Error" ? e.message : "No se pudo confirmar la actualización. Reintentá la sincronización.";
  }
  const finished = await db.rpc("finish_stock_sync", { p_account: job.accountId, p_item: job.itemId, p_lease: job.lease, p_revision: job.revision, p_error: error, p_quantities: error ? [] : job.targets });
  if (finished.error) throw Error("No se pudo guardar el resultado de sincronización. Quedará pendiente para verificar nuevamente.");
  return true;
}
