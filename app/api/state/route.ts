import { owner, readState, fail } from "@/lib/server";
import { snapshot } from "@/lib/inventory-server";
export async function GET(request: Request) {
  try {
    const id = await owner(request);
    const { state } = await readState(id);
    const inventory = await snapshot(id);
    return Response.json(
      { state, connected: inventory.accounts.some((a) => a.owner_id === id), inventory },
      { headers: { "Cache-Control": "no-store" } },
    );
  } catch (e) {
    return fail(e);
  }
}
export async function POST(request: Request) {
  try {
    await owner(request);
    return Response.json({ error: "Esta operación pertenece al modelo anterior. Actualizá la aplicación." }, { status: 409 });
  } catch (e) {
    return fail(e);
  }
}
