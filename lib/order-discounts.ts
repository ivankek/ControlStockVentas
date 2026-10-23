import type { RawOrder } from "./meli";
export type OrderDiscounts = { details: { type: string; items: { amounts: { total: number; seller: number } }[] }[] };
const cents = (n: unknown) => typeof n === "number" && Number.isFinite(n) && n >= 0 && Number.isSafeInteger(Math.round(n * 100)) ? Math.round(n * 100) : undefined;

// Unit prices already include promotions. Coupons are separate; never subtract
// a promotion again or treat Mercado Libre's funded portion as a seller cost.
export function discountedGross(order: RawOrder, discounts: OrderDiscounts) {
  const total = cents(order.total_amount);
  if (total === undefined || !Array.isArray(discounts.details)) throw Error("Descuentos incompletos");
  let coupon = 0;
  for (const detail of discounts.details) {
    if (detail.type !== "coupon") continue;
    if (!Array.isArray(detail.items)) throw Error("Cupón incompleto");
    for (const item of detail.items) {
      const seller = cents(item.amounts?.seller), full = cents(item.amounts?.total);
      if (seller === undefined || full === undefined || seller > full) throw Error("Importe del cupón incompleto");
      coupon += seller;
    }
  }
  const prices = order.order_items.map((item) => cents(item.unit_price));
  if (coupon && prices.some((p) => p === undefined)) throw Error("Falta el precio para verificar el cupón");
  const itemsTotal = prices.every((p) => p !== undefined) ? prices.reduce<number>((sum, p, i) => sum + p! * order.order_items[i].quantity, 0) : total;
  if (coupon > itemsTotal) throw Error("El cupón supera el importe de la venta");
  // total_amount may already contain the coupon. Use the lower total once.
  const grossCents = Math.min(total, itemsTotal - coupon);
  const original = order.order_items.every((item) => cents(item.gross_price) !== undefined) ? order.order_items.reduce((sum, item) => sum + cents(item.gross_price)!, 0) : Math.max(total, itemsTotal);
  return { grossCents, discountCents: Math.max(0, original - grossCents) };
}
