import { cookies } from "next/headers";
import { unseal } from "@/lib/crypto";
import { required } from "@/lib/server";
import { sellerProfile } from "@/lib/inventory-server";
import { exchangeNubeCode, saveNubeConnection, validNubeState } from "@/lib/tiendanube-auth";

export const maxDuration = 120;
export async function GET(request: Request) {
  const jar = await cookies();
  const value = jar.get("tiendanube_oauth")?.value;
  jar.delete({ name: "tiendanube_oauth", path: "/api/tiendanube" });
  const target = new URL("/", required("APP_URL"));
  target.searchParams.set("platform", "tiendanube");
  try {
    const params = new URL(request.url).searchParams;
    if (!value) throw Error("missing");
    const data = unseal<{ user: string; state: string; expires: number }>(value);
    const code = params.get("code");
    if (!validNubeState(data, params.get("state")) || !code || params.has("error")) throw Error("invalid");
    await sellerProfile(data.user);
    const tokens = await exchangeNubeCode(code);
    await saveNubeConnection(data.user, tokens.user_id, tokens.access_token);
    target.searchParams.set("connection", "ok");
  } catch {
    target.searchParams.set("connection", "error");
  }
  return Response.redirect(target, 303);
}
