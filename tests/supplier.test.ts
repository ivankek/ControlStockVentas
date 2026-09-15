import test from "node:test";
import assert from "node:assert/strict";
import { emptyState, type State, type Order } from "../lib/domain";
import { normalizeListing, mergeListings } from "../lib/listings";
import { listingGroups, supplierReport, updateSupplier } from "../lib/supplier";
const listing = (id: string, up?: string) => normalizeListing({ id, user_product_id: up, seller_id: 42, title: "Mismo título", price: 100, currency_id: "ARS", status: "active", available_quantity: 4 }, 42);
test("agrupa opciones por UP, sin confundir colores ni sumar stock", () => {
  const groups = listingGroups([listing("MLA1", "UP1"), listing("MLA2", "UP1"), { ...listing("MLA3", "UP2"), title: "Producto rosa" }, { ...listing("MLA4"), title: "Producto blanco" }]);
  assert.equal(groups.length, 3); assert.equal(groups[0].options.length, 2);
});
test("agrupa opciones de nombre exacto incluso con UP distintos, sin depender de asociaciones", () => {
  const items = [listing("MLA3892703454", "UP1"), { ...listing("MLA3892704876", "UP2"), price: 38000 }];
  assert.equal(listingGroups(items).length, 1);
  assert.equal(listingGroups(items, { "MLA3892703454:0": { supplierId: "p", units: 2 } }).length, 1);
  assert.equal(listingGroups([items[0], { ...items[1], title: "Otro producto" }]).length, 2);
});
test("costos por fecha, packs, varias opciones, incompletos e incidencias", () => {
  let state: State = { ...emptyState(), listings: [listing("MLA1", "UP1"), listing("MLA2", "UP1")] };
  state = updateSupplier(state, { type: "product", id: "p1", name: "Cepillo", date: "2026-09-01", cents: 1000 });
  state = updateSupplier(state, { type: "product", id: "p1", name: "Cepillo", date: "2026-09-15", cents: 2000 });
  state = updateSupplier(state, { type: "link", keys: ["up:UP1"], supplierId: "p1", units: 2 });
  const order: Order = { id: "1", createdAt: "2026-09-13", mode: "flex", cancelled: false, dispatchedDate: "2026-09-14", lines: [{ productId: "MLA1:0", quantity: 3 }, { productId: "MLA2:0", quantity: 1 }] };
  const report = supplierReport(state, [order], "2026-09-14");
  assert.equal(report.totalCents, 8000); assert.equal(report.rows[0].units, 8); assert.equal(report.complete, true);
  assert.equal(supplierReport(state, [order], "2026-09-15").totalCents, 16000);
  assert.equal(supplierReport(state, [order], "2026-08-01").complete, false);
  assert.equal(supplierReport(state, [{ ...order, cancelled: true }], "2026-09-14").complete, false);
  assert.equal(supplierReport(state, [{ ...order, lines: [{ productId: "MLA99:0", quantity: 1 }] }], "2026-09-14").orders[0].missing.length, 1);
  assert.deepEqual(state.orders, []);
  assert.throws(() => updateSupplier(state, { type: "link", keys: ["MLA99:0"], supplierId: "p1", units: 1 }));
  assert.throws(() => updateSupplier(state, { type: "link", keys: ["up:UP1"], supplierId: "other", units: 1 }));
});
test("variantes se asocian individualmente y reimportar preserva asociaciones", () => {
  const item = listing("MLA1");
  item.variations = [{ id: "11", price: 100, available_quantity: 2, attribute_combinations: [] }, { id: "12", price: 100, available_quantity: 2, attribute_combinations: [] }];
  let state: State = { ...emptyState(), listings: [item] };
  state = updateSupplier(state, { type: "product", id: "p", name: "Variante", date: "2026-01-01", cents: 100 });
  state = updateSupplier(state, { type: "link", keys: ["MLA1:11"], supplierId: "p", units: 1 });
  state = { ...state, listings: mergeListings(state.listings!, [{ ...item, price: 500 }]).listings };
  assert.equal(state.supplierLinks?.["MLA1:11"].supplierId, "p");
  const order: Order = { id: "1", mode: "correo", createdAt: "2026-09-01", cancelled: false, lines: [{ productId: "MLA1:11", quantity: 2 }, { productId: "MLA1:12", quantity: 1 }] };
  const report = supplierReport(state, [order], "2026-09-01");
  assert.equal(report.totalCents, 200); assert.equal(report.complete, false);
  assert.throws(() => updateSupplier(state, { type: "link", keys: ["MLA1:0"], supplierId: "p", units: 1 }));
});
