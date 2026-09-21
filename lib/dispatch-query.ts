import type { Order, Product } from "./domain";

export function dispatchQueryResult(result: { orders: Order[]; products: Product[]; syncedAt: string }, date: string, from = date) {
  return {
    date,
    from,
    queriedAt: result.syncedAt,
    orders: result.orders.filter((o) => o.dispatchedDate && o.dispatchedDate >= from && o.dispatchedDate <= date),
    unverified: result.orders.filter((o) => !o.dispatchedDate),
    products: result.products,
    warning: "Se consultan ventas creadas desde 90 días antes del inicio hasta el fin del período elegido. Una venta anterior puede quedar fuera. La fecha corresponde al estado enviado registrado por Mercado Libre, en horario argentino.",
  };
}
export type DispatchDay = { date: string; supplier: ReturnType<typeof import("./supplier").supplierReport> };
export type DispatchQueryResult = ReturnType<typeof dispatchQueryResult> & { flex?: Record<string, ReturnType<typeof import("./business").resolveFlex>>; days?: DispatchDay[]; notes?: Record<string, import("./business").OrderNote>; supplier?: ReturnType<typeof import("./supplier").supplierReport> };

export function dispatchMessage(days: DispatchDay[]) {
  const amount = (cents: number) => "$" + new Intl.NumberFormat("es-AR", { maximumFractionDigits: 2 }).format(cents / 100);
  const ordered = [...days].sort((a, b) => a.date.localeCompare(b.date));
  const parts = ordered.map(({ date, supplier }) => {
    const weekday = new Intl.DateTimeFormat("es-AR", { weekday: "long", timeZone: "UTC" }).format(new Date(`${date}T12:00:00Z`));
    const heading = `${weekday[0].toUpperCase()}${weekday.slice(1)} ${date.slice(8)}/${date.slice(5, 7)}:`;
    return [heading, ...supplier.rows.map((r) => `${r.name} x ${r.units}u = ${amount(r.totalCents)}`), ...(!supplier.complete ? ["Pendiente de revisión: faltan costos/asociaciones o hay pedidos con incidencias."] : [])].join("\n");
  });
  const complete = ordered.every((d) => d.supplier.complete);
  return [...parts, `${complete ? "Total" : "Subtotal parcial (a revisar)"} = ${amount(ordered.reduce((sum, d) => sum + d.supplier.totalCents, 0))}`].join("\n\n");
}
