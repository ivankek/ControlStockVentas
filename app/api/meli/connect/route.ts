import { randomBytes, createHash } from "node:crypto";
import { cookies } from "next/headers";
import { owner, required, fail } from "@/lib/server";
import { seal } from "@/lib/crypto";
export async function POST(request: Request) {
  try {
    const user = await owner(request);
    const state = randomBytes(24).toString("base64url");
    const verifier = randomBytes(48).toString("base64url");
    const origin = required("APP_URL");
    const url = new URL("https://auth.mercadolibre.com.ar/authorization");
    url.search = new URLSearchParams({
      response_type: "code",
      client_id: required("MELI_CLIENT_ID"),
      redirect_uri: `${origin}/api/meli/callback`,
      state,
      code_challenge: createHash("sha256").update(verifier).digest("base64url"),
      code_challenge_method: "S256",
    }).toString();
    (await cookies()).set(
      "meli_oauth",
      seal({ user, state, verifier, expires: Date.now() + 600000 }),
      {
        httpOnly: true,
        secure: origin.startsWith("https:"),
        sameSite: "lax",
        maxAge: 600,
        path: "/api/meli",
      },
    );
    return Response.json({ url: url.toString() });
  } catch (e) {
    return fail(e);
  }
}
