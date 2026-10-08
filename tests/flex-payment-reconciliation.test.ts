import test from "node:test";
import assert from "node:assert/strict";
import ExcelJS from "exceljs";
import { orderPaymentFee, paymentBase } from "../lib/flex-credits";
import { emptyState } from "../lib/domain";
import { emptyBusiness } from "../lib/business";
import { profitRows, reportTotals, type Sale } from "../lib/profit";
import { profitExcel } from "../lib/profit-excel";

const state = () => ({ ...emptyState(), business: { ...emptyBusiness(), flexRates: { CORDON_2: [{ from: "2026-01-01", cents: 430000 }], CABA: [{ from: "2026-01-01", cents: 355000 }] } }, supplierProducts: [{ id: "p", name: "Producto", costs: [{ from: "2026-01-01", cents: 1050000 }] }], supplierLinks: { "MLA1:0": { supplierId: "p", units: 1 } } });
const sale = (more: Partial<Sale> = {}): Sale => ({ id: "2000018869394048", createdAt: "2026-10-08T12:59:11Z", mode: "flex", orderStatus: "paid", cancelled: false, province: "Buenos Aires", city: "Pablo Nogués", georef: { zone: "CORDON_2", method: "georef-coordinates", municipality: "Malvinas Argentinas", reason: "Destino de la venta" }, grossCents: 2590000, receivedCents: 2683500, paymentIds: ["182048859809"], issues: [], lines: [{ productId: "MLA1:0", quantity: 1 }], shipmentId: "48206072525", ...more });
function baseline(amount: number, fee: number) {
  const order = { payments: [{ id: 1, status: "approved", marketplace_fee: fee }], order_items: [{ quantity: 1, sale_fee: fee }] };
  return paymentBase({ transaction_amount: amount, taxes_amount: 0, fee_details: [] }, orderPaymentFee(order, 1));
}

test("tensiómetro: envío ya incluido no suma $8.990 otra vez; total y Excel coinciden", async () => {
  const s = state();
  const rows = profitRows(s, [sale({ paymentBaseCents: baseline(24900, 7055) })]);
  assert.equal(rows[0].sale.paymentBaseCents, 1784500);
  assert.equal(rows[0].received, 2683500);
  assert.equal(rows[0].bonusAdded, 0);
  assert.equal(rows[0].net, 1203500);
  assert.equal(reportTotals(rows, s.business, "2026-10-08", "2026-10-08").net, 1203500);
  const book = new ExcelJS.Workbook();
  await book.xlsx.load(await profitExcel(rows, s) as never);
  assert.equal(book.worksheets[0].getCell("I2").value, 26835);
  assert.equal(book.worksheets[0].getCell("M2").value, 12035);
});

test("secarropa: agrega $699 cuando el recibido todavía no los incluye", () => {
  const s = state(); s.supplierProducts[0].costs[0].cents = 2000000;
  const row = profitRows(s, [sale({ province: "Capital Federal", city: "Flores", georef: undefined, grossCents: 4427874, receivedCents: 3801330, paymentBaseCents: baseline(44278.74, 6265.44) })])[0];
  assert.equal(row.bonusAdded, 69900);
  assert.equal(row.received, 3871230);
  assert.equal(row.net, 1516230);
});

test("comisión vacía no significa cero; fallback respeta unidades, pagos y comisiones ya informadas", () => {
  const data = { transaction_amount: 24900, taxes_amount: 0, fee_details: [] };
  assert.equal(paymentBase(data), undefined);
  assert.equal(paymentBase({ ...data, fee_details: [{ type: "marketplace_fee", fee_payer: "collector", amount: 7055 }] }, 705500), 1784500);
  const order = { payments: [{ id: 1, status: "approved" }], order_items: [{ quantity: 2, sale_fee: 100 }] };
  assert.equal(orderPaymentFee(order, 1), 20000);
  assert.equal(orderPaymentFee({ ...order, payments: [...order.payments, { id: 2, status: "approved" }] }, 1), undefined);
  assert.equal(orderPaymentFee(order, 2), undefined);
  assert.equal(paymentBase({ ...data, transaction_amount: NaN }, 705500), undefined);
  assert.equal(paymentBase({ ...data, taxes_amount: -1 }, 705500), undefined);
});

test("desglose ausente o contradictorio conserva recibido sin inventar un neto; manual sigue siendo final", () => {
  for (const base of [undefined, 2490000, 1784400]) {
    const row = profitRows(state(), [sale({ paymentBaseCents: base })])[0];
    assert.equal(row.received, 2683500);
    assert.equal(row.bonusAdded, 0);
    assert.equal(row.bonusUnresolved, true);
    assert.equal(row.net, undefined);
  }
  const s = state(); s.business.notes[sale().id] = { updatedAt: "", netCents: 2683500 };
  assert.equal(profitRows(s, [sale()])[0].net, 1203500);
});

test("envío compartido: reconoce ingreso incluido en la segunda orden", () => {
  const rows = profitRows(state(), [sale({ id: "1", grossCents: 1000000, receivedCents: 800000, paymentBaseCents: 800000 }), sale({ id: "2", grossCents: 1000000, paymentIds: ["2"], receivedCents: 1699000, paymentBaseCents: 800000 })]);
  assert.equal(rows.reduce((sum, r) => sum + r.bonusAdded, 0), 0);
  assert.equal(rows[0].bonusUnresolved, false);
  assert.equal(rows[1].bonusElsewhere, true);
});


test("detecta envío incluido aunque el recibido sea menor que el bruto", () => {
  const row = profitRows(state(), [sale({ grossCents: 4000000, receivedCents: 3089900, paymentBaseCents: 3000000 })])[0];
  assert.equal(row.bonusAdded, 0);
  assert.equal(row.bonusUnresolved, false);
  assert.equal(row.received, 3089900);
});
