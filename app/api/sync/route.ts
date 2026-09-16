import { owner, fail } from "@/lib/server";
import { supplierReport } from "@/lib/supplier";
import { importOrders } from "@/lib/meli";
import { emptyState, today } from "@/lib/domain";
import { dateSchema } from "@/lib/commands";
import { dispatchQueryResult } from "@/lib/dispatch-query";
import { manualDispatches } from "@/lib/business";
import { accountFor, catalogState, requestedAccount, scopedBusiness } from "@/lib/inventory-server";
export const maxDuration = 300;
export async function POST(request: Request) {
  try {
    const id = await owner(request);
    const { date } = await request.json();
    const selected = dateSchema.parse(date);
    if (selected > today()) throw Error("Elegí una fecha hasta hoy.");
    const account = await accountFor(id, requestedAccount(request));
    const state = await catalogState(id, account.id);
    state.business = await scopedBusiness(id, account, state.business);
    const previous = emptyState();
    // Fetch explicitly confirmed older orders even outside the search window.
    previous.orders = Object.entries(state.business?.notes ?? {}).filter(([, note]) => note.dispatchedDate === selected).map(([id]) => ({ id, mode: "acordar", createdAt: "", cancelled: false, lines: [] }));
    const result = await importOrders(id, previous, selected, account.id);
    const query = dispatchQueryResult({ ...result, orders: manualDispatches(result.orders, state.business) }, selected);
    return Response.json({ ...query, notes: state.business?.notes ?? {}, supplier: supplierReport(state, query.orders, selected) }, {
      headers: { "Cache-Control": "no-store" },
    });
  } catch (e) {
    return fail(e);
  }
}
