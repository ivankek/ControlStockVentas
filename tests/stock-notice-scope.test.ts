import test from "node:test";
import assert from "node:assert/strict";
import { GET } from "../app/api/inventory/sync/route";

test("avisos: incluso ADMIN queda limitado a sus cuentas; proveedor no recibe ventas ajenas", async (t) => {
  for (const [key, value] of Object.entries({ NEXT_PUBLIC_SUPABASE_URL: "https://test.supabase.co", SUPABASE_SERVICE_ROLE_KEY: "test" })) {
    const old = process.env[key]; process.env[key] = value;
    t.after(() => { if (old === undefined) delete process.env[key]; else process.env[key] = old; });
  }
  const a = "00000000-0000-4000-8000-000000000001", b = "00000000-0000-4000-8000-000000000002", foreign = "00000000-0000-4000-8000-000000000003";
  let role = "ADMIN", selected = "", queried = 0;
  t.mock.method(globalThis, "fetch", async (input: string | URL | Request) => {
    const url = new URL(input instanceof Request ? input.url : String(input));
    if (url.pathname.endsWith("/auth/v1/user")) return Response.json({ id: "owner" });
    if (url.pathname.endsWith("/app_profiles")) return Response.json({ id: "owner", role });
    if (url.pathname.endsWith("/meli_accounts")) {
      assert.equal(url.searchParams.get("owner_id"), "eq.owner");
      assert.equal(url.searchParams.get("id"), selected ? `eq.${selected}` : null);
      return Response.json((selected ? [selected].filter((id) => id !== foreign) : [a, b]).map((id) => ({ id })));
    }
    if (url.pathname.endsWith("/listing_stock_jobs") || url.pathname.endsWith("/sales_stock_jobs")) {
      queried++;
      const filter = url.searchParams.get("account_id")!;
      assert.equal(filter, `in.(${selected || `${a},${b}`})`);
      assert.ok(!filter.includes(foreign));
      if (url.pathname.endsWith("/sales_stock_jobs")) {
        assert.ok(url.searchParams.get("or")?.includes("status.neq.done"));
        return Response.json([{ account_id: selected || a, order_id: "1", warning: "Revisar" }]);
      }
      return Response.json([{ account_id: selected || a, item_id: "MLA1", status: "error", meli_listings: { payload: { title: "Título" } } }]);
    }
    if (url.pathname.endsWith("/rpc/stock_sync_status")) {
      assert.equal(role, "SUPPLIER"); return Response.json([]);
    }
    throw Error(`Consulta inesperada ${url.pathname}`);
  });
  const request = () => new Request(`https://app.test/api/inventory/sync${selected ? `?account=${selected}` : ""}`, { headers: { Authorization: "Bearer test" } });
  assert.equal((await GET(new Request("https://app.test/api/inventory/sync"))).status, 401);
  let response = await GET(request()); assert.equal(response.status, 200);
  assert.equal((await response.json()).jobs[0].title, "Título");
  selected = b; role = "USER";
  response = await GET(request()); assert.equal(response.status, 200);
  assert.equal((await response.json()).sales[0].account_id, b);
  const before = queried;
  selected = foreign;
  assert.deepEqual(await (await GET(request())).json(), { jobs: [], sales: [] });
  assert.equal(queried, before);
  selected = ""; role = "SUPPLIER";
  assert.deepEqual(await (await GET(request())).json(), { jobs: [], sales: [] });
  assert.equal(queried, before);
});
