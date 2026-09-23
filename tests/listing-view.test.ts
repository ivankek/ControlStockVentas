import test from "node:test";
import assert from "node:assert/strict";
import { listingView } from "../lib/listing-view";
import { normalizeListing } from "../lib/listings";
import type { StockMapping, StockVariant } from "../lib/inventory";
const item = (id: string, title: string, stock: number) => normalizeListing({ id, title, seller_id: 42, price: stock * 100, currency_id: "ARS", available_quantity: stock, status: "active" }, 42);
const mapping = (item_id: string, account_id = "a", variation_id = "0") => ({ item_id, account_id, variation_id, variant_id: "p" } as StockMapping);
test("asociación por cuenta y todas las opciones, filtros, orden y actualización inmediata", () => {
  const items = [item("MLA1", "Cepillo", 20), item("MLA2", "Cepillo", 20), item("MLA3", "Ábaco", 0), item("MLA4", "Bolsa", 10)];
  const mappings = [mapping("MLA1"), mapping("MLA3"), mapping("MLA4", "otra")];
  const variants = [{ id: "p", product_name: "Producto del proveedor" } as StockVariant];
  const rows = listingView(items, mappings, variants, "a", "", "all", "unlinked");
  assert.deepEqual(rows.map((r) => r.association), ["none", "partial", "complete"]);
  assert.equal(rows[1].stock, 20); // Shared quantities must not be summed.
  assert.deepEqual(rows[1].products, ["Producto del proveedor"]);
  assert.equal(listingView(items, mappings, variants, "a", "abaco", "complete").length, 1);
  assert.deepEqual(listingView(items, mappings, variants, "a", "", "none").map((g) => g.id), ["MLA4"]);
  assert.deepEqual(listingView(items, mappings, variants, "a", "", "all", "stock").map((g) => g.stock), [0, 10, 20]);
  assert.deepEqual(listingView(items, mappings, variants, "a", "", "all", "price-desc").map((g) => g.price), [2000, 1000, 0]);
  assert.equal(listingView(items, [...mappings, mapping("MLA2")], variants, "a", "Cepillo")[0].association, "complete");
  const varied = { ...items[0], variations: [{ id: "11", price: 10, available_quantity: 2, attribute_combinations: [] }, { id: "12", price: 10, available_quantity: 3, attribute_combinations: [] }] };
  assert.equal(listingView([varied], [mapping("MLA1", "a", "11")], variants, "a")[0].association, "partial");
});
