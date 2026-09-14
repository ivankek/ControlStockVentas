import { owner, readState, mutate, admin, fail } from "@/lib/server";
import { applyCommand } from "@/lib/commands";
export async function GET(request: Request) {
  try {
    const id = await owner(request);
    const { state } = await readState(id);
    const { data, error } = await admin()
      .from("meli_connections")
      .select("seller_id")
      .eq("owner_id", id)
      .maybeSingle();
    if (error) throw Error("No se pudo consultar la conexión.");
    return Response.json(
      { state, connected: !!data },
      { headers: { "Cache-Control": "no-store" } },
    );
  } catch (e) {
    return fail(e);
  }
}
export async function POST(request: Request) {
  try {
    const id = await owner(request);
    const action = await request.json();
    const state = await mutate(id, (s) => applyCommand(s, action));
    return Response.json({ state });
  } catch (e) {
    return fail(e);
  }
}
