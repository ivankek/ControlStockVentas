import { z } from "zod";
import { admin } from "./server";
import { access } from "./meli";
import { syncNextStock } from "./stock-sync";

const id = z.union([z.number().int().positive().safe(), z.string().regex(/^[1-9]\d{0,31}$/)]).transform(String);
const variationId = z.union([z.number().int().nonnegative().safe(), z.string().regex(/^(0|[1-9]\d{0,31})$/)]).transform(String);
const orderSchema = z.object({
  id, seller: z.object({ id }), status: z.string().min(1),
  date_closed: z.iso.datetime({ offset: true }).nullish(),
  order_items: z.array(z.object({
    item: z.object({ id: z.string().regex(/^ML[A-Z]\d+$/), variation_id: variationId.nullish() }),
    quantity: z.number().int().min(1).max(1000000000),
  })).min(1),
});
type SaleJob = { accountId: string; ownerId: string; sellerId: string; orderId: string; revision: number; lease: string };

export function verifiedSale(raw: unknown, orderId: string, sellerId: string) {
  const order = orderSchema.parse(raw);
  if (order.id !== orderId || order.seller.id !== sellerId) throw Error("La orden no pertenece a la cuenta asociada.");
  if (order.status === "paid" && !order.date_closed) throw Error("La venta no tiene fecha de confirmación.");
  return { id: order.id, sellerId: order.seller.id, status: order.status, confirmedAt: order.date_closed ?? null,
    lines: order.order_items.map((line) => ({ itemId: line.item.id, variationId: line.item.variation_id ?? "0", quantity: line.quantity })) };
}

export async function enqueueSale(sellerId: string, orderId: string) {
  const result = await admin().rpc("enqueue_sale_stock", { p_seller: sellerId, p_order: orderId });
  if (result.error) throw Error("No se pudo guardar la notificación de venta.");
  return result.data === true;
}

export async function processNextSale() {
  const db = admin();
  const claimed = await db.rpc("claim_sale_stock");
  if (claimed.error) throw Error("No se pudo consultar la cola de ventas.");
  const job = claimed.data as SaleJob | null;
  if (!job) return false;
  try {
    const tokens = await access(job.ownerId, job.accountId);
    const response = await fetch(`https://api.mercadolibre.com/orders/${encodeURIComponent(job.orderId)}`, {
      headers: { Authorization: `Bearer ${tokens.access_token}`, "x-format-new": "true" },
      cache: "no-store", signal: AbortSignal.timeout(15000),
    });
    // A partial response must not become an irreversible, partially applied sale.
    if (response.status !== 200) throw Error("Consulta de orden incompleta.");
    const sale = verifiedSale(await response.json(), job.orderId, job.sellerId);
    const applied = await db.rpc("apply_sale_stock", { p_account: job.accountId, p_order: job.orderId,
      p_lease: job.lease, p_revision: job.revision, p_sale: sale });
    if (applied.error) throw Error("No se pudo registrar el descuento.");
  } catch {
    // Never persist tokens, raw API bodies or buyer details in error messages.
    const failed = await db.rpc("fail_sale_stock", { p_account: job.accountId, p_order: job.orderId, p_lease: job.lease,
      p_error: "No se pudo verificar o aplicar esta venta. Se reintentará automáticamente; si persiste, revisá la conexión de la cuenta." });
    if (failed.error) throw Error("No se pudo guardar el reintento de venta.");
  }
  return true;
}

// Database leases allow concurrent webhook/cron runs; expired claims are recovered.
export async function runStockWorker() {
  const deadline = Date.now() + 45000;
  let sales = 0, listings = 0;
  for (let i = 0; i < 20 && Date.now() < deadline; i++) {
    const sale = await processNextSale();
    if (sale) sales++;
    if (Date.now() >= deadline) break;
    const listing = await syncNextStock(null);
    if (listing) listings++;
    if (!sale && !listing) break;
  }
  return { sales, listings };
}
