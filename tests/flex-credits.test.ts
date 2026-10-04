import test from "node:test";
import assert from "node:assert/strict";
import { flexCredits, parseFlexCredit, paymentBase } from "../lib/flex-credits";
import { emptyState } from "../lib/domain";
import { emptyBusiness } from "../lib/business";
import { profitRows, type Sale } from "../lib/profit";
import { detectFlexZone } from "../lib/flex-zones";

const credit = { id: "900", shipmentId: "1000", orderId: "100", cents: 899000 };
const sale = (more: Partial<Sale> = {}): Sale => ({ id: "100", createdAt: "2026-09-28T12:00:00Z", orderStatus: "paid", cancelled: false, mode: "flex", province: "Buenos Aires", city: "Boulogne", shipmentId: "1000", lines: [{ productId: "MLA1:0", quantity: 1 }], grossCents: 2000000, receivedCents: 1396000, paymentBaseCents: 1396000, paymentIds: ["500"], flexCredits: [credit], issues: [], ...more });
const state = () => ({ ...emptyState(), business: emptyBusiness(), supplierProducts: [{ id: "p", name: "Tensiómetro", costs: [{ from: "2026-09-01", cents: 1050000 }] }], supplierLinks: { "MLA1:0": { supplierId: "p", units: 1 } } });

test("error de facturación identifica el recurso y nunca se interpreta como cero", async (t) => {
  t.mock.method(globalThis, "fetch", async () => Response.json({}, { status: 403 }));
  await assert.rejects(flexCredits("private-token", "2026-09-01"), /Períodos de facturación BILL:.*403/);
});

test("bonificación del ejemplo: 13.960 + 8.990 = 22.950, sin duplicar ni agregar a correo", () => {
  const row = profitRows(state(), [sale()])[0];
  assert.equal(row.received, 2295000);
  assert.equal(row.shipping, 420000);
  assert.equal(row.net, 825000);
  assert.equal(profitRows(state(), [sale({ receivedCents: 2295000 })])[0].received, 2295000, "ya incluido en MP");
  assert.equal(profitRows(state(), [sale({ mode: "correo", receivedCents: 3667080 })])[0].received, 3667080);
  assert.equal(profitRows(state(), [sale({ flexCredits: [credit, credit] })])[0].bonus, 899000);
  const reversal = { ...credit, id: "901", cents: -99000 };
  assert.equal(profitRows(state(), [sale({ flexCredits: [credit, reversal] })])[0].received, 2196000);
  assert.equal(profitRows(state(), [sale({ flexCredits: [credit, { ...credit, id: "902", cents: -899000 }] })])[0].received, 1396000);
  assert.equal(profitRows(state(), [sale({ receivedCents: 2295000, flexCredits: [credit, { ...credit, id: "902", cents: -899000 }] })])[0].net, undefined, "a reversal must reconcile even when the credit balance is zero");
});

test("subsidio como ingreso Flex: ejemplo 44.437,50 - 6.287,91 + 899 = 39.048,59", () => {
  const shippingCosts: NonNullable<Sale["shippingCosts"]> = { isFlex: true, shippingLogisticType: "self_service", shippingGrossCents: 899000, buyerShippingCostCents: 0, sellerShippingCostCents: 809100, shippingPromotedCents: 89900, shippingDiscounts: [{ promoted_amount: 899 }] };
  const input = sale({ grossCents: 4443750, receivedCents: 3814959, paymentBaseCents: 3814959, flexCredits: undefined, shippingCosts });
  const row = profitRows(state(), [input])[0];
  assert.equal(row.received, 3904859);
  assert.equal(row.bonusAdded, 89900);
  assert.equal(row.net, 3904859 - 1050000 - 420000);
  assert.equal(profitRows(state(), [{ ...input, receivedCents: 3904859 }])[0].bonusAdded, 0);
  assert.equal(profitRows(state(), [{ ...input, receivedCents: 3904859 }])[0].received, 3904859);
  assert.equal(profitRows(state(), [{ ...input, mode: "correo" }])[0].received, 3814959);
  assert.equal(profitRows(state(), [{ ...input, paymentBaseCents: undefined }])[0].net, undefined);
  assert.equal(profitRows(state(), [{ ...input, shippingCosts: { ...shippingCosts, shippingPromotedCents: null } }])[0].net, undefined);
  assert.equal(profitRows(state(), [{ ...input, shippingCosts: { ...shippingCosts, shippingPromotedCents: 0 } }])[0].received, 3814959);
  const manual = state(); manual.business.notes[input.id] = { updatedAt: "", netCents: 3904859 };
  assert.equal(profitRows(manual, [input])[0].received, 3904859);
  assert.equal(profitRows(state(), [{ ...input, flexCredits: [{ ...credit, cents: 89900 }] }])[0].received, 3904859, "facturación y subsidy no se suman dos veces");
  const shared = profitRows(state(), [input, { ...input, id: "101", paymentIds: ["501"] }]);
  assert.equal(shared.reduce((sum, r) => sum + r.bonus, 0), 89900);
  assert.equal(shared[0].net, undefined, "no asignar arbitrariamente ingreso compartido");
  assert.equal(shared[1].net, undefined, "ninguna orden del envío compartido se da por conciliada sin verificar");
});
test("bonificaciones compartidas, neto manual y conciliaciones pendientes", () => {
  const rows = profitRows(state(), [sale(), sale({ id: "101", paymentIds: ["501"] })]);
  assert.equal(rows.reduce((n, r) => n + r.bonusAdded, 0), 899000);
  assert.equal(profitRows(state(), [sale({ paymentBaseCents: undefined })])[0].net, undefined);
  assert.equal(profitRows(state(), [sale({ flexCreditsUnavailable: true })])[0].net, undefined);
  assert.equal(profitRows(state(), [sale({ receivedCents: 1500000 })])[0].net, undefined);
  const manual = state(); manual.business.notes["100"] = { updatedAt: "", netCents: 2295000 };
  const row = profitRows(manual, [sale({ flexCreditsUnavailable: true })])[0];
  assert.equal(row.received, 2295000); assert.equal(row.net, 825000);
  for (const city of ["Beccar", "Béccar", "Boulogne", "Boulogne Sur Mer"]) assert.equal(detectFlexZone({ province: "Buenos Aires", city }).zone, "CORDON_2");
});
test("base del pago exige desglose válido, sin volver a descontar impuestos incluidos", () => {
  const payment = { transaction_amount: 20000, taxes_amount: 300, fee_details: [{ type: "marketplace_fee", amount: 5740, fee_payer: "collector" }] };
  assert.equal(paymentBase(payment), 1396000);
  assert.equal(paymentBase({ ...payment, fee_details: [...payment.fee_details, { type: "tax", amount: 300, fee_payer: "collector" }] }), 1396000);
  assert.equal(paymentBase({ transaction_amount: 20000 }), undefined);
  assert.equal(paymentBase({ ...payment, fee_details: [{ type: "shipping", amount: 300, fee_payer: "collector" }] }), undefined);
  assert.throws(() => parseFlexCredit({ charge_info: { concept_type: "FLEX", detail_amount: NaN } }), /incompleta/);
});
test("facturación usa períodos reales, pagina detalles y deduplica documentos", async (t) => {
  const detail = (key: number, type = "BONUS", amount = 8990) => ({ charge_info: { concept_type: "FLEX", detail_id: key, detail_type: type, detail_amount: amount }, shipping_info: { shipping_id: 1000, order: { order_id: 100 } } });
  let requests = 0;
  t.mock.method(globalThis, "fetch", async (input: string | URL | Request, init?: RequestInit) => {
    requests++;
    const url = new URL(String(input));
    assert.equal(new Headers(init?.headers).get("authorization"), "Bearer seller-token");
    assert.equal(init?.method ?? "GET", "GET");
    if (url.pathname.endsWith("monthly/periods")) return Response.json({ total: 2, results: [{ key: "2026-08-01", period: { date_to: "2026-08-18" } }, { key: "2026-10-01", period: { date_to: "2026-10-18" } }] });
    assert.ok(url.pathname.includes("2026-10-01"), "late credits for September are found in October billing");
    if (url.searchParams.get("from_id") === "0") return Response.json({ total: 2, results: [detail(900)], last_id: 900, errors: [] });
    assert.equal(url.searchParams.get("from_id"), "900");
    return Response.json({ total: 2, results: [detail(901, "CHARGE", 990)], errors: [] });
  });
  const result = await flexCredits("seller-token", "2026-09-01");
  assert.equal(requests, 6);
  assert.equal(result.length, 2);
  assert.equal(result.reduce((n, c) => n + c.cents, 0), 800000);
});
