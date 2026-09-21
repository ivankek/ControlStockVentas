import { owner, fail } from "@/lib/server";
import { supplierReport } from "@/lib/supplier";
import { importOrders } from "@/lib/meli";
import { emptyState, today } from "@/lib/domain";
import { dateSchema } from "@/lib/commands";
import { dispatchQueryResult } from "@/lib/dispatch-query";
import { manualDispatches, resolveFlexShipments } from "@/lib/business";
import { accountFor, catalogState, requestedAccount, scopedBusiness } from "@/lib/inventory-server";
export const maxDuration = 300;
export async function POST(request: Request) {
  try {
    const id = await owner(request);
    const { date, from } = await request.json();
    const selected = dateSchema.parse(date);
    const start = dateSchema.parse(from ?? date);
    if (start > selected) throw Error("La fecha desde debe ser anterior o igual a la fecha hasta.");
    if (selected > today()) throw Error("Elegí una fecha hasta hoy.");
    const account = await accountFor(id, requestedAccount(request));
    const state = await catalogState(id, account.id);
    state.business = await scopedBusiness(id, account, state.business);
    const previous = emptyState();
    // Fetch explicitly confirmed older orders even outside the search window.
    previous.orders = Object.entries(state.business?.notes ?? {}).filter(([, note]) => note.dispatchedDate && note.dispatchedDate >= start && note.dispatchedDate <= selected).map(([id]) => ({ id, mode: "acordar", createdAt: "", cancelled: false, lines: [] }));
    const result = await importOrders(id, previous, selected, account.id, start);
    const query = dispatchQueryResult({ ...result, orders: manualDispatches(result.orders, state.business) }, selected, start);
    const days = [...new Set(query.orders.map((o) => o.dispatchedDate!))].sort().map((day) => ({ date: day, supplier: supplierReport(state, query.orders.filter((o) => o.dispatchedDate === day), day) }));
    const supplier = { rows: days.flatMap((d) => d.supplier.rows), orders: days.flatMap((d) => d.supplier.orders), totalCents: days.reduce((sum, d) => sum + d.supplier.totalCents, 0), complete: days.every((d) => d.supplier.complete) };
    const flex = resolveFlexShipments(state.business, result.orders);
    return Response.json({ ...query, flex, days, notes: state.business?.notes ?? {}, supplier }, {
      headers: { "Cache-Control": "no-store" },
    });
  } catch (e) {
    return fail(e);
  }
}
