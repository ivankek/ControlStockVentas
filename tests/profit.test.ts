import test from "node:test";
import assert from "node:assert/strict";
import { emptyState } from "../lib/domain";
import { businessCommand, emptyBusiness, flexCost, manualDispatches, updateBusiness } from "../lib/business";
import { monthlyExpenses, expenseBreakdown, profitRows, reportTotals, type Sale } from "../lib/profit";

const sale = (overrides: Partial<Sale> = {}): Sale => ({ id: "100", createdAt: "2026-09-10T15:00:00Z", mode: "correo", cancelled: false, orderStatus: "paid", grossCents: 10000, receivedCents: 8000, paymentIds: ["1"], issues: [], lines: [{ productId: "MLA1:0", quantity: 2 }], ...overrides });
const state = () => ({ ...emptyState(), supplierProducts: [{ id: "p", name: "Producto", costs: [{ from: "2026-01-01", cents: 1000 }] }], supplierLinks: { "MLA1:0": { supplierId: "p", units: 2 } }, business: emptyBusiness() });

test("confirmación manual se superpone sin guardar ventas y se puede quitar", () => {
  const original = state();
  const order = sale({ mode: "acordar" });
  const saved = updateBusiness(original, { type: "note", id: order.id, dispatchedDate: "2026-09-11", shippingCents: 0 }, order);
  assert.equal(saved.orders.length, 0);
  assert.equal(original.business.notes[order.id], undefined);
  assert.equal(manualDispatches([order], saved.business)[0].dispatchedDate, "2026-09-11");
  assert.equal(manualDispatches([sale()], saved.business)[0].dispatchedDate, undefined);
  const cleared = updateBusiness(saved, { type: "note", id: order.id, dispatchedDate: null }, order);
  assert.equal(manualDispatches([order], cleared.business)[0].dispatchedDate, undefined);
  assert.equal(cleared.business!.notes[order.id].shippingCents, 0);
  assert.throws(() => updateBusiness(original, { type: "note", id: order.id, dispatchedDate: "2026-09-09" }, order));
  assert.throws(() => updateBusiness(original, { type: "note", id: order.id, dispatchedDate: "2026-09-11" }, sale()));
  assert.throws(() => updateBusiness(original, { type: "note", id: order.id, dispatchedDate: "2026-09-11" }, { ...order, cancelled: true }));
});

test("tarifas Flex por localidad y vigencia; las coincidencias ambiguas no suman ni eligen arbitrariamente", () => {
  const business = emptyBusiness();
  business.zones = [{ id: "z", name: "Oeste", province: "Buenos Aires", cities: ["Morón"], rates: [{ from: "2026-01-01", cents: 1500 }, { from: "2026-09-01", cents: 2000 }] }];
  const order = sale({ mode: "flex", province: " buenos aires ", city: "Moron" });
  assert.equal(flexCost(business, order, "2026-08-31"), 1500);
  assert.equal(flexCost(business, order, "2026-09-01"), 2000);
  assert.equal(flexCost(business, order, "2025-12-31"), undefined);
  assert.equal(flexCost(business, { ...order, city: "Otra localidad" }, "2026-09-01"), undefined);
  business.zones.push({ ...business.zones[0], id: "z2" });
  assert.equal(flexCost(business, order, "2026-09-01"), undefined);
});

test("neto resta costo por unidades y logística propia una vez, sin volver a restar comisiones", () => {
  const s = state();
  s.business.zones = [{ id: "z", name: "Zona", province: "Buenos Aires", cities: ["Morón"], rates: [{ from: "2026-01-01", cents: 1000 }] }];
  const orders = [sale({ mode: "flex", province: "Buenos Aires", city: "Morón", shipmentId: "123" }), sale({ id: "101", paymentIds: ["2"], mode: "flex", province: "Buenos Aires", city: "Morón", shipmentId: "123" })];
  const rows = profitRows(s, orders);
  assert.equal(rows[0].gross, 10000);
  assert.equal(rows[0].supplier, 4000);
  assert.equal(rows[0].shipping, 420000);
  assert.equal(rows[0].net, -416000);
  assert.equal(rows[1].net, 4000);
  assert.equal(profitRows(s, [sale()])[0].net, 4000);
  assert.equal(profitRows(s, [sale({ mode: "flex" })])[0].shipping, undefined, "Flex sin localidad queda pendiente");
});

test("importes faltantes, reembolsos y pagos compartidos no se convierten en ganancia", () => {
  const s = state();
  assert.equal(profitRows(s, [sale({ receivedCents: undefined })])[0].net, undefined);
  assert.equal(profitRows(s, [sale({ mode: "acordar" })])[0].net, undefined);
  assert.equal(profitRows(s, [sale({ orderStatus: "partially_refunded" })])[0].net, undefined);
  assert.equal(profitRows(s, [sale({ id: "1" }), sale({ id: "2" })])[0].net, undefined);
  s.business.notes["100"] = { shippingCents: 0, netCents: 7500, updatedAt: "" };
  assert.equal(profitRows(s, [sale({ mode: "acordar", receivedCents: undefined })])[0].net, 3500);
  const noCost = state(); noCost.supplierProducts[0].costs = [{ from: "2026-10-01", cents: 1000 }];
  assert.equal(profitRows(noCost, [sale()])[0].net, undefined);
});

test("gastos mensuales prorrateados reconcilian centavos entre meses y año bisiesto", () => {
  const b = emptyBusiness(); b.months["2024-02"] = { taxCents: 10001, billingCents: 2000 }; b.months["2024-03"] = { taxCents: 3100, billingCents: 0 };
  assert.equal(monthlyExpenses(b, "2024-02-01", "2024-02-29").total, 12001);
  let sum = 0;
  for (let day = 1; day <= 29; day++) { const date = `2024-02-${String(day).padStart(2, "0")}`; sum += monthlyExpenses(b, date, date).total; }
  assert.equal(sum, 12001);
  assert.equal(monthlyExpenses(b, "2024-02-01", "2024-03-31").total, 15101);
  assert.deepEqual(reportTotals([], b, "2024-01-31", "2024-02-01").missingMonths, ["2024-01"]);
  const parts = expenseBreakdown(b, "2024-02-28", "2024-03-03");
  assert.deepEqual(parts.map((part) => [part.days, part.daysInMonth]), [[2, 29], [3, 31]]);
  assert.equal(parts.reduce((sum, part) => sum + part.total, 0), monthlyExpenses(b, "2024-02-28", "2024-03-03").total);
  assert.equal(businessCommand.safeParse({ type: "month", month: "2026-13", taxCents: 0, billingCents: 0 }).success, false);
});
