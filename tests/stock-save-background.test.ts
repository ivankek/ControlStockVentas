import test from "node:test";
import assert from "node:assert/strict";
import { workAsyncStorage } from "next/dist/server/app-render/work-async-storage.external";
import { workUnitAsyncStorage } from "next/dist/server/app-render/work-unit-async-storage.external";
import { POST } from "../app/api/inventory/route";
import { snapshotFixture } from "./inventory-fixture";

test("guardar stock persiste antes de programar el backend y procesa sin otra petición del navegador", async (t) => {
  for (const [key, value] of Object.entries({ NEXT_PUBLIC_SUPABASE_URL: "https://test.supabase.co", SUPABASE_SERVICE_ROLE_KEY: "test" })) {
    const old = process.env[key]; process.env[key] = value;
    t.after(() => { if (old === undefined) delete process.env[key]; else process.env[key] = old; });
  }
  const scheduled: (() => Promise<void>)[] = [];
  let saved = false, fail = false, claimed = 0, finished = 0;
  t.mock.method(workAsyncStorage, "getStore", () => ({ afterContext: { after: (callback: () => Promise<void>) => { assert.ok(saved); scheduled.push(callback); } } }));
  t.mock.method(workUnitAsyncStorage, "getStore", () => ({ type: "request" }));
  t.mock.method(globalThis, "fetch", async (input: string | URL | Request, init?: RequestInit) => {
    const url = new URL(input instanceof Request ? input.url : String(input));
    if (url.pathname === "/auth/v1/user") return Response.json({ id: "supplier" });
    if (url.pathname.endsWith("/inventory_command")) {
      if (fail) return Response.json({ code: "P0001", message: "Conflicto de versión" }, { status: 400 });
      saved = true; return Response.json(null);
    }
    if (url.pathname.endsWith("/inventory_snapshot")) return Response.json(snapshotFixture);
    if (url.pathname.endsWith("/claim_stock_sync")) {
      assert.equal(JSON.parse(String(init?.body)).p_actor, "supplier");
      claimed++;
      return Response.json(claimed <= 3 ? { accountId: "a", itemId: String(claimed), revision: 1, lease: "l", targets: [] } : null);
    }
    if (url.pathname.endsWith("/finish_stock_sync")) { finished++; return Response.json(null); }
    throw Error("Petición inesperada: " + url.pathname);
  });
  const request = () => new Request("https://app.test/api/inventory", { method: "POST", headers: { Authorization: "Bearer test" }, body: JSON.stringify({ type: "adjust", variantId: "00000000-0000-4000-8000-000000000001", delta: 1, expectedVersion: 1, movementType: "RESTOCK", note: "Reposición", requestId: "00000000-0000-4000-8000-000000000002" }) });
  assert.equal((await POST(request())).status, 200);
  assert.equal(scheduled.length, 1); assert.equal(claimed, 0);
  // The request has finished. The browser can now be closed.
  await scheduled[0]();
  assert.equal(finished, 3); assert.equal(claimed, 4);
  fail = true;
  assert.equal((await POST(request())).status, 400);
  assert.equal(scheduled.length, 1, "No worker for a rejected save");
});
