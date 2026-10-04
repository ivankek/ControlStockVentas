import test from "node:test";
import assert from "node:assert/strict";
import { POST } from "../app/api/profit/flex/route";
import { seal } from "../lib/crypto";
import { today } from "../lib/domain";

test("bonificaciones: autorización por cuenta propia antes de consultar facturación", async (t) => {
  for (const [key, value] of Object.entries({ NEXT_PUBLIC_SUPABASE_URL: "https://test.supabase.co", SUPABASE_SERVICE_ROLE_KEY: "test", TOKEN_ENCRYPTION_KEY: Buffer.alloc(32, 1).toString("base64") })) {
    const prior = process.env[key]; process.env[key] = value;
    t.after(() => { if (prior === undefined) delete process.env[key]; else process.env[key] = prior; });
  }
  const own = "00000000-0000-4000-8000-000000000042", foreign = "00000000-0000-4000-8000-000000000043";
  const encrypted = seal({ access_token: "own-token", refresh_token: "refresh", expires_at: Date.now() + 3600000, user_id: 42 });
  let role = "ADMIN", billed = 0;
  t.mock.method(globalThis, "fetch", async (input: string | URL | Request, init?: RequestInit) => {
    const url = new URL(input instanceof Request ? input.url : String(input));
    if (url.pathname === "/auth/v1/user") return Response.json({ id: "owner" });
    if (url.pathname.endsWith("/app_profiles")) return Response.json({ id: "owner", role });
    if (url.pathname.endsWith("/meli_accounts")) {
      assert.equal(url.searchParams.get("owner_id"), "eq.owner");
      if (url.searchParams.get("select") === "encrypted_tokens") return Response.json({ encrypted_tokens: encrypted });
      return Response.json(url.searchParams.get("id") === `eq.${own}` ? [{ id: own, owner_id: "owner", seller_id: "42" }] : []);
    }
    if (url.pathname.endsWith("/monthly/periods")) {
      assert.equal(new Headers(init?.headers).get("authorization"), "Bearer own-token");
      billed++; return Response.json({ results: [], total: 0 });
    }
    throw Error("Unexpected request " + url.pathname);
  });
  const request = (account: string) => new Request(`https://app.test/api/profit/flex?account=${account}`, { method: "POST", headers: { Authorization: "Bearer session" }, body: JSON.stringify({ from: today() }) });
  assert.equal((await POST(request(own))).status, 200);
  assert.equal(billed, 2);
  assert.equal((await POST(request(foreign))).status, 400);
  role = "SUPPLIER";
  assert.equal((await POST(request(own))).status, 403);
  assert.equal(billed, 2);
  assert.equal((await POST(new Request("https://app.test/api/profit/flex", { method: "POST" }))).status, 401);
});
