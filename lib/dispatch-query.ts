import type { Order, Product } from "./domain";

export function dispatchQueryResult(result: { orders: Order[]; products: Product[]; syncedAt: string }, date: string) {
  return {
    date,
    queriedAt: result.syncedAt,
    orders: result.orders.filter((o) => o.dispatchedDate === date),
    unverified: result.orders.filter((o) => !o.dispatchedDate),
    products: result.products,
    warning: "Se consultan ventas creadas desde 90 días antes hasta el día elegido. Una venta anterior puede quedar fuera. La fecha corresponde al estado enviado registrado por Mercado Libre, en horario argentino.",
  };
}
export type DispatchQueryResult = ReturnType<typeof dispatchQueryResult> & { supplier?: ReturnType<typeof import("./supplier").supplierReport> };
