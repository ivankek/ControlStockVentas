import { access, get, type RawOrder } from "./meli";
import { normalizeShipment, type Shipment } from "./shipping";
import type { Sale } from "./profit";
export const amountCents = (value: unknown): number | undefined => typeof value === "number" && Number.isFinite(value) && value >= 0 && Number.isSafeInteger(Math.round(value * 100)) ? Math.round(value * 100) : undefined;

async function paymentNet(id: number, seller: number, token: string): Promise<number | undefined> {
  for (let attempt = 0; attempt < 3; attempt++) {
    const response = await fetch(`https://api.mercadopago.com/v1/payments/${id}`, { headers: { Authorization: `Bearer ${token}` }, cache: "no-store", signal: AbortSignal.timeout(15000) });
    if ([401, 403, 404].includes(response.status)) return undefined;
    if ([429, 500, 502, 503, 504].includes(response.status) && attempt < 2) { await new Promise((resolve) => setTimeout(resolve, 500 * (attempt + 1))); continue; }
    if (!response.ok) return undefined;
    const data = await response.json();
    if (String(data.id) !== String(id) || data.collector_id !== seller || data.currency_id !== "ARS" || data.status !== "approved" || data.transaction_amount_refunded > 0) return undefined;
    return amountCents(data.transaction_details?.net_received_amount);
  }
}
export async function salesPage(user: string, from: string, to: string, offset: number) {
  const tokens = await access(user);
  const page = await get<{ results: RawOrder[]; paging: { total: number } }>(`/orders/search?seller=${tokens.user_id}&order.date_created.from=${encodeURIComponent(from + "T00:00:00-03:00")}&order.date_created.to=${encodeURIComponent(to + "T23:59:59.999-03:00")}&sort=date_asc&offset=${offset}&limit=50`, tokens.access_token);
  if (!Array.isArray(page.results) || !Number.isInteger(page.paging?.total) || page.paging.total < 0 || (!page.results.length && offset < page.paging.total)) throw Error("La consulta de ventas quedó incompleta.");
  if (page.paging.total > 10000) throw Error("Hay más de 10.000 ventas en este tramo. Consultá un período menor.");
  const sales: Sale[] = [];
  const shipments = new Map<string, Promise<Shipment>>();
  const payments = new Map<number, Promise<number | undefined>>();
  // Small batches avoid saturating either service. Results stay in memory only.
  for (let i = 0; i < page.results.length; i += 4) {
    const batch = await Promise.all(page.results.slice(i, i + 4).map(async (raw): Promise<Sale> => {
      if (raw.seller?.id !== tokens.user_id || !Number.isSafeInteger(raw.id) || !Number.isFinite(Date.parse(raw.date_created)) || !Array.isArray(raw.order_items)) throw Error("Venta incompleta o de otra cuenta.");
      const sale: Sale = { id: String(raw.id), mode: "acordar", orderStatus: raw.status, createdAt: raw.date_created, cancelled: raw.status === "cancelled", lines: raw.order_items.map((line) => { if (!Number.isInteger(line.quantity) || line.quantity <= 0) throw Error("Cantidad inválida en la venta."); return { productId: `${line.item.id}:${line.item.variation_id ?? 0}`, quantity: line.quantity }; }), buyerName: raw.buyer?.nickname, grossCents: raw.currency_id === "ARS" ? amountCents(raw.total_amount) : undefined, paymentIds: [], issues: [] };
      if (sale.grossCents === undefined) sale.issues.push("Importe bruto en ARS no disponible");
      if (raw.shipping?.id) {
        const id = String(raw.shipping.id);
        if (!shipments.has(id)) shipments.set(id, get<Shipment>(`/shipments/${id}`, tokens.access_token).then(normalizeShipment));
        const shipment = await shipments.get(id)!;
        sale.shipmentId = id;
        sale.mode = shipment.logistic_type === "self_service" ? "flex" : shipment.mode === "me2" ? "correo" : "acordar";
        const address = shipment.destination?.shipping_address ?? shipment.receiver_address;
        sale.city = address?.city?.name; sale.province = address?.state?.name; sale.shippingStatus = shipment.status;
        if (shipment.logistic_type === "fulfillment") sale.review = "Full: revisar costos logísticos";
      }
      const approved = (raw.payments ?? []).filter((payment) => payment.status === "approved");
      sale.paymentIds = [...new Set(approved.map((payment) => String(payment.id)))];
      const nets = await Promise.all([...new Set(approved.map((payment) => payment.id))].map((id) => {
        if (!Number.isSafeInteger(id)) return Promise.resolve(undefined);
        if (!payments.has(id)) payments.set(id, paymentNet(id, tokens.user_id, tokens.access_token));
        return payments.get(id)!;
      }));
      if (nets.length && nets.every((value) => value !== undefined)) sale.receivedCents = nets.reduce<number>((sum, value) => sum + value!, 0);
      return sale;
    }));
    sales.push(...batch);
  }
  return { sales, total: page.paging.total, nextOffset: offset + page.results.length < page.paging.total ? offset + page.results.length : null };
}
