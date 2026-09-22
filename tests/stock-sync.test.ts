import test from "node:test";
import assert from "node:assert/strict";
import { stockUpdate, syncNextStock } from "../lib/stock-sync";
import { seal } from "../lib/crypto";
import { accountFixture } from "./inventory-fixture";

const item = { id: "MLA2116330981", seller_id: 42, status: "active", catalog_listing: true, available_quantity: 18, variations: [] };
const targets = [{ variationId: "0", stock: 30 }];
test("catálogo admite stock y cero; conserva validaciones de propietario, Full y depósitos", () => {
  assert.deepEqual(stockUpdate(item, item.id, "42", targets), { matches: false, body: { available_quantity: 30 } });
  assert.equal(stockUpdate({ ...item, available_quantity: 30 }, item.id, "42", targets).matches, true);
  assert.deepEqual(stockUpdate(item, item.id, "42", [{ variationId: "0", stock: 0 }]).body, { available_quantity: 0 });
  assert.throws(() => stockUpdate(item, item.id, "99", targets), /no pertenece/);
  assert.throws(() => stockUpdate({ ...item, shipping: { logistic_type: "fulfillment" } }, item.id, "42", targets), /Full/);
  assert.throws(() => stockUpdate({ ...item, stock_locations: [{ store_id: 1 }] }, item.id, "42", targets), /depósitos/);
  assert.throws(() => stockUpdate({ ...item, status: "closed" }, item.id, "42", targets), /cerrada/);
  const variants = { ...item, variations: [{ id: 10, available_quantity: 3 }, { id: 20, available_quantity: 7 }] };
  assert.deepEqual(stockUpdate(variants, item.id, "42", [{ variationId: "10", stock: 30 }]).body, { variations: [{ id: 10, available_quantity: 30 }, { id: 20 }] });
});

test("reintentar catálogo envía PUT y solo marca éxito si Mercado Libre confirma el stock", async (t) => {
  for (const [key, value] of Object.entries({ NEXT_PUBLIC_SUPABASE_URL: "https://test.supabase.co", SUPABASE_SERVICE_ROLE_KEY: "test", TOKEN_ENCRYPTION_KEY: Buffer.alloc(32, 1).toString("base64") })) {
    const old = process.env[key]; process.env[key] = value;
    t.after(() => { if (old === undefined) delete process.env[key]; else process.env[key] = old; });
  }
  const encrypted = seal({ user_id: 42, access_token: "test-token", refresh_token: "test-refresh", expires_at: Date.now() + 3600000 });
  let confirm = true, reject = false, puts = 0, reads = 0;
  const finishes: { p_error: string | null; p_quantities: unknown[] }[] = [];
  t.mock.method(globalThis, "fetch", async (input: string | URL | Request, init?: RequestInit) => {
    const url = new URL(input instanceof Request ? input.url : String(input));
    if (url.hostname === "api.mercadolibre.com") {
      assert.equal(url.pathname, `/items/${item.id}`);
      assert.equal(new Headers(init?.headers).get("Authorization"), "Bearer test-token");
      if (init?.method === "PUT") {
        puts++;
        assert.deepEqual(JSON.parse(String(init.body)), { available_quantity: 30 });
        return reject ? Response.json({}, { status: 403 }) : Response.json({ ...item, available_quantity: 30 });
      }
      reads++;
      return Response.json({ ...item, available_quantity: reads > 1 && confirm ? 30 : 18 });
    }
    if (url.pathname.endsWith("/claim_stock_sync")) {
      assert.deepEqual(JSON.parse(String(init?.body)), { p_actor: "supplier", p_retry: true });
      return Response.json({ accountId: accountFixture.id, ownerId: "owner", sellerId: "42", itemId: item.id, revision: 2, lease: "lease", targets });
    }
    if (url.pathname.endsWith("/finish_stock_sync")) {
      finishes.push(JSON.parse(String(init?.body))); return Response.json(null);
    }
    if (url.pathname.endsWith("/app_profiles")) return Response.json({ id: "owner", role: "USER", display_name: "Test" });
    if (url.pathname.endsWith("/meli_accounts")) {
      assert.equal(url.searchParams.get("owner_id"), "eq.owner");
      return Response.json(url.searchParams.get("select") === "encrypted_tokens" ? { encrypted_tokens: encrypted } : [accountFixture]);
    }
    throw Error(`Unexpected request ${url.pathname}`);
  });
  assert.equal(await syncNextStock("supplier", true), true);
  assert.equal(puts, 1); assert.equal(reads, 2);
  assert.equal(finishes[0].p_error, null); assert.deepEqual(finishes[0].p_quantities, targets);
  confirm = false; reads = 0;
  await syncNextStock("supplier", true);
  assert.match(finishes[1].p_error!, /no confirmó/); assert.deepEqual(finishes[1].p_quantities, []);
  reject = true; reads = 0;
  await syncNextStock("supplier", true);
  assert.match(finishes[2].p_error!, /rechazó el acceso/); assert.deepEqual(finishes[2].p_quantities, []);
});
