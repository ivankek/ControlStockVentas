import { inventoryReadMock } from "./inventory-fixture";
import test from "node:test";
import assert from "node:assert/strict";
import { POST } from "../app/api/profit/route";
import { POST as save } from "../app/api/business/route";
import { seal } from "../lib/crypto";

test("ganancias consulta API ML y MP sin persistir ventas; notas verifican propiedad", async (t) => {
  for (const [key, value] of Object.entries({ NEXT_PUBLIC_SUPABASE_URL: "https://test.supabase.co", SUPABASE_SERVICE_ROLE_KEY: "test", TOKEN_ENCRYPTION_KEY: Buffer.alloc(32, 1).toString("base64") })) { const old = process.env[key]; process.env[key] = value; t.after(() => { if (old === undefined) delete process.env[key]; else process.env[key] = old; }); }
  const tokens = seal({ access_token: "test", refresh_token: "test", expires_at: Date.now() + 3600000, user_id: 42 });
  let unauthorized = false;
  let withShipping = false;
  t.mock.method(globalThis, "fetch", async (input: string | URL | Request, init?: RequestInit) => {
    const url = new URL(input instanceof Request ? input.url : String(input));
    if (url.pathname === "/rest/v1/app_profiles") return Response.json({ id: "owner", role: "ADMIN" });
    const inventory = inventoryReadMock(url, tokens); if (inventory) return inventory;
    assert.equal(init?.method ?? "GET", "GET", "No debe haber escrituras externas");
    if (url.pathname === "/auth/v1/user") return Response.json({ id: "owner" });
    if (url.pathname === "/rest/v1/meli_connections") return Response.json({ encrypted_tokens: tokens });
    if (url.pathname === "/orders/999") return Response.json({ id: 999, seller: { id: 111 } });
    if (url.pathname === "/orders/search") {
      assert.equal(url.searchParams.get("seller"), "42");
      return Response.json({ paging: { total: 1 }, results: [{ id: 100, pack_id: withShipping ? 200 : null, seller: { id: 42 }, status: "paid", date_created: "2026-09-10T12:00:00Z", total_amount: 100, currency_id: "ARS", payments: [{ id: 500, status: "approved" }], order_items: [{ item: { id: "MLA1", title: "Producto" }, quantity: 1 }] }] });
    }
    if (url.pathname === "/packs/200") return Response.json({ id: 200, orders: [{ id: 100 }], shipment: { id: 300 } });
    if (url.pathname === "/shipments/300") return Response.json({ id: 300, status: "shipped", logistic_type: "self_service", receiver_address: { state: { name: "Capital Federal" } } });
    if (url.pathname === "/shipments/300/costs") return Response.json({}, { status: 403 });
    if (url.host === "api.mercadopago.com" && url.pathname === "/v1/payments/500") return unauthorized ? Response.json({}, { status: 403 }) : Response.json({ id: 500, collector_id: 42, status: "approved", currency_id: "ARS", transaction_amount_refunded: 0, transaction_details: { net_received_amount: 80 } });
    throw Error("Consulta inesperada: " + url.pathname);
  });
  const request = (body: unknown) => new Request("https://app.test/api/profit", { method: "POST", headers: { Authorization: "Bearer test" }, body: JSON.stringify(body) });
  const response = await POST(request({ from: "2026-09-10", to: "2026-09-10" }));
  assert.equal(response.status, 200);
  const data = await response.json(); assert.equal(data.sales[0].grossCents, 10000); assert.equal(data.sales[0].receivedCents, 8000); assert.equal(data.nextOffset, null);
  withShipping = true;
  const partial = await POST(request({ from: "2026-09-10", to: "2026-09-10" }));
  assert.equal(partial.status, 200);
  const sale = (await partial.json()).sales[0];
  assert.equal(sale.id, "100"); assert.equal(sale.receivedCents, 8000);
  assert.equal(sale.shipmentId, "300"); assert.equal(sale.mode, "flex");
  assert.equal(sale.shippingCosts.sellerShippingCostCents, null);
  assert.match(sale.shippingCosts.shippingError, /costos.*403/);
  assert.equal(sale.flexReconciliation, "deferred");
  withShipping = false;
  unauthorized = true;
  assert.equal((await (await POST(request({ from: "2026-09-10", to: "2026-09-10" }))).json()).sales[0].receivedCents, undefined);
  assert.equal((await POST(request({ from: "2026-01-01", to: "2026-09-10" }))).status, 200);
  assert.equal((await POST(request({ from: "2024-01-01", to: "2026-09-10" }))).status, 400);
  const rejected = await save(request({ type: "note", id: "999", shippingCents: 100 }));
  assert.equal(rejected.status, 400); assert.match((await rejected.json()).error, /no pertenece/);
});
