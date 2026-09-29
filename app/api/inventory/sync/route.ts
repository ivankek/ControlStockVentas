import { z } from "zod";
import { owner, admin, fail } from "@/lib/server";
import { syncNextStock } from "@/lib/stock-sync";
import { profile, requestedAccount } from "@/lib/inventory-server";
export const maxDuration = 120;
async function status(actor: string, selected: string | null) {
  const db = admin();
  const person = await profile(actor);
  // Suppliers can monitor publication writes for their products, but sales of
  // other users must not be disclosed through this general notification banner.
  if (person.role === "SUPPLIER") {
    const result = await db.rpc("stock_sync_status", { p_actor: actor });
    if (result.error) throw Error("No se pudo consultar la sincronización.");
    return { jobs: result.data, sales: [] };
  }
  let query = db.from("meli_accounts").select("id").eq("owner_id", actor);
  if (selected) query = query.eq("id", z.uuid().parse(selected));
  const accounts = await query;
  if (accounts.error) throw Error("No se pudieron consultar tus cuentas.");
  const ids = (accounts.data ?? []).map((a) => a.id);
  if (!ids.length) return { jobs: [], sales: [] };
  const [result, sales] = await Promise.all([
    db.from("listing_stock_jobs").select("account_id,item_id,status,error,updated_at,meli_listings(payload)").in("account_id", ids).order("status", { ascending: false }).order("updated_at", { ascending: false }).limit(200),
    db.from("sales_stock_jobs").select("account_id,order_id,status,error,warning,updated_at").in("account_id", ids).or("error.not.is.null,warning.not.is.null,status.neq.done").order("updated_at", { ascending: false }).limit(100),
  ]);
  if (result.error) throw Error("No se pudo consultar la sincronización. Aplicá la migración listing_stock_sync.");
  if (sales.error) throw Error("No se pudo consultar el descuento de ventas. Aplicá la migración sales_shared_stock.");
  return { jobs: result.data?.map(({ meli_listings, ...job }) => ({ ...job, title: (Array.isArray(meli_listings) ? meli_listings[0] : meli_listings)?.payload?.title ?? job.item_id })), sales: sales.data };
}
export async function GET(request: Request) {
  try { return Response.json(await status(await owner(request), requestedAccount(request)), { headers: { "Cache-Control": "no-store" } }); }
  catch (e) { return fail(e); }
}
export async function POST(request: Request) {
  try {
    const actor = await owner(request);
    const { retry } = z.object({ retry: z.boolean().default(false) }).parse(await request.json());
    const processed = await syncNextStock(actor, retry);
    return Response.json({ processed, ...await status(actor, requestedAccount(request)) }, { headers: { "Cache-Control": "no-store" } });
  } catch (e) { return fail(e); }
}
