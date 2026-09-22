import { resolveFlexShipments, type Business } from "./business";
import type { Order } from "./domain";

export function carrierReport(orders: Order[], business?: Business) {
  const eligible = orders.filter(o => o.mode === "flex" && o.dispatchedDate && !o.cancelled && o.orderStatus !== "cancelled" && o.shippingStatus !== "cancelled");
  const costs = resolveFlexShipments(business, eligible, o => o.dispatchedDate!);
  const groups = new Map<string, Order[]>();
  for (const order of eligible) {
    const key = order.shipmentId ? `shipment:${order.shipmentId}` : `order:${order.id}`;
    const siblings = groups.get(key) ?? [];
    if (!siblings.some(o => o.id === order.id)) siblings.push(order);
    groups.set(key, siblings);
  }
  const shipments = [...groups.values()].map(siblings => {
    const first = siblings[0];
    const dates = [...new Set(siblings.map(o => o.dispatchedDate!))].sort();
    const cost = costs[first.id];
    const issue = !first.shipmentId ? "Falta ID de envío para verificar el cobro" : dates.length !== 1 ? "Fechas de despacho contradictorias" : cost.cents === undefined ? cost.reason : undefined;
    return { shipmentId: first.shipmentId, orderIds: siblings.map(o => o.id), date: dates[0], zone: cost.zone, cents: issue ? undefined : cost.cents, baselineRate: cost.baselineRate, issue };
  }).sort((a,b) => a.date.localeCompare(b.date));
  return { shipments, totalCents: shipments.reduce((sum,s) => sum + (s.cents ?? 0), 0), pending: shipments.filter(s => s.cents === undefined).length };
}

export function carrierPeriod(mode: string, date: string, now: string) {
  const selected = new Date(`${date}T12:00:00Z`);
  let from = date, to = date;
  const day = (d: Date) => d.toISOString().slice(0,10);
  if (mode === "year") { from = date.slice(0,4) + "-01-01"; to = date.slice(0,4) + "-12-31"; }
  if (mode === "month") { from = date.slice(0,7) + "-01"; to = day(new Date(Date.UTC(selected.getUTCFullYear(), selected.getUTCMonth()+1,0))); }
  if (mode === "week") {
    selected.setUTCDate(selected.getUTCDate() - (selected.getUTCDay()+6)%7);
    from = day(selected); selected.setUTCDate(selected.getUTCDate()+6); to = day(selected);
  }
  return { from, date: to > now ? now : to };
}
