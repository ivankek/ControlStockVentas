import test from "node:test";
import assert from "node:assert/strict";
import { GET, POST } from "../app/api/inventory/route";
import { GET as listings } from "../app/api/listings/route";
import { accountFor } from "../lib/inventory-server";
import { access } from "../lib/meli";
import { seal } from "../lib/crypto";
import { accountFixture, snapshotFixture } from "./inventory-fixture";
test("API verifica actor autenticado, cuenta propietaria y rol; nunca devuelve credenciales", async (t) => {
  for (const [key, value] of Object.entries({ NEXT_PUBLIC_SUPABASE_URL: "https://test.supabase.co", SUPABASE_SERVICE_ROLE_KEY: "test", TOKEN_ENCRYPTION_KEY: Buffer.alloc(32, 1).toString("base64") })) {
    const old = process.env[key]; process.env[key] = value; t.after(() => { if (old === undefined) delete process.env[key]; else process.env[key] = old; });
  }
  let role = "USER", multiple = false, foreign = false, commands = 0;
  const encrypted = seal({ user_id: 42, access_token: "secret", refresh_token: "refresh-secret", expires_at: Date.now() + 3600000 });
  t.mock.method(globalThis, "fetch", async (input: string | URL | Request, init?: RequestInit) => {
    const url = new URL(input instanceof Request ? input.url : String(input));
    if (url.pathname === "/auth/v1/user") return Response.json({ id: "owner" });
    if (url.pathname === "/rest/v1/app_profiles") return Response.json({ id: "owner", role, display_name: "Test" });
    if (url.pathname === "/rest/v1/meli_accounts") {
      assert.equal(url.searchParams.get("owner_id"), "eq.owner");
      if (url.searchParams.get("select") === "encrypted_tokens") return Response.json({ encrypted_tokens: encrypted });
      return Response.json(foreign ? [] : multiple ? [accountFixture, { ...accountFixture, id: "other" }] : [accountFixture]);
    }
    if (url.pathname === "/rest/v1/rpc/inventory_command") {
      commands++; const args = JSON.parse(String(init?.body));
      assert.equal(args.p_actor, "owner"); assert.equal(args.p_action.p_actor, undefined);
      return Response.json({ code: "P0001", message: "Solo ADMIN puede cambiar roles." }, { status: 400 });
    }
    if (url.pathname === "/rest/v1/rpc/inventory_snapshot") return Response.json(snapshotFixture);
    throw Error("Petición inesperada " + url.pathname);
  });
  const request = (body?: unknown) => new Request("https://test/api/inventory", { method: body ? "POST" : "GET", headers: { Authorization: "Bearer test" }, body: body ? JSON.stringify(body) : undefined });
  assert.equal((await GET(new Request("https://test/api/inventory"))).status, 401);
  const response = await GET(request()); assert.equal(response.status, 200); assert.ok(!(await response.text()).includes("secret"));
  assert.equal((await POST(request({ type: "role", userId: "00000000-0000-4000-8000-000000000001", role: "SUPPLIER", p_actor: "admin" }))).status, 400); assert.equal(commands, 1);
  assert.equal((await POST(request({ type: "role", userId: "00000000-0000-4000-8000-000000000001", role: "ADMIN" }))).status, 400); assert.equal(commands, 1);
  for (const allowed of ["ADMIN", "USER"]) { role = allowed; assert.equal((await accountFor("owner")).id, accountFixture.id); }
  multiple = true; await assert.rejects(accountFor("owner"), /Seleccioná/); multiple = false;
  foreign = true; assert.equal((await listings(new Request(`https://test/api/listings?account=${accountFixture.id}`, { headers: { Authorization: "Bearer test" } }))).status, 400); foreign = false;
  assert.equal((await access("owner")).user_id, 42);
  role = "SUPPLIER"; await assert.rejects(access("owner"), /SUPPLIER/);
});
