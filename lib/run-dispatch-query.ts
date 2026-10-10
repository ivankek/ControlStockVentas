import { supplierReport } from "./supplier";
import { importOrders } from "./meli";
import { emptyState } from "./domain";
import { dispatchQueryResult } from "./dispatch-query";
import { carrierReport } from "./flex-carrier";
import { manualDispatches, resolveFlexShipments } from "./business";
import { accountFor, catalogState, scopedBusiness } from "./inventory-server";
export async function runDispatchQuery(id: string, account: Awaited<ReturnType<typeof accountFor>>, selected: string, start: string, progress?: (stage: string, done: number, total: number) => Promise<void>) {
 const began = Date.now();
    const state = await catalogState(id, account.id);
    state.business = await scopedBusiness(id, account, state.business);
    const previous = emptyState();
    // Fetch explicitly confirmed older orders even outside the search window.
    previous.orders = Object.entries(state.business?.notes ?? {}).filter(([, note]) => note.dispatchedDate && note.dispatchedDate >= start && note.dispatchedDate <= selected).map(([id]) => ({ id, mode: "acordar", createdAt: "", cancelled: false, lines: [] }));
    const result = await importOrders(id, previous, selected, account.id, start, progress);
    const query = dispatchQueryResult({ ...result, orders: manualDispatches(result.orders, state.business) }, selected, start);
    state.products = result.products;
    const days = [...new Set(query.orders.map((o) => o.dispatchedDate!))].sort().map((day) => ({ date: day, supplier: supplierReport(state, query.orders.filter((o) => o.dispatchedDate === day), day) }));
    const supplier = { rows: days.flatMap((d) => d.supplier.rows), orders: days.flatMap((d) => d.supplier.orders), totalCents: days.reduce((sum, d) => sum + d.supplier.totalCents, 0), complete: days.every((d) => d.supplier.complete) };
    const flex = resolveFlexShipments(state.business, result.orders);

 return { ...query, flex, carrier: carrierReport(query.orders, state.business), days, notes: state.business?.notes ?? {}, supplier, timings: { ...result.timings, totalMs: Date.now() - began } };
}
