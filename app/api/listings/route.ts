import { owner, admin, fail } from "@/lib/server";
import { fetchListings } from "@/lib/meli-listings";
import { mergeListings } from "@/lib/listings";
import { accountFor, accountListings, catalogState, requestedAccount } from "@/lib/inventory-server";
export const maxDuration = 300;
async function response(user: string, account: string, counts = {}) {
  const state = await catalogState(user, account);
  return Response.json({ listings: state.listings ?? [], products: state.supplierProducts ?? [], links: state.supplierLinks ?? {}, ...counts }, { headers: { "Cache-Control": "no-store" } });
}
export async function GET(request: Request) {
  try { const user = await owner(request); const account = await accountFor(user, requestedAccount(request)); return await response(user, account.id); }
  catch (e) { return fail(e); }
}
export async function POST(request: Request) {
  try {
    const user = await owner(request), account = await accountFor(user, requestedAccount(request));
    const existing = await accountListings(account.id);
    const incoming = await fetchListings(user, account.id);
    const { added, updated, unchanged } = mergeListings(existing, incoming);
    if (added || updated) {
      const { error } = await admin().rpc("save_meli_catalog", { p_actor: user, p_account: account.id, p_expected: account.catalog_version, p_items: incoming });
      if (error) throw Error(error.code === "P0001" ? error.message : "No se guardó el catálogo. Intentá nuevamente.");
    }
    return await response(user, account.id, { added, updated, unchanged });
  } catch (e) { return fail(e); }
}
