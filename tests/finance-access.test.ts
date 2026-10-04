import test from "node:test";
import assert from "node:assert/strict";
import { POST as profit } from "../app/api/profit/route";
import { POST as flex } from "../app/api/profit/flex/route";
import { GET as business, POST as save } from "../app/api/business/route";

test("solo ADMIN accede a finanzas; USER no puede modificar netos ni tarifas", async (t) => {
  for (const [key, value] of Object.entries({ NEXT_PUBLIC_SUPABASE_URL: "https://test.supabase.co", SUPABASE_SERVICE_ROLE_KEY: "test" })) {
    const old = process.env[key]; process.env[key] = value;
    t.after(() => { if (old === undefined) delete process.env[key]; else process.env[key] = old; });
  }
  let role = "USER";
  t.mock.method(globalThis, "fetch", async (input: string | URL | Request) => {
    const url = new URL(input instanceof Request ? input.url : String(input));
    if (url.pathname === "/auth/v1/user") return Response.json({ id: "owner" });
    if (url.pathname === "/rest/v1/app_profiles") return Response.json({ id: "owner", role });
    if (role === "ADMIN" && url.pathname === "/rest/v1/account_states") return Response.json({ state: {}, version: 1 });
    throw Error("No debe consultar datos ni servicios financieros sin permiso");
  });
  const request = (body?: object) => new Request("https://app.test/api/business", { method: body ? "POST" : "GET", headers: { Authorization: "Bearer test" }, body: body ? JSON.stringify(body) : undefined });
  for (role of ["USER", "SUPPLIER"]) {
    assert.equal((await profit(request({ from: "2026-09-01", to: "2026-09-30" }))).status, 403);
    assert.equal((await flex(request({ from: "2026-09-01" }))).status, 403);
    assert.equal((await business(request())).status, 403);
  }
  role = "USER";
  assert.equal((await save(request({ type: "flexRate", zone: "CABA", from: "2026-09-01", cents: 1 }))).status, 403);
  assert.equal((await save(request({ type: "note", id: "100", netCents: 1 }))).status, 403);
  role = "ADMIN";
  assert.equal((await business(request())).status, 200);
});
