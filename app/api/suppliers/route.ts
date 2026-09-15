import { owner, readState, mutate, fail } from "@/lib/server";
import { updateSupplier } from "@/lib/supplier";
import type { State } from "@/lib/domain";
function response(state: State) {
  return Response.json({ products: state.supplierProducts ?? [], links: state.supplierLinks ?? {} }, { headers: { "Cache-Control": "no-store" } });
}
export async function GET(request: Request) {
  try { return response((await readState(await owner(request))).state); } catch (e) { return fail(e); }
}
export async function POST(request: Request) {
  try {
    const id = await owner(request);
    const action = await request.json();
    return response(await mutate(id, (state) => updateSupplier(state, action)));
  } catch (e) { return fail(e); }
}
