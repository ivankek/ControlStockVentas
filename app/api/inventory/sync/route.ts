import { z } from "zod";
import { owner, admin, fail } from "@/lib/server";
import { syncNextStock } from "@/lib/stock-sync";
export const maxDuration = 120;
async function status(actor: string) {
  const [result, sales] = await Promise.all([
    admin().rpc("stock_sync_status", { p_actor: actor }),
    admin().rpc("sale_stock_status", { p_actor: actor }),
  ]);
  if (result.error) throw Error("No se pudo consultar la sincronización. Aplicá la migración listing_stock_sync.");
  if (sales.error) throw Error("No se pudo consultar el descuento de ventas. Aplicá la migración sales_shared_stock.");
  return { jobs: result.data, sales: sales.data };
}
export async function GET(request: Request) {
  try { return Response.json(await status(await owner(request)), { headers: { "Cache-Control": "no-store" } }); }
  catch (e) { return fail(e); }
}
export async function POST(request: Request) {
  try {
    const actor = await owner(request);
    const { retry } = z.object({ retry: z.boolean().default(false) }).parse(await request.json());
    const processed = await syncNextStock(actor, retry);
    return Response.json({ processed, ...await status(actor) }, { headers: { "Cache-Control": "no-store" } });
  } catch (e) { return fail(e); }
}
