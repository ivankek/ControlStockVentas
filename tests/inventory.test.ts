import test from "node:test";
import assert from "node:assert/strict";
import { visibleInventory, type InventorySnapshot, canConnect, canManageSupplier, desiredListingQuantity, inventoryCommand } from "../lib/inventory";
test("stock único; REAL/FIXED sin efectos externos", () => {
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

test("stock prices are visible only to administrators and suppliers", () => {
  const data: InventorySnapshot = {
    profile: { id: "seller", role: "USER", display_name: "Seller" },
    accounts: [], people: [], relationships: [], mappings: [], movements: [], legacy: [],
    variants: [{ id: "variant", product_id: "product", supplier_id: "supplier", product_name: "Product", name: "Única", sku: "SKU", stock: 12, version: 1, costs: [{ from: "2026-01-01", cents: 1500 }] }],
  };
  const visible = visibleInventory(data);
  assert.deepEqual(visible.variants[0].costs, []);
  assert.equal(visible.variants[0].stock, 12);
  assert.equal(data.variants[0].costs[0].cents, 1500);
  for (const role of ["ADMIN", "SUPPLIER"] as const) {
    assert.deepEqual(visibleInventory({ ...data, profile: { ...data.profile, role } }).variants[0].costs, data.variants[0].costs);
  }
});
