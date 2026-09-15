import test from "node:test";
import assert from "node:assert/strict";
import { normalizeListing } from "../lib/listings";
import { installmentLabel } from "../lib/sale-option";
test("conserva envío gratis y distingue campañas de cuotas y datos faltantes", () => {
  const base = { id: "MLA1", seller_id: 42, title: "Bandeja", price: 38000, currency_id: "ARS", available_quantity: 0, status: "paused" };
  const item = normalizeListing({ ...base, listing_type_id: "gold_pro", tags: ["3x_campaign"], shipping: { free_shipping: true, other: "ignored" } }, 42);
  assert.equal(item.shipping?.free_shipping, true);
  assert.equal(installmentLabel(item), "3 cuotas al mismo precio publicado");
  assert.equal(installmentLabel({ ...item, tags: [] }), "6 cuotas al mismo precio publicado");
  assert.equal(installmentLabel({ ...item, tags: undefined }), "Cuotas: actualizá las publicaciones");
  assert.equal(installmentLabel({ ...item, listing_type_id: "gold_special", tags: [] }), "Sin cuotas agregadas por el vendedor");
  assert.equal(installmentLabel({ ...item, tags: ["pcj-co-funded"] }), "3 a 12 cuotas con interés bajo");
});
