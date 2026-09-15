import { owner, fail, readState } from "@/lib/server";
import { supplierReport } from "@/lib/supplier";
import { importOrders } from "@/lib/meli";
import { emptyState, today } from "@/lib/domain";
import { dateSchema } from "@/lib/commands";
import { dispatchQueryResult } from "@/lib/dispatch-query";
export const maxDuration = 300;
export async function POST(request: Request) {
  try {
    const id = await owner(request);
    const { date } = await request.json();
    const selected = dateSchema.parse(date);
    if (selected > today()) throw Error("Elegí una fecha hasta hoy.");
    const result = await importOrders(id, emptyState(), selected);
    const query = dispatchQueryResult(result, selected);
    const { state } = await readState(id);
    return Response.json({ ...query, supplier: supplierReport(state, query.orders, selected) }, {
      headers: { "Cache-Control": "no-store" },
    });
  } catch (e) {
    return fail(e);
  }
}
