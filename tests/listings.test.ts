import test from "node:test";
import assert from "node:assert/strict";
import { POST, GET } from "../app/api/listings/route";
import { seal } from "../lib/crypto";
import { emptyState, type State } from "../lib/domain";
import { mergeListings, normalizeListing } from "../lib/listings";

const item = (id = "MLA1", price = 2500) => ({ id, seller_id: 42, title: "Cepillo", price, currency_id: "ARS", available_quantity: 8, status: "active", variations: [] });

test("publicaciones: persistencia por ID, cero escrituras si no hay cambios, errores sin guardado parcial", async (t) => {
  for (const [key, value] of Object.entries({ NEXT_PUBLIC_SUPABASE_URL: "https://test.supabase.co", SUPABASE_SERVICE_ROLE_KEY: "test-key", TOKEN_ENCRYPTION_KEY: Buffer.alloc(32, 1).toString("base64") })) {
    const old = process.env[key]; process.env[key] = value;
    t.after(() => { if (old === undefined) delete process.env[key]; else process.env[key] = old; });
  }
  const encrypted = seal({ access_token: "test", refresh_token: "test", expires_at: Date.now() + 3600000, user_id: 42 });
  let state: State = emptyState(), writes = 0, version = 0;
  let items = [item()];
  let failDetail = false;
  t.mock.method(globalThis, "fetch", async (input: string | URL | Request, init?: RequestInit) => {
    const url = new URL(input instanceof Request ? input.url : String(input));
    if (url.pathname === "/auth/v1/user") return Response.json({ id: "owner" });
    if (url.pathname === "/rest/v1/meli_connections") return Response.json({ encrypted_tokens: encrypted });
    if (url.pathname === "/rest/v1/account_states") return Response.json({ state, version });
    if (url.pathname === "/rest/v1/rpc/save_account_state") {
      const body = JSON.parse(String(init?.body));
      assert.equal(body.p_owner, "owner");
      assert.equal(body.p_expected, version);
      state = body.p_state; writes++; version++;
      return Response.json(true);
    }
    assert.equal((init?.method ?? "GET").toUpperCase(), "GET", "Nunca modifica publicaciones en Mercado Libre");
    if (url.pathname === "/users/42/items/search") {
      assert.equal(url.searchParams.get("search_type"), "scan");
      return Response.json(url.searchParams.has("scroll_id") ? { results: null } : { results: items.map((i) => i.id), scroll_id: "cursor" });
    }
    if (url.pathname.startsWith("/items/")) {
      if (failDetail) return Response.json({}, { status: 403 });
      return Response.json(items.find((i) => url.pathname.endsWith(i.id)));
    }
    throw Error(`Petición inesperada: ${url.pathname}`);
  });
  const request = () => new Request("https://app.test/api/listings", { method: "POST", headers: { Authorization: "Bearer test" } });
  let response = await POST(request());
  assert.equal(response.status, 200);
  assert.equal((await response.json()).added, 1);
  assert.equal(writes, 1);
  response = await POST(request());
  assert.equal((await response.json()).unchanged, 1);
  assert.equal(writes, 1);
  items = [item("MLA1", 3000), item("MLA2")];
  response = await POST(request());
  const result = await response.json();
  assert.equal(result.added, 1); assert.equal(result.updated, 1);
  assert.equal(state.listings?.length, 2);
  assert.equal(state.listings?.[0].price, 3000);
  assert.equal(writes, 2);
  assert.equal((await (await GET(request())).json()).listings.length, 2);
  failDetail = true;
  assert.equal((await POST(request())).status, 400);
  assert.equal(writes, 2);
  assert.deepEqual(state.orders, []);
  assert.deepEqual(state.settlements, []);
});

test("comparación estable, duplicados, variantes, otra cuenta y publicaciones ausentes", () => {
  const original = normalizeListing({ ...item(), last_updated: "ayer", variations: [
    { id: 2, price: 2500, available_quantity: 3 }, { id: 1, price: 2500, available_quantity: 5 },
  ] }, 42);
  const same = normalizeListing({ ...original, last_updated: "hoy", variations: [...original.variations].reverse() }, 42);
  assert.equal(mergeListings([original], [same, same]).unchanged, 1);
  assert.equal(mergeListings([original], []).listings.length, 1);
  assert.equal(mergeListings([original], [{ ...same, status: "paused" }]).updated, 1);
  assert.throws(() => normalizeListing(item(), 43));
  assert.throws(() => normalizeListing({ ...item(), price: undefined }, 42));
});
