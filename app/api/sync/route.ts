import { owner, fail } from "@/lib/server";
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
    return Response.json(dispatchQueryResult(result, selected), {
      headers: { "Cache-Control": "no-store" },
    });
  } catch (e) {
    return fail(e);
  }
}
