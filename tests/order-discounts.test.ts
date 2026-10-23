import test from "node:test";
import assert from "node:assert/strict";
import { discountedGross } from "../lib/order-discounts";
import type { RawOrder } from "../lib/meli";
const order = (total = 42750): RawOrder => ({ id: 1, date_created: "2026-10-23", status: "paid", total_amount: total, order_items: [{ item: { id: "MLA1", title: "Producto" }, quantity: 1, unit_price: 42750 }] });
const coupon = { details: [{ type: "coupon", items: [{ amounts: { total: 1000, seller: 1000 } }] }] };
test("cupón de $1.000: bruto de $42.750 pasa a $41.750 sin descontarlo dos veces", () => {
  assert.deepEqual(discountedGross(order(), coupon), { grossCents: 4175000, discountCents: 100000 });
  assert.deepEqual(discountedGross(order(41750), coupon), { grossCents: 4175000, discountCents: 100000 });
});
test("promociones ya incluidas y cupones financiados por ML no se descuentan otra vez", () => {
  const raw = order(); raw.order_items[0].gross_price = 45000;
  assert.deepEqual(discountedGross(raw, { details: [{ type: "discount", items: [{ amounts: { total: 2250, seller: 2250 } }] }, { type: "coupon", items: [{ amounts: { total: 1000, seller: 0 } }] }] }), { grossCents: 4275000, discountCents: 225000 });
});
test("montos de cupón inválidos no se convierten en cero", () => {
  assert.throws(() => discountedGross(order(), { details: [{ type: "coupon", items: [{ amounts: { total: 1000, seller: NaN } }] }] }));
});
