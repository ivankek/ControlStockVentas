import test from "node:test";
import assert from "node:assert/strict";
import { createSaleShippingResolver, parseShippingCosts, shippingResolverForQuery } from "../lib/sale-shipping";
import type { RawOrder } from "../lib/meli";
const order = (id: number, more: Partial<RawOrder> = {}): RawOrder => ({ id, pack_id: 200, status: "paid", date_created: "2026-10-01", seller: { id: 42 }, order_items: [], ...more });

test("caché entre páginas aislada por consulta, vendedor y credencial", () => {
  const first = shippingResolverForQuery("token", 42, "user:account:query-1");
  assert.equal(shippingResolverForQuery("token", 42, "user:account:query-1"), first);
  assert.notEqual(shippingResolverForQuery("token", 42, "user:account:query-2"), first);
  assert.notEqual(shippingResolverForQuery("token", 43, "user:account:query-1"), first);
  assert.notEqual(shippingResolverForQuery("new-token", 42, "user:account:query-1"), first);
});

test("costos finales: vendedor correcto, cero distinto de null y subsidios solo informativos", () => {
  const cost = parseShippingCosts({ gross_amount: 8000, receiver: { cost: 0 }, senders: [{ user_id: 12, cost: 999 }, { user_id: 42, cost: 3500, discounts: [{ type: "subsidy", rate: 0.5, promoted_amount: 4500 }] }] }, 42);
  assert.equal(cost.sellerShippingCostCents, 350000);
  assert.equal(cost.shippingGrossCents, 800000);
  assert.equal(cost.shippingPromotedCents, 450000);
  assert.equal(cost.buyerShippingCostCents, 0);
  assert.equal(parseShippingCosts({ senders: [{ cost: 0 }] }, 42).sellerShippingCostCents, 0);
  assert.equal(parseShippingCosts({ senders: [{ user_id: 12, cost: 99 }] }, 42).sellerShippingCostCents, null);
  assert.equal(parseShippingCosts({}, 42).sellerShippingCostCents, null);
  assert.equal(parseShippingCosts({ senders: [{ cost: NaN }] }, 42).sellerShippingCostCents, null);
  assert.equal(parseShippingCosts({ senders: [{ cost: 1, discounts: [{ promoted_amount: NaN }, { promoted_amount: -1 }, { promoted_amount: 5 }] }] }, 42).shippingPromotedCents, 500);
});

test("pack compartido: consulta pack, shipment y costos una vez, incluso en paralelo", async (t) => {
  const calls: string[] = [];
  t.mock.method(globalThis, "fetch", async (input: string | URL | Request, init?: RequestInit) => {
    const path = new URL(String(input)).pathname; calls.push(path);
    assert.equal(new Headers(init?.headers).get("x-format-new"), "true");
    if (path === "/packs/200") return Response.json({ id: 200, orders: [{ id: 1 }, { id: 2 }], shipment: { id: 300 } });
    if (path === "/shipments/300") return Response.json({ id: 300, status: "shipped", substatus: "in_hub", logistic: { type: "self_service", mode: "me2" } });
    if (path === "/shipments/300/costs") return Response.json({ gross_amount: 8000, senders: [{ user_id: 42, cost: 3500 }] });
    throw Error("Unexpected API");
  });
  const resolve = createSaleShippingResolver("token", 42);
  const results = await Promise.all([resolve(order(1)), resolve(order(2))]);
  assert.deepEqual(calls, ["/packs/200", "/shipments/300", "/shipments/300/costs"]);
  for (const result of results) { assert.equal(result.shipmentId, "300"); assert.equal(result.info.isFlex, true); assert.equal(result.info.sellerShippingCostCents, 350000); }
  await resolve(order(3, { shipping: { id: 300 } }));
  assert.equal(calls.length, 3, "El ID ya disponible evita consultar el pack");
  const foreign = await resolve(order(4));
  assert.match(foreign.info.shippingError!, /no corresponde/);
  assert.equal(foreign.shipmentId, undefined);
});

test("errores independientes conservan identidad y nunca inventan costo cero ni modalidad Flex", async (t) => {
  t.mock.method(globalThis, "fetch", async (input: string | URL | Request) => {
    const path = new URL(String(input)).pathname;
    if (path === "/packs/201") return Response.json({ id: 201, orders: [{ id: 1 }], shipment: null });
    if (path === "/shipments/300") return Response.json({ id: 300, status: "delivered", logistic_type: "self_service" });
    return Response.json({}, { status: 403 });
  });
  const resolve = createSaleShippingResolver("token", 42);
  const absent = await resolve(order(1, { pack_id: 201 }));
  assert.equal(absent.info.shippingError, undefined); assert.equal(absent.info.sellerShippingCostCents, null);
  const packError = await resolve(order(1));
  assert.match(packError.info.shippingError!, /paquete.*403/);
  const shipmentError = await resolve(order(2, { shipping: { id: 999 } }));
  assert.equal(shipmentError.shipmentId, "999"); assert.equal(shipmentError.info.isFlex, null);
  assert.match(shipmentError.info.shippingError!, /envío 999/);
  const costsError = await resolve(order(3, { shipping: { id: 300 } }));
  assert.equal(costsError.info.isFlex, true); assert.equal(costsError.shipment?.status, "delivered");
  assert.equal(costsError.info.sellerShippingCostCents, null); assert.equal(costsError.info.shippingPromotedCents, null);
  assert.match(costsError.info.shippingError!, /costos del envío 300/);
});
