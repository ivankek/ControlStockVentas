import { randomBytes } from "node:crypto";
import { cookies } from "next/headers";
import { owner, required, fail } from "@/lib/server";
import { sellerProfile } from "@/lib/inventory-server";
import { seal } from "@/lib/crypto";
import { nubeAuthorizationUrl } from "@/lib/tiendanube-auth";

export async function POST(request: Request) {
  try {
    const user = await owner(request);
    await sellerProfile(user);
    required("TIENDANUBE_CLIENT_SECRET");
    const state = randomBytes(32).toString("base64url");
    const url = nubeAuthorizationUrl(required("TIENDANUBE_CLIENT_ID"), state);
    (await cookies()).set("tiendanube_oauth", seal({ user, state, expires: Date.now() + 600000 }), {
      httpOnly: true, secure: required("APP_URL").startsWith("https:"), sameSite: "lax", maxAge: 600, path: "/api/tiendanube",
    });
    return Response.json({ url }, { headers: { "Cache-Control": "no-store" } });
  } catch (e) { return fail(e); }
}
