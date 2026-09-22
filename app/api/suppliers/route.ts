// Catalog mutations now require provider ownership and use /api/inventory.
import { owner, fail } from "@/lib/server";
import { snapshot } from "@/lib/inventory-server";
export async function GET(request: Request) {
  try { const data = await snapshot(await owner(request)); return Response.json({ products: data.variants.map((v) => ({ id: v.id, name: v.product_name, costs: v.costs })), links: {} }); }
  catch (e) { return fail(e); }
}
export async function POST() { return Response.json({ error: "Actualizá la aplicación: administrá los productos en Stock y sus asociaciones en Publicaciones." }, { status: 409 }); }
