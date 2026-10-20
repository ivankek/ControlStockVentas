import { after } from "next/server";
import { admin, owner, fail } from "@/lib/server";
import { accountFor, requestedAccount, snapshot } from "@/lib/inventory-server";
import { fetchListings } from "@/lib/meli-listings";
import { meliSkuEntries, skuPlan } from "@/lib/sku";
import { syncPendingStock } from "@/lib/stock-sync";
export const maxDuration = 300;
export async function POST(request: Request) {
  try {
    const user = await owner(request), account = await accountFor(user, requestedAccount(request));
    const [items, inventory] = await Promise.all([fetchListings(user, account.id), snapshot(user)]);
    const plan = skuPlan(meliSkuEntries(items), inventory.variants);
    const { error } = await admin().rpc("sync_meli_sku", { p_actor: user, p_account: account.id, p_expected: account.catalog_version, p_items: items, p_links: plan.matches });
    if (error) throw Error(error.code === "P0001" ? error.message : "No se guardaron las asociaciones por SKU.");
    if (Object.keys(plan.matches).length) after(async () => { try { await syncPendingStock(user); } catch { console.error("Quedaron trabajos de stock pendientes tras asociar SKU."); } });
    return Response.json({ ...plan, matched: Object.keys(plan.matches).length }, { headers: { "Cache-Control": "no-store" } });
  } catch (e) { return fail(e); }
}
