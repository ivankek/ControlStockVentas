import { owner, readState, mutate, fail } from "@/lib/server";
import { businessCommand, emptyBusiness, updateBusiness } from "@/lib/business";
import { verifiedOrder } from "@/lib/meli";
export const maxDuration = 120;
export async function GET(request: Request) {
  try { return Response.json((await readState(await owner(request))).state.business ?? emptyBusiness(), { headers: { "Cache-Control": "no-store" } }); }
  catch (error) { return fail(error); }
}
export async function POST(request: Request) {
  try {
    const user = await owner(request);
    const action = businessCommand.parse(await request.json());
    const order = action.type === "note" ? await verifiedOrder(user, action.id) : undefined;
    const state = await mutate(user, (state) => updateBusiness(state, action, order));
    return Response.json(state.business, { headers: { "Cache-Control": "no-store" } });
  } catch (error) { return fail(error); }
}
