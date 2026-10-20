import { z } from "zod";
import { admin, fail, owner } from "@/lib/server";
import { sellerProfile } from "@/lib/inventory-server";
import { saveNubeConnection } from "@/lib/tiendanube-auth";
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
    await saveNubeConnection(user, storeId, token);
    return GET(request);
  } catch (e) { return fail(e); }
}
