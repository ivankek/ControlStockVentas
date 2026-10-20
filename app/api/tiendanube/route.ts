import { z } from "zod";
import { admin, fail, owner } from "@/lib/server";
import { sellerProfile } from "@/lib/inventory-server";
import { seal } from "@/lib/crypto";
import { nubeGet } from "@/lib/tiendanube";
import { localName } from "@/lib/tiendanube-catalog";
export const maxDuration = 120;
const credentials = z.object({ storeId: z.string().trim().regex(/^\d+$/), token: z.string().trim().min(10).max(4096) });
export async function GET(request: Request) {
  try {
    const user = await owner(request); await sellerProfile(user);
    const { data, error } = await admin().from("tiendanube_accounts").select("id,store_id,name").eq("owner_id", user).order("name");
    if (error) throw Error("No se pudieron consultar las tiendas conectadas.");
    return Response.json({ accounts: data }, { headers: { "Cache-Control": "no-store" } });
  } catch (e) { return fail(e); }
}
export async function POST(request: Request) {
  try {
    const user = await owner(request); await sellerProfile(user);
    const { storeId, token } = credentials.parse(await request.json());
    const store = z.object({ id: z.union([z.number(), z.string()]), name: z.union([z.string(), z.record(z.string(), z.string())]) }).parse(await nubeGet(storeId, token, "/store"));
    if (String(store.id) !== storeId) throw Error("El token no corresponde a esa tienda.");
    // Confirm catalog scope before storing credentials.
    await nubeGet(storeId, token, "/products?per_page=1");
    const { error } = await admin().rpc("save_tiendanube_account", { p_actor: user, p_store: storeId, p_name: typeof store.name === "string" ? store.name : localName(store.name), p_token: seal({ token }) });
    if (error) throw Error(error.code === "P0001" ? error.message : "No se pudo guardar la conexión.");
    return GET(request);
  } catch (e) { return fail(e); }
}
