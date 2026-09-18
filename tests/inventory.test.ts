import test from "node:test";
import assert from "node:assert/strict";
import { canConnect, canManageSupplier, desiredListingQuantity, inventoryCommand, sellableStock } from "../lib/inventory";
test("inventario físico, reserva y seguridad; REAL/FIXED sin efectos externos", () => {
  assert.equal(sellableStock(20, 2), 18);
  assert.equal(sellableStock(3, 0), 3);
  assert.equal(sellableStock(3, 2), 1);
  for (const args of [[-1, 0], [1, 2], [1.5, 0], [Infinity, 0]]) assert.throws(() => sellableStock(...args as [number, number]));
  assert.equal(desiredListingQuantity({ mode: "REAL", sellableStock: 15 }), 15);
  assert.equal(desiredListingQuantity({ mode: "FIXED", sellableStock: 15, fixedQuantity: 999 }), 999);
  assert.equal(desiredListingQuantity({ mode: "FIXED", sellableStock: 0, fixedQuantity: 999 }), 0);
  for (const fixed of [undefined, null, -1, 1.1, NaN]) assert.throws(() => desiredListingQuantity({ mode: "FIXED", sellableStock: 15, fixedQuantity: fixed }));
});
test("roles de UI coherentes con backend; comandos manuales únicamente", () => {
  assert.ok(canConnect("ADMIN")); assert.ok(canConnect("USER")); assert.equal(canConnect("SUPPLIER"), false);
  assert.ok(canManageSupplier({ id: "a", role: "ADMIN", display_name: "" }, "b"));
  assert.ok(canManageSupplier({ id: "a", role: "SUPPLIER", display_name: "" }, "a"));
  assert.equal(canManageSupplier({ id: "a", role: "SUPPLIER", display_name: "" }, "b"), false);
  assert.equal(canManageSupplier({ id: "a", role: "USER", display_name: "" }, "a"), false);
  assert.equal(inventoryCommand.safeParse({ type: "role", userId: "00000000-0000-4000-8000-000000000001", role: "ADMIN" }).success, false);
  assert.equal(inventoryCommand.safeParse({ type: "adjust", movementType: "SALE" }).success, false);
});
