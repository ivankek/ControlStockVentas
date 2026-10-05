import test from "node:test";
import assert from "node:assert/strict";
import { flexCredits, flexCreditReport, parseFlexCredit, paymentBase } from "../lib/flex-credits";

const credit = { id: "900", shipmentId: "1000", orderId: "100", cents: 899000 };

test("error de facturación identifica el recurso y nunca se interpreta como cero", async (t) => {
  t.mock.method(globalThis, "fetch", async () => Response.json({}, { status: 403 }));
  await assert.rejects(flexCredits("private-token", "2026-09-01"), /Períodos de facturación BILL:.*403/);
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

test("facturación parcial conserva movimientos y detalla el recurso fallido", async (t) => {
  t.mock.method(globalThis, "fetch", async (input: string | URL | Request) => {
    const url = new URL(String(input));
    if (url.searchParams.get("document_type") === "CREDIT_NOTE") return Response.json({}, { status: 403 });
    if (url.pathname.endsWith("monthly/periods")) return Response.json({ total: 2, results: [{ key: "2026-09-01", period: { date_to: "2026-09-30" } }, { key: "2026-10-01", period: { date_to: "2026-10-31" } }] });
    if (url.pathname.includes("2026-09-01")) return Response.json({}, { status: 400 });
    return Response.json({ total: 1, results: [{ charge_info: { concept_type: "FLEX", detail_id: 900, detail_type: "BONUS", detail_amount: 8990 }, shipping_info: { shipping_id: 1000, order: { order_id: 100 } } }] });
  });
  const report = await flexCreditReport("seller-token", "2026-09-01");
  assert.deepEqual(report.credits, [credit]);
  assert.equal(report.warnings.length, 2);
  assert.match(report.warnings.join(" "), /2026-09-01.*400/);
  assert.match(report.warnings.join(" "), /CREDIT_NOTE.*403/);
});
