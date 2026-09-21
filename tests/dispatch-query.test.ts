import { inventoryReadMock } from "./inventory-fixture";
import test from "node:test";
import assert from "node:assert/strict";
import { POST } from "../app/api/sync/route";
import { seal } from "../lib/crypto";

test("consulta por fecha: historial argentino, sin escrituras ni filtro por estado actual", async (t) => {
  const values = { NEXT_PUBLIC_SUPABASE_URL: "https://test.supabase.co", SUPABASE_SERVICE_ROLE_KEY: "test-key", TOKEN_ENCRYPTION_KEY: Buffer.alloc(32, 1).toString("base64") };
  for (const [key, value] of Object.entries(values)) {
    const old = process.env[key]; process.env[key] = value;
    t.after(() => { if (old === undefined) delete process.env[key]; else process.env[key] = old; });
  }
  const calls: string[] = [];
  let expectedFrom = "2026-06-16T03:00:00.000Z";
  const tokens = seal({ access_token: "test", refresh_token: "test", expires_at: Date.now() + 3600000, user_id: 42 });
  t.mock.method(globalThis, "fetch", async (input: string | URL | Request, init?: RequestInit) => {
    const url = new URL(input instanceof Request ? input.url : String(input));
    const inventory = inventoryReadMock(url, tokens); if (inventory) return inventory;
    const method = init?.method ?? (input instanceof Request ? input.method : "GET");
    assert.equal(method.toUpperCase(), "GET", "La consulta no debe escribir en Supabase ni Mercado Libre");
    calls.push(url.pathname);
    let body: unknown;
    if (url.pathname === "/auth/v1/user") body = { id: "owner" };
    else if (url.pathname === "/rest/v1/account_states") body = { state: { products: [], orders: [], settlements: [] }, version: 1 };
    else if (url.pathname === "/rest/v1/meli_connections") body = { seller_id: "42" };
    else if (url.pathname === "/rest/v1/meli_listings") body = [];
    else if (url.pathname === "/orders/search") {
      assert.equal(url.searchParams.get("order.date_created.to"), "2026-09-14T23:59:59.999-03:00");
      assert.equal(url.searchParams.get("order.date_created.from"), expectedFrom);
      body = { paging: { total: 4 }, results: [1, 2, 3, 4].map((id) => ({
        id, status: id === 4 ? "cancelled" : "paid", date_created: "2026-09-12T15:00:00Z", seller: { id: 42 },
        shipping: id === 3 ? null : { id }, order_items: [{ item: { id: "MLA1", title: "Producto" }, quantity: 2 }],
      })) };
    } else if (/^\/shipments\/\d+$/.test(url.pathname)) {
      const id = Number(url.pathname.split("/").at(-1));
      body = id === 4
        ? { id, status: "delivered", mode: "me2", logistic_type: "self_service" }
        : { id, status: "delivered", destination: { shipping_address: { state: { name: "Buenos Aires" }, municipality: { name: "La Matanza" }, city: { name: "Villa Luzuriaga" }, zip_code: "1753" } }, logistic: { mode: "me2", type: id === 1 ? "self_service" : "drop_off" }, lead_time: { estimated_delivery_time: { date: "2026-09-15T18:00:00Z" } } };
    } else if (/^\/shipments\/\d+\/history$/.test(url.pathname)) {
      body = [{ status: "shipped", date: url.pathname.includes("/2/") ? "2026-09-14T02:30:00Z" : "2026-09-15T02:30:00Z" }, { status: "delivered", date: "2026-09-15T18:00:00Z" }];
    } else throw Error(`Consulta inesperada: ${url.pathname}`);
    return Response.json(body);
  });
  const request = (date: string, from?: string) => new Request("https://app.test/api/sync", { method: "POST", headers: { Authorization: "Bearer test" }, body: JSON.stringify({ date, from }) });
  const response = await POST(request("2026-09-14"));
  assert.equal(response.status, 200);
  assert.equal(response.headers.get("cache-control"), "no-store");
  const data = await response.json();
  assert.deepEqual(data.orders.map((o: { id: string }) => o.id), ["1", "4"]);
  assert.equal(data.orders[0].shippingStatus, "delivered");
  assert.equal(data.orders[0].mode, "flex");
  assert.equal(data.orders[0].municipality, "La Matanza");
  assert.equal(data.flex["1"].zone, "CORDON_1");
  assert.equal(data.flex["1"].cents, 364000);
  assert.equal(data.orders[0].dispatchedDate, "2026-09-14");
  assert.equal(data.orders[0].expectedDate, "2026-09-15");
  assert.ok(calls.includes("/shipments/1/history"));
  assert.ok(calls.includes("/shipments/2/history"));
  assert.equal(data.orders[1].cancelled, true);
  assert.deepEqual(data.unverified.map((o: { id: string }) => o.id), ["3"]);
  assert.ok(data.supplier);
  assert.equal(data.supplier.complete, false);
  expectedFrom = "2026-06-15T03:00:00.000Z";
  const range = await POST(request("2026-09-14", "2026-09-13"));
  assert.equal(range.status, 200);
  const rangeData = await range.json();
  assert.deepEqual(rangeData.orders.map((o: { id: string }) => o.id).sort(), ["1", "2", "4"]);
  assert.deepEqual(rangeData.days.map((d: { date: string }) => d.date), ["2026-09-13", "2026-09-14"]);
  assert.equal((await POST(request("2026-09-13", "2026-09-14"))).status, 400);
  assert.equal((await POST(request("invalid"))).status, 400);
  assert.equal((await POST(request("2999-01-01"))).status, 400);
});
