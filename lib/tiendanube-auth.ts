import { z } from "zod";
import { createHmac, timingSafeEqual } from "node:crypto";
import { admin, required } from "./server";
import { seal } from "./crypto";
import { nubeGet } from "./tiendanube";
import { localName } from "./tiendanube-catalog";

export function nubeAuthorizationUrl(clientId: string, state: string) {
  if (!/^\d+$/.test(clientId)) throw Error("TIENDANUBE_CLIENT_ID inválido.");
  const url = new URL(`https://www.tiendanube.com/apps/${clientId}/authorize`);
  url.searchParams.set("state", state);
  return url.toString();
}

export function validNubeState(data: { state: string; expires: number }, state: string | null, now = Date.now()) {
  return !!state && data.state === state && Number.isFinite(data.expires) && data.expires > now;
}

export function validNubeSignature(body: string, signature: string | null, secret: string) {
  if (!signature || !/^[a-f0-9]{64}$/i.test(signature)) return false;
  return timingSafeEqual(createHmac("sha256", secret).update(body).digest(), Buffer.from(signature, "hex"));
}

export async function saveNubeConnection(user: string, storeId: string, token: string) {
  const store = z.object({ id: z.union([z.number(), z.string()]), name: z.union([z.string(), z.record(z.string(), z.string())]) }).parse(await nubeGet(storeId, token, "/store"));
  if (String(store.id) !== storeId) throw Error("El token no corresponde a esa tienda.");
  await nubeGet(storeId, token, "/products?per_page=1");
  const { error } = await admin().rpc("save_tiendanube_account", {
    p_actor: user, p_store: storeId,
    p_name: typeof store.name === "string" ? store.name : localName(store.name), p_token: seal({ token }),
  });
  if (error) throw Error(error.code === "P0001" ? error.message : "No se pudo guardar la conexión.");
}

export async function exchangeNubeCode(code: string) {
  const response = await fetch("https://www.tiendanube.com/apps/authorize/token", {
    method: "POST", headers: { "Content-Type": "application/json" }, cache: "no-store",
    signal: AbortSignal.timeout(30000),
    body: JSON.stringify({ client_id: required("TIENDANUBE_CLIENT_ID"), client_secret: required("TIENDANUBE_CLIENT_SECRET"), grant_type: "authorization_code", code }),
  });
  if (!response.ok) throw Error("Tiendanube no pudo completar la autorización.");
  return z.object({ access_token: z.string().min(10), user_id: z.union([z.number().int().positive(), z.string().regex(/^\d+$/)]).transform(String) }).parse(await response.json());
}
