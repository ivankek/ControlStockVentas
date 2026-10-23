import test from "node:test";
import assert from "node:assert/strict";
import { emptyState } from "../lib/domain";
import { emptyBusiness, updateBusiness } from "../lib/business";
import { profitRows, type Sale } from "../lib/profit";
const sale = (extra: Partial<Sale> = {}): Sale => ({ id: "100", createdAt: "2026-10-02T12:00:00Z", orderStatus: "paid", cancelled: false, mode: "flex", province: "Capital Federal", city: "Flores", shipmentId: "1000", lines: [{ productId: "MLA1:0", quantity: 1 }], grossCents: 4000000, receivedCents: 3000000, paymentIds: ["500"], issues: [], ...extra });
const state = () => ({ ...emptyState(), business: emptyBusiness(), supplierProducts: [{ id: "p", name: "Producto", costs: [{ from: "2026-09-01", cents: 1000000 }] }], supplierLinks: { "MLA1:0": { supplierId: "p", units: 1 } } });
test("Flex pendiente: decisión manual suma solo cuando corresponde y se puede quitar", () => {
  const s = state(), order = sale({ discountsUnavailable: true });
  assert.equal(profitRows(s, [order])[0].net, undefined);
  const included = updateBusiness(s, { type: "note", id: order.id, flexBonus: "included" }, order);
  assert.equal(profitRows(included, [order])[0].received, 3000000);
  assert.equal(profitRows(included, [order])[0].bonusUnresolved, false);
  const add = updateBusiness(s, { type: "note", id: order.id, flexBonus: "add" }, order);
  assert.equal(profitRows(add, [order])[0].received, 3069900);
  assert.equal(profitRows(add, [order])[0].net, 3069900 - 1000000 - 320000);
  const automatic = updateBusiness(add, { type: "note", id: order.id, flexBonus: null }, order);
  assert.equal(profitRows(automatic, [order])[0].net, undefined);
  assert.throws(() => updateBusiness(s, { type: "note", id: order.id, flexBonus: "add" }, sale({ mode: "correo" })), /solo se aplica a Flex/);
});
test("envío compartido suma una vez aunque se confirme en la segunda orden y detecta conflictos", () => {
  const orders = [sale(), sale({ id: "101", paymentIds: ["501"] })];
  let s = updateBusiness(state(), { type: "note", id: "101", flexBonus: "add" }, orders[1]);
  const rows = profitRows(s, orders);
  assert.equal(rows.reduce((sum, row) => sum + row.bonusAdded, 0), 69900);
  assert.ok(rows.every((row) => row.net !== undefined));
  s = updateBusiness(s, { type: "note", id: "100", flexBonus: "included" }, orders[0]);
  assert.ok(profitRows(s, orders).every((row) => row.net === undefined));
});
test("decisión no inventa recibido ni costos ni duplica un neto final manual", () => {
  const order = sale();
  let s = updateBusiness(state(), { type: "note", id: "100", flexBonus: "add" }, order);
  assert.equal(profitRows(s, [sale({ receivedCents: undefined })])[0].net, undefined);
  assert.equal(profitRows(s, [sale({ city: "", province: "" })])[0].net, undefined);
  s = updateBusiness(s, { type: "note", id: "100", netCents: 3000000 }, order);
  assert.equal(profitRows(s, [order])[0].bonusAdded, 0);
  assert.equal(profitRows(s, [order])[0].received, 3000000);
});
