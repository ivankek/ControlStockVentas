import { owner, readState, mutate, fail } from "@/lib/server";
import { businessCommand, emptyBusiness, updateBusiness } from "@/lib/business";
import { verifiedOrder } from "@/lib/meli";
import { accountFor, requestedAccount, scopedBusiness, sellerProfile } from "@/lib/inventory-server";
export const maxDuration = 120;
export async function GET(request: Request) {
  try {
    const user = await owner(request); await sellerProfile(user);
    let business = (await readState(user)).state.business ?? emptyBusiness();
    if (requestedAccount(request)) business = await scopedBusiness(user, await accountFor(user, requestedAccount(request)), business);
    return Response.json(business, { headers: { "Cache-Control": "no-store" } });
  }
  catch (error) { return fail(error); }
}
export async function POST(request: Request) {
  try {
    const user = await owner(request);
    await sellerProfile(user);
    const action = businessCommand.parse(await request.json());
    const account = action.type === "note" ? await accountFor(user, requestedAccount(request)) : undefined;
    const order = action.type === "note" ? await verifiedOrder(user, action.id, account!.id) : undefined;
    const state = await mutate(user, (state) => {
      const next = updateBusiness(state, action, order);
      if (action.type === "note") next.business!.notes[action.id].accountId = account!.id;
      return next;
    });
    return Response.json(state.business, { headers: { "Cache-Control": "no-store" } });
  } catch (error) { return fail(error); }
}
