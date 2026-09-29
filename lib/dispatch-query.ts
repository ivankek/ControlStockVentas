import type { Order, Product } from "./domain";

export function dispatchQueryResult(result: { orders: Order[]; products: Product[]; syncedAt: string }, date: string, from = date) {
  return {
    date,
    from,
    queriedAt: result.syncedAt,
    orders: result.orders.filter((o) => o.dispatchedDate && o.dispatchedDate >= from && o.dispatchedDate <= date),
    unverified: result.orders.filter((o) => !o.dispatchedDate),
    products: result.products,
    warning: "Los resultados incluyen únicamente despachos del período elegido, en horario argentino. Para encontrar compras anteriores despachadas en estas fechas, se revisan ventas creadas hasta 90 días antes del inicio. Las compras más antiguas pueden quedar fuera.",
  };
}
export type DispatchDay = { date: string; supplier: ReturnType<typeof import("./supplier").supplierReport> };
export type DispatchQueryResult = ReturnType<typeof dispatchQueryResult> & { flex?: Record<string, ReturnType<typeof import("./business").resolveFlex>>; days?: DispatchDay[]; notes?: Record<string, import("./business").OrderNote>; supplier?: ReturnType<typeof import("./supplier").supplierReport> };

export type DispatchFilters = { from: string; to: string; shipping: string; order: string; reviewOnly: boolean; sort: string };
export function filterDispatchOrders(result: DispatchQueryResult, filters: DispatchFilters) {
  const reviews = new Set(result.supplier?.orders.filter((o) => o.missing.length || o.review).map((o) => o.orderId));
  const needsReview = (o: Order) => reviews.has(o.id) || o.cancelled || !!o.review;
  return result.orders.filter((o) => (!filters.from || (o.dispatchedDate ?? "") >= filters.from)
    && (!filters.to || (o.dispatchedDate ?? "") <= filters.to)
    && (!filters.shipping || (o.shippingStatus ?? "unknown") === filters.shipping)
    && (!filters.order || (o.orderStatus ?? "unknown") === filters.order)
    && (!filters.reviewOnly || needsReview(o)))
    .sort((a, b) => {
      const date = (a.dispatchedDate ?? "").localeCompare(b.dispatchedDate ?? "");
      if (filters.sort === "review") return Number(needsReview(b)) - Number(needsReview(a)) || -date || a.id.localeCompare(b.id);
      if (filters.sort === "status") return (a.shippingStatus ?? "").localeCompare(b.shippingStatus ?? "") || -date || a.id.localeCompare(b.id);
      return (filters.sort === "asc" ? date : -date) || a.id.localeCompare(b.id);
    });
}

export function dispatchMessage(days: DispatchDay[]) {
  const amount = (cents: number) => "$" + new Intl.NumberFormat("es-AR", { maximumFractionDigits: 2 }).format(cents / 100);
  const ordered = [...days].sort((a, b) => a.date.localeCompare(b.date));
  const parts = ordered.map(({ date, supplier }) => {
    const weekday = new Intl.DateTimeFormat("es-AR", { weekday: "long", timeZone: "UTC" }).format(new Date(`${date}T12:00:00Z`));
    const heading = `${weekday[0].toUpperCase()}${weekday.slice(1)} ${date.slice(8)}/${date.slice(5, 7)}:`;
    const issues = supplier.orders.filter((o) => o.missing.length || o.review).map((o) => `Pendiente de revisión · Orden ${o.orderId}: ${[...o.missing, ...(o.reviewReasons ?? (o.review ? ["Revisar incidencia del pedido."] : []))].join("; ")}`);
    return [heading, ...supplier.rows.map((r) => `${r.name} x ${r.units}u = ${amount(r.totalCents)}`), ...issues].join("\n");
  });
  const complete = ordered.every((d) => d.supplier.complete);
  return [...parts, `${complete ? "Total" : "Subtotal parcial (a revisar)"} = ${amount(ordered.reduce((sum, d) => sum + d.supplier.totalCents, 0))}`].join("\n\n");
}
