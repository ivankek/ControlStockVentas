import { owner, readState, mutate, fail } from "@/lib/server";
import { importOrders, mergeImport } from "@/lib/meli";
export const maxDuration = 300;
export async function POST(request: Request) {
  try {
    const id = await owner(request);
    const { state } = await readState(id);
    const result = await importOrders(id, state);
    const next = await mutate(id, (s) => mergeImport(s, result));
    return Response.json({ state: next });
  } catch (e) {
    return fail(e);
  }
}
