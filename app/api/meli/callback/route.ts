import { cookies } from "next/headers";
import { unseal } from "@/lib/crypto";
import { exchange, saveTokens } from "@/lib/meli";
import { required } from "@/lib/server";
export async function GET(request: Request) {
  const jar = await cookies();
  const value = jar.get("meli_oauth")?.value;
  jar.delete({ name: "meli_oauth", path: "/api/meli" });
  try {
    const url = new URL(request.url);
    if (!value) throw Error("missing");
    const data = unseal<{
      user: string;
      state: string;
      verifier: string;
      expires: number;
    }>(value);
    if (
      data.expires < Date.now() ||
      data.state !== url.searchParams.get("state") ||
      !url.searchParams.get("code")
    )
      throw Error("invalid");
    const tokens = await exchange({
      grant_type: "authorization_code",
      code: url.searchParams.get("code")!,
      redirect_uri: `${required("APP_URL")}/api/meli/callback`,
      code_verifier: data.verifier,
    });
    await saveTokens(data.user, tokens);
    return Response.redirect(`${required("APP_URL")}/?connection=ok`);
  } catch {
    return Response.redirect(`${required("APP_URL")}/?connection=error`);
  }
}
