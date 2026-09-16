import { owner, admin, fail } from "@/lib/server";
import { snapshot } from "@/lib/inventory-server";
import { inventoryCommand } from "@/lib/inventory";
export async function GET(request: Request) {
  try { return Response.json(await snapshot(await owner(request)), { headers: { "Cache-Control": "no-store" } }); }
  catch (e) { return fail(e); }
}
export async function POST(request: Request) {
  try {
    const user = await owner(request);
    const action = inventoryCommand.parse(await request.json());
    const { error } = await admin().rpc("inventory_command", { p_actor: user, p_action: action });
    if (error) throw Error(error.code === "P0001" ? error.message : "No se guardó el cambio. Revisá cantidades, variantes duplicadas y permisos.");
    return Response.json(await snapshot(user), { headers: { "Cache-Control": "no-store" } });
  } catch (e) { return fail(e); }
}
