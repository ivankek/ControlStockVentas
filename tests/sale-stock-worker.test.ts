import test from "node:test";
import assert from "node:assert/strict";
import { processNextSale } from "../lib/sale-stock";
import { POST as worker } from "../app/api/inventory/worker/route";
import { seal } from "../lib/crypto";
import { accountFixture } from "./inventory-fixture";

test("worker verifica con ML antes de descontar; rechazos, 206 y errores quedan en reintento", async (t) => {
  for (const [key, value] of Object.entries({ NEXT_PUBLIC_SUPABASE_URL: "https://test.supabase.co", SUPABASE_SERVICE_ROLE_KEY: "test", TOKEN_ENCRYPTION_KEY: Buffer.alloc(32, 1).toString("base64") })) {
    const old = process.env[key]; process.env[key] = value;
    t.after(() => { if (old === undefined) delete process.env[key]; else process.env[key] = old; });
  }
  const encrypted = seal({ user_id: 42, access_token: "SECRET_TOKEN", refresh_token: "SECRET_REFRESH", expires_at: Date.now() + 3600000 });
  let seller = 42, responseStatus = 200, sqlFails = false, empty = false, authorized = false;
  const applied: Record<string, unknown>[] = [], failures: Record<string, unknown>[] = [];
  t.mock.method(globalThis, "fetch", async (input: string | URL | Request, init?: RequestInit) => {
    const url = new URL(input instanceof Request ? input.url : String(input));
    if (url.hostname === "api.mercadolibre.com") {
      assert.equal(url.pathname, "/orders/100");
      assert.equal(new Headers(init?.headers).get("Authorization"), "Bearer SECRET_TOKEN");
      return Response.json({ id: 100, seller: { id: seller }, status: "paid", date_closed: "2026-09-22T12:00:00Z",
        order_items: [{ item: { id: "MLA1" }, quantity: 3 }] }, { status: responseStatus });
    }
    if (url.pathname.endsWith("/authorize_stock_worker")) return Response.json(authorized);
    if (url.pathname.endsWith("/claim_sale_stock")) return Response.json(empty ? null : {
      accountId: accountFixture.id, ownerId: "owner", sellerId: "42", orderId: "100", revision: 1, lease: "lease",
    });
    if (url.pathname.endsWith("/claim_stock_sync")) return Response.json(null);
    if (url.pathname.endsWith("/apply_sale_stock")) {
      applied.push(JSON.parse(String(init?.body)));
      return sqlFails ? Response.json({ message: "SECRET_DB_ERROR" }, { status: 400 }) : Response.json(null);
    }
    if (url.pathname.endsWith("/fail_sale_stock")) { failures.push(JSON.parse(String(init?.body))); return Response.json(null); }
    if (url.pathname.endsWith("/app_profiles")) return Response.json({ id: "owner", role: "USER", display_name: "Test" });
    if (url.pathname.endsWith("/meli_accounts")) return Response.json(url.searchParams.get("select") === "encrypted_tokens" ? { encrypted_tokens: encrypted } : [accountFixture]);
    throw Error(`Unexpected ${url.pathname}`);
  });
  assert.equal(await processNextSale(), true);
  assert.equal(applied.length, 1); assert.equal(failures.length, 0);
  assert.deepEqual(applied[0].p_sale, { id: "100", sellerId: "42", status: "paid", confirmedAt: "2026-09-22T12:00:00Z", lines: [{ itemId: "MLA1", variationId: "0", quantity: 3 }] });
  seller = 99; await processNextSale();
  assert.equal(applied.length, 1); assert.equal(failures.length, 1);
  seller = 42; responseStatus = 206; await processNextSale();
  assert.equal(applied.length, 1); assert.equal(failures.length, 2);
  responseStatus = 503; await processNextSale();
  assert.equal(failures.length, 3);
  responseStatus = 200; sqlFails = true; await processNextSale();
  assert.equal(failures.length, 4);
  assert.ok(!JSON.stringify(failures).includes("SECRET"));
  empty = true; assert.equal(await processNextSale(), false);
  assert.equal((await worker(new Request("http://localhost", { method: "POST" }))).status, 401);
  const request = () => new Request("http://localhost", { method: "POST", headers: { Authorization: `Bearer ${"a".repeat(72)}` } });
  assert.equal((await worker(request())).status, 401);
  authorized = true;
  const response = await worker(request());
  assert.equal(response.status, 200);
  assert.deepEqual(await response.json(), { sales: 0, listings: 0 });
});
