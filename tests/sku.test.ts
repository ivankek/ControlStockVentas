import test from "node:test";
import assert from "node:assert/strict";
import { skuPlan, meliSkuEntries } from "../lib/sku";
import { normalizeListing } from "../lib/listings";
import { normalizeNubeProduct } from "../lib/tiendanube-catalog";

test("SKU exacto, vacíos, duplicados y ceros iniciales: solo emite asociaciones inequívocas", () => {
  const result = skuPlan([{ key: "a", sku: " 001 " }, { key: "b", sku: null }, { key: "c", sku: "1" }, { key: "d", sku: "DUP" }, { key: "e", sku: "abc" }],
    [{ id: "one", sku: "001" }, { id: "two", sku: "DUP" }, { id: "three", sku: "DUP" }, { id: "four", sku: "ABC" }]);
  assert.deepEqual(result, { matches: { a: "one" }, missing: 1, unmatched: 2, ambiguous: 1 });
  assert.deepEqual({ b: "manual", ...result.matches }, { b: "manual", a: "one" });
});
test("SKU de cada variante ML, sin heredar SKU del padre ni confundir campo personalizado", () => {
  const base = { id: "MLA1", seller_id: 42, price: 100, available_quantity: 1, title: "Producto", currency_id: "ARS", status: "active" };
  const item = normalizeListing({ ...base, attributes: [{ id: "SELLER_SKU", value_name: "PARENT" }], variations: [
    { id: 1, price: 100, available_quantity: 1, attributes: [{ id: "SELLER_SKU", value_name: "VAR" }] },
    { id: 2, price: 100, available_quantity: 1, seller_custom_field: "INTERNAL" },
  ] }, 42);
  assert.deepEqual(meliSkuEntries([item]), [{ key: "MLA1:1", sku: "VAR" }, { key: "MLA1:2", sku: undefined }]);
});
test("Tiendanube normaliza variantes con SKU y stock ilimitado sin guardar datos ajenos al catálogo", () => {
  const p = normalizeNubeProduct({ id: 10, name: { es: "Producto" }, published: true, variants: [{ id: 20, sku: "001", stock: null, price: "123.45", values: [{ es: "Rojo" }] }], description: "irrelevant" });
  assert.deepEqual(p, { id: "10", title: "Producto", published: true, variants: [{ id: "20", sku: "001", stock: null, price: "123.45", title: "Rojo" }] });
});
