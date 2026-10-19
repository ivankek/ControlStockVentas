import test from "node:test";
import assert from "node:assert/strict";
import { emptyState, type Order } from "../lib/domain";
import { emptyBusiness, updateBusiness, businessCommand } from "../lib/business";
import { supplierReport } from "../lib/supplier";
import { applyDispatchNotes, dispatchMessage, dispatchQueryResult, filterDispatchOrders } from "../lib/dispatch-query";
import { GET } from "../app/api/sync/route";
import { accountFixture } from "./inventory-fixture";

const day = "2026-10-13";
const order = (id: string, cancelled = false): Order => ({ id, createdAt: day, dispatchedDate: day, mode: "flex", cancelled, orderStatus: cancelled ? "cancelled" : "paid", shippingStatus: "delivered", lines: [{ productId: "MLA1:0", quantity: 1 }] });
function fixture() {
  const state = { ...emptyState(), business: emptyBusiness(), supplierProducts: [{ id: "p", name: "Secarropa", costs: [{ from: "2026-01-01", cents: 2000000 }] }], supplierLinks: { "MLA1:0": { supplierId: "p", units: 1 } } };
  const orders = [order("100"), order("101", true)];
  const supplier = supplierReport(state, orders, day, true);
  return { state, orders, result: { ...dispatchQueryResult({ orders, products: [], syncedAt: "" }, day), days: [{ date: day, supplier }], supplier, notes: {} } };
}

test("canceladas quedan en detalle pero no en unidades, total, incidencias ni resumen", () => {
  const { result } = fixture();
  assert.equal(result.orders.length, 2);
  assert.equal(result.supplier.orders.length, 2);
  assert.equal(result.supplier.totalCents, 2000000);
  assert.equal(result.supplier.rows[0].units, 1);
  assert.equal(result.supplier.complete, true);
  assert.deepEqual(filterDispatchOrders(result, { from: "", to: "", shipping: "", order: "", reviewOnly: true, sort: "desc" }).map((o) => o.id), ["101"], "El aviso y el filtro conservan la cancelada aunque el total esté completo");
  assert.equal(result.supplier.orders[1].totalCents, 2000000, "Retains cost for viewing and manual inclusion");
  assert.equal(result.supplier.orders[1].excluded, true);
  const text = dispatchMessage(result.days);
  assert.match(text, /Secarropa x 1u = \$20.000/);
  assert.doesNotMatch(text, /101|cancelada|parcial|revisión/);
});
test("incluir/excluir es reversible, persistente e idempotente sin cambiar estados originales", () => {
  const { state, orders, result } = fixture();
  const action = businessCommand.parse({ type: "note", id: "101", includeCancelledDispatch: true });
  const saved = updateBusiness(state, action, orders[1]);
  const included = applyDispatchNotes(result, saved.business!.notes);
  assert.equal(included.supplier!.totalCents, 4000000);
  assert.equal(included.supplier!.rows[0].units, 2);
  assert.equal(included.supplier!.complete, true);
  assert.match(dispatchMessage(included.days!), /Secarropa x 2u = \$40.000/);
  assert.doesNotMatch(dispatchMessage(included.days!), /revisión|cancelada/);
  assert.equal(applyDispatchNotes(included, saved.business!.notes).supplier!.totalCents, 4000000);
  assert.equal(supplierReport(saved, orders, day, true).totalCents, 4000000, "Survives a fresh query");
  assert.deepEqual(included.orders, result.orders);
  const removed = updateBusiness(saved, { type: "note", id: "101", includeCancelledDispatch: false }, orders[1]);
  assert.equal(applyDispatchNotes(included, removed.business!.notes).supplier!.totalCents, 2000000);
  assert.equal(result.supplier.totalCents, 2000000, "Never mutates prior result");
});
test("cancelación logística y costos faltantes: excluir no bloquea, incluir conserva faltantes", () => {
  const { state } = fixture();
  const cancelled = { ...order("101"), shippingStatus: "cancelled", lines: [{ productId: "MLA2:0", quantity: 1 }] };
  const report = supplierReport(state, [cancelled], day, true);
  assert.equal(report.complete, true); assert.equal(report.totalCents, 0);
  assert.equal(dispatchMessage([{ date: day, supplier: report }]), "Total = $0");
  state.business.notes["101"] = { includeCancelledDispatch: true, updatedAt: "" };
  const included = supplierReport(state, [cancelled], day, true);
  assert.equal(included.complete, false);
  assert.equal(included.orders[0].missing.length, 1);
  assert.match(dispatchMessage([{ date: day, supplier: included }]), /sin producto del proveedor asociado/);
});
test("recuperar consulta después de F5 respeta la decisión guardada y la cuenta", async (t) => {
  for (const [key, value] of Object.entries({ NEXT_PUBLIC_SUPABASE_URL: "https://test.supabase.co", SUPABASE_SERVICE_ROLE_KEY: "test" })) {
    const old = process.env[key]; process.env[key] = value;
    t.after(() => { if (old === undefined) delete process.env[key]; else process.env[key] = old; });
  }
  const { state, result } = fixture();
  state.business.notes["101"] = { accountId: accountFixture.id, includeCancelledDispatch: true, updatedAt: "" };
  t.mock.method(globalThis, "fetch", async (input: string | URL | Request) => {
    const url = new URL(input instanceof Request ? input.url : String(input));
    if (url.pathname.endsWith("/user")) return Response.json({ id: "owner" });
    if (url.pathname.endsWith("/app_profiles")) return Response.json({ id: "owner", role: "USER" });
    if (url.pathname.endsWith("/meli_accounts")) return Response.json([accountFixture]);
    if (url.pathname.endsWith("/meli_connections")) return Response.json({ seller_id: "42" });
    if (url.pathname.endsWith("/account_states")) return Response.json({ state, version: 1 });
    if (url.pathname.endsWith("/dispatch_query_jobs")) {
      assert.equal(url.searchParams.get("owner_id"), "eq.owner");
      assert.equal(url.searchParams.get("account_id"), "eq." + accountFixture.id);
      return Response.json({ id: "job", date_from: day, date_to: day, status: "done", expires_at: new Date(Date.now() + 60000).toISOString(), progress: {}, result });
    }
    throw Error("Unexpected request: " + url.pathname);
  });
  const request = () => new Request("https://app.test/api/sync?account=" + accountFixture.id, { headers: { Authorization: "Bearer test" } });
  const response = await GET(request()); assert.equal(response.status, 200);
  assert.equal((await response.json()).job.result.supplier.totalCents, 4000000);
  state.business.notes["101"].accountId = "another-account";
  assert.equal((await (await GET(request())).json()).job.result.supplier.totalCents, 2000000);
});
