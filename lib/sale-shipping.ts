import { get, type RawOrder } from "./meli";
import { normalizeShipment, type Shipment } from "./shipping";

export type ShippingDiscount = { rate?: number; type?: string; promoted_amount?: number };
type Costs = { gross_amount?: unknown; receiver?: { cost?: unknown }; senders?: { user_id?: number | string; cost?: unknown; discounts?: ShippingDiscount[] }[] };
export type SaleShipping = {
  isFlex: boolean | null; shippingLogisticType: string | null;
  shippingGrossCents: number | null; buyerShippingCostCents: number | null;
  sellerShippingCostCents: number | null; shippingDiscounts: ShippingDiscount[] | null;
  shippingPromotedCents: number | null; shippingError?: string;
};
const cents = (n: unknown) => typeof n === "number" && Number.isFinite(n) && n >= 0 && Number.isSafeInteger(Math.round(n * 100)) ? Math.round(n * 100) : null;
const identifier = (n: unknown) => typeof n === "number" && Number.isSafeInteger(n) && n > 0 ? String(n) : typeof n === "string" && /^[1-9]\d*$/.test(n) ? n : undefined;
export function parseShippingCosts(raw: Costs, seller: number) {
  const senders = Array.isArray(raw.senders) ? raw.senders.filter((s) => s && typeof s === "object") : [];
  const matching = senders.filter((s) => String(s.user_id) === String(seller));
  // An unlabelled singleton is permitted; an explicitly different seller is not.
  const sender = matching.length === 1 ? matching[0] : senders.length === 1 && senders[0].user_id == null ? senders[0] : undefined;
  const discounts = sender && Array.isArray(sender.discounts)
    ? sender.discounts.filter((d) => d && typeof d === "object").map((d) => ({ ...(typeof d.type === "string" ? { type: d.type } : {}), ...(typeof d.rate === "number" && Number.isFinite(d.rate) ? { rate: d.rate } : {}), ...(cents(d.promoted_amount) !== null ? { promoted_amount: d.promoted_amount } : {}) })) : null;
  const promoted = discounts?.reduce((sum, d) => sum + (cents(d.promoted_amount) ?? 0), 0) ?? null;
  return { shippingGrossCents: cents(raw.gross_amount), buyerShippingCostCents: cents(raw.receiver?.cost), sellerShippingCostCents: cents(sender?.cost), shippingDiscounts: discounts, shippingPromotedCents: promoted !== null && Number.isSafeInteger(promoted) ? promoted : null };
}

// Request-local promise caches also deduplicate concurrent orders and failed lookups.
export function createSaleShippingResolver(token: string, seller: number) {
  const packs = new Map<string, Promise<{ id?: number; shipment?: { id?: number } | null; orders?: { id: number }[] }>>();
  const shipments = new Map<string, Promise<Shipment>>();
  const costs = new Map<string, Promise<Costs>>();
  function cached<T>(cache: Map<string, Promise<T>>, id: string, path: string) {
    if (!cache.has(id)) {
      if (cache.size >= 2000) cache.delete(cache.keys().next().value!);
      cache.set(id, get<T>(path, token));
    }
    return cache.get(id)!;
  }
  return async (order: RawOrder): Promise<{ info: SaleShipping; shipmentId?: string; shipment?: Shipment }> => {
    const info: SaleShipping = { isFlex: null, shippingLogisticType: null, shippingGrossCents: null, buyerShippingCostCents: null, sellerShippingCostCents: null, shippingDiscounts: null, shippingPromotedCents: null };
    let shipmentId = identifier(order.shipping?.id);
    let shipment: Shipment | undefined;
    let stage = "paquete";
    try {
      // Reuse the shipment ID supplied by the already authorized order when present.
      if (!shipmentId && order.pack_id != null) {
        const packId = identifier(order.pack_id);
        if (!packId) throw Error("ID de paquete inválido");
        const pack = await cached(packs, packId, `/packs/${packId}`);
        if (String(pack.id) !== packId || !pack.orders?.some((o) => String(o.id) === String(order.id))) throw Error("El paquete no corresponde a esta orden");
        shipmentId = identifier(pack.shipment?.id);
        if (pack.shipment?.id != null && !shipmentId) throw Error("ID de envío inválido");
      }
      if (!shipmentId) return { info };
      stage = `envío ${shipmentId}`;
      shipment = normalizeShipment(await cached(shipments, shipmentId, `/shipments/${shipmentId}`));
      if (String(shipment.id) !== shipmentId) { shipment = undefined; throw Error("El envío recibido no coincide"); }
      info.shippingLogisticType = shipment.logistic_type ?? null;
      info.isFlex = shipment.logistic_type ? shipment.logistic_type === "self_service" : null;
      stage = `costos del envío ${shipmentId}`;
      Object.assign(info, parseShippingCosts(await cached(costs, shipmentId, `/shipments/${shipmentId}/costs`), seller));
      if (info.sellerShippingCostCents === null) info.shippingError = "Mercado Libre no informó un costo final identificable para tu vendedor.";
    } catch (error) {
      info.shippingError = `No se pudo consultar ${stage}: ${error instanceof Error ? error.message : "respuesta incompleta"}`;
    }
    return { info, shipmentId, shipment };
  };
}

// Best-effort reuse between pages on the same server instance. Never share across
// accounts, sessions or user-triggered queries; no data is written to the DB.
const queries = new Map<string, { token: string; expires: number; resolve: ReturnType<typeof createSaleShippingResolver> }>();
export function shippingResolverForQuery(token: string, seller: number, scope?: string) {
  if (!scope) return createSaleShippingResolver(token, seller);
  const now = Date.now();
  for (const [key, entry] of queries) if (entry.expires <= now) queries.delete(key);
  const key = `${seller}:${scope}`;
  const found = queries.get(key);
  if (found && found.token === token) return found.resolve;
  if (queries.size >= 8) queries.delete(queries.keys().next().value!);
  const resolve = createSaleShippingResolver(token, seller);
  queries.set(key, { token, expires: now + 5 * 60000, resolve });
  return resolve;
}
