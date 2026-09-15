export type Mode = "flex" | "correo" | "acordar";
export type Product = {
  id: string;
  name: string;
  costs: { from: string; cents: number }[];
};
export type Order = {
  id: string;
  shipmentId?: string;
  shippingStatus?: string;
  orderStatus?: string;
  buyerName?: string;
  receiverName?: string;
  province?: string;
  city?: string;
  mode: Mode;
  createdAt: string;
  expectedDate?: string;
  dispatchedDate?: string;
  suggestedDate?: string;
  evidence?: string;
  cancelled: boolean;
  review?: string;
  lines: { productId: string; quantity: number }[];
};
export type Settlement = {
  id: string;
  date: string;
  paidAt: string;
  orderIds: string[];
  rows: {
    productId: string;
    name: string;
    quantity: number;
    unitCents: number;
    subtotal: number;
  }[];
  total: number;
};
export type State = {
  listings?: import("./listings").Listing[];
  products: Product[];
  orders: Order[];
  settlements: Settlement[];
  syncedAt?: string;
  syncWarning?: string;
};
export const emptyState = (): State => ({
  products: [],
  orders: [],
  settlements: [],
});
export const today = () =>
  new Intl.DateTimeFormat("en-CA", {
    timeZone: "America/Argentina/Buenos_Aires",
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
  }).format(new Date());
export const localDate = (iso: string) =>
  new Intl.DateTimeFormat("en-CA", {
    timeZone: "America/Argentina/Buenos_Aires",
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
  }).format(new Date(iso));
export const money = (cents: number) =>
  new Intl.NumberFormat("es-AR", {
    style: "currency",
    currency: "ARS",
    maximumFractionDigits: cents % 100 ? 2 : 0,
  }).format(cents / 100);
export function flexDate(iso: string) {
  const date = new Date(new Date(iso).getTime() - 3 * 3600000);
  if (date.getUTCHours() >= 13) date.setUTCDate(date.getUTCDate() + 1);
  if (date.getUTCDay() === 0) date.setUTCDate(date.getUTCDate() + 1);
  return date.toISOString().slice(0, 10);
}
export function costAt(p: Product | undefined, date: string) {
  return p?.costs
    .filter((c) => c.from <= date)
    .sort((a, b) => b.from.localeCompare(a.from))[0]?.cents;
}
export function summary(state: State, date: string) {
  const paid = new Set(state.settlements.flatMap((s) => s.orderIds));
  const orders = state.orders.filter(
    (o) => o.dispatchedDate === date && !paid.has(o.id),
  );
  const rows = new Map<
    string,
    {
      productId: string;
      name: string;
      quantity: number;
      unitCents: number;
      subtotal: number;
    }
  >();
  const missing = new Set<string>();
  for (const o of orders)
    for (const line of o.lines) {
      const p = state.products.find((p) => p.id === line.productId);
      const cost = costAt(p, date);
      if (cost === undefined) {
        missing.add(p?.name ?? line.productId);
        continue;
      }
      const row = rows.get(line.productId) ?? {
        productId: line.productId,
        name: p?.name ?? line.productId,
        quantity: 0,
        unitCents: cost,
        subtotal: 0,
      };
      row.quantity += line.quantity;
      row.subtotal += cost * line.quantity;
      rows.set(line.productId, row);
    }
  return {
    orders,
    rows: [...rows.values()],
    missing: [...missing],
    total: [...rows.values()].reduce((s, r) => s + r.subtotal, 0),
  };
}
export function confirmDispatch(state: State, id: string, date: string) {
  const o = state.orders.find((o) => o.id === id);
  if (!o) throw Error("Pedido inexistente.");
  if (o.cancelled) throw Error("El pedido está cancelado.");
  if (state.settlements.some((s) => s.orderIds.includes(id)))
    throw Error("Este pedido ya fue liquidado.");
  if (o.dispatchedDate)
    throw Error("El pedido ya tiene un despacho confirmado.");
  if (date > today() || date < localDate(o.createdAt))
    throw Error("Revisá la fecha del despacho.");
  o.dispatchedDate = date;
  o.evidence = "Confirmado manualmente";
  if (
    [
      "Validar la fecha de despacho con un pedido real",
      "Entregado sin fecha de despacho verificable",
    ].includes(o.review ?? "")
  )
    delete o.review;
}
export function settle(state: State, date: string) {
  const s = summary(state, date);
  if (!s.orders.length)
    throw Error("No hay despachos pendientes de pago para esta fecha.");
  if (s.missing.length)
    throw Error("Completá los costos antes de registrar el pago.");
  if (s.orders.some((o) => o.review || o.cancelled))
    throw Error("Hay pedidos con incidencias que requieren revisión.");
  const settlement: Settlement = {
    id: crypto.randomUUID(),
    date,
    paidAt: new Date().toISOString(),
    orderIds: s.orders.map((o) => o.id),
    rows: s.rows,
    total: s.total,
  };
  state.settlements.unshift(settlement);
  return settlement;
}
export function sampleState(): State {
  const date = today();
  const names = [
    "Cepillos limpieza",
    "Calentador cera",
    "Manteca squishy",
    "Bandejita para helados",
    "Seca ropa portátil",
  ];
  const costs = [32500, 25000, 20000, 20000, 22500];
  const qty = [8, 2, 3, 4, 4];
  return {
    products: names.map((name, i) => ({
      id: `DEMO-${i + 1}`,
      name,
      costs: [{ from: "2020-01-01", cents: costs[i] * 100 }],
    })),
    orders: [
      ...names.map((_, i) => ({
        id: `EJEMPLO-${1041 + i}`,
        mode: i % 2 ? ("correo" as const) : ("flex" as const),
        createdAt: `${date}T09:00:00-03:00`,
        dispatchedDate: date,
        evidence: "Despacho de ejemplo",
        cancelled: false,
        lines: [{ productId: `DEMO-${i + 1}`, quantity: qty[i] }],
      })),
      {
        id: "EJEMPLO-1046",
        mode: "acordar",
        createdAt: `${date}T10:00:00-03:00`,
        cancelled: false,
        lines: [{ productId: "DEMO-3", quantity: 1 }],
      },
    ],
    settlements: [],
  };
}
