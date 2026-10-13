import test from "node:test";
import assert from "node:assert/strict";
import { GET, POST } from "../app/api/business/route";
import { emptyState, type State } from "../lib/domain";
import { emptyBusiness } from "../lib/business";
import { accountFixture } from "./inventory-fixture";

test("API persiste gastos con control de versión, valida cuenta y devuelve solo los gastos consultados", async (t) => {
  for (const [key, value] of Object.entries({ NEXT_PUBLIC_SUPABASE_URL: "https://test.supabase.co", SUPABASE_SERVICE_ROLE_KEY: "test" })) {
    const old = process.env[key]; process.env[key] = value;
    t.after(() => { if (old === undefined) delete process.env[key]; else process.env[key] = old; });
  }
  const otherAccount = "00000000-0000-4000-8000-000000000099";
  let state: State = { ...emptyState(), business: { ...emptyBusiness(), expenseCycles: { [otherAccount]: { startDay: 1, endDay: 31, startMonth: "2026-10" } }, expensePeriods: [{ accountId: otherAccount, month: "2026-10", from: "2026-10-01", to: "2026-10-31", mlCents: 99900, monotributoCents: 0, iibbCents: 0, otherCents: 0, note: "", updatedAt: "" }] } };
  let version = 1, saves = 0;
  t.mock.method(globalThis, "fetch", async (input: string | URL | Request, init?: RequestInit) => {
    const url = new URL(input instanceof Request ? input.url : String(input));
    if (url.pathname.endsWith("/user")) return Response.json({ id: "owner" });
    if (url.pathname.endsWith("/app_profiles")) return Response.json({ id: "owner", role: "ADMIN" });
    if (url.pathname.endsWith("/meli_accounts")) {
      assert.equal(url.searchParams.get("owner_id"), "eq.owner");
      return Response.json(!url.searchParams.has("id") || url.searchParams.get("id") === `eq.${accountFixture.id}` ? [accountFixture] : []);
    }
    if (url.pathname.endsWith("/meli_connections")) return Response.json({ seller_id: "42" });
    if (url.pathname.endsWith("/account_states")) { assert.equal(url.searchParams.get("owner_id"), "eq.owner"); return Response.json({ state, version }); }
    if (url.pathname.endsWith("/save_account_state")) {
      const args = JSON.parse(String(init?.body));
      assert.equal(args.p_owner, "owner"); assert.equal(args.p_expected, version);
      saves++; version++; state = args.p_state; return Response.json(true);
    }
    throw Error("Unexpected request: " + url.pathname);
  });
  const request = (body?: unknown, account = accountFixture.id) => new Request(`https://app.test/api/business?account=${account}`, { method: body ? "POST" : "GET", headers: { Authorization: "Bearer test" }, body: body ? JSON.stringify(body) : undefined });
  assert.equal((await POST(request({ type: "expenseCycle", startDay: 10, endDay: 10, startMonth: "2026-10" }))).status, 200);
  const expense = { type: "expensePeriod", month: "2026-10", from: "2026-10-10", to: "2026-11-10", mlCents: 32000, monotributoCents: 32000, iibbCents: 0, otherCents: 0, note: "Publicidad adicional" };
  assert.equal((await POST(request(expense))).status, 200);
  const read = await GET(request()); const data = await read.json();
  assert.equal(data.expensePeriods.length, 1); assert.equal(data.expensePeriods[0].accountId, accountFixture.id);
  assert.equal(Object.keys(data.expenseCycles).length, 1);
  const defaultAccount = await GET(new Request("https://app.test/api/business", { headers: { Authorization: "Bearer test" } }));
  assert.equal((await defaultAccount.json()).expensePeriods.length, 1, "Default account must also exclude other accounts' expenses");
  assert.equal(state.business!.expensePeriods!.length, 2, "Retains other account history in storage");
  assert.equal((await POST(request(expense, otherAccount))).status, 400);
  assert.equal(saves, 2);
  assert.equal((await POST(request({ ...expense, mlCents: 64000 }))).status, 200);
  assert.equal(state.business!.expensePeriods!.length, 2, "Edits replace, never double charge the period");
  assert.equal((await POST(request({ type: "expenseDelete", month: "2026-10" }))).status, 200);
  assert.equal(state.business!.expensePeriods!.length, 1);
  assert.equal(state.business!.expensePeriods![0].accountId, otherAccount);
});
