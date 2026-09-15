import { z } from "zod";
import { costAt } from "./domain";
import type { State, Order } from "./domain";
import type { Listing } from "./listings";

export function listingKey(item: Listing) {
  return item.user_product_id && !item.variations.length ? `up:${item.user_product_id}` : `${item.id}:0`;
}
export function listingGroups(items: Listing[], links: State["supplierLinks"] = {}) {
  const groups = new Map<string, Listing[]>();
  for (const item of items) {
    const link = links[`${item.id}:0`];
    const key = item.user_product_id && !item.variations.length ? `up:${item.user_product_id}`
      : !item.variations.length && link ? `supplier:${link.supplierId}:${link.units}` : item.id;
    groups.set(key, [...(groups.get(key) ?? []), item]);
  }
  return [...groups].map(([id, options]) => ({ id, title: options[0].title, options }));
}

const schema = z.discriminatedUnion("type", [
  z.object({ type: z.literal("product"), id: z.string().min(1).max(100), name: z.string().trim().min(1).max(200), date: z.iso.date(), cents: z.number().int().positive().max(100000000000) }),
  z.object({ type: z.literal("link"), keys: z.array(z.string().min(1)).min(1).max(1000), supplierId: z.string().nullable(), units: z.number().int().positive().max(10000) }),
]);
export function updateSupplier(state: State, raw: unknown): State {
  const action = schema.parse(raw);
  const next = structuredClone(state);
  if (action.type === "product") {
    const products = next.supplierProducts ??= [];
    let product = products.find((p) => p.id === action.id);
    if (!product) { product = { id: action.id, name: action.name, costs: [] }; products.push(product); }
    product.name = action.name;
    product.costs = [...product.costs.filter((c) => c.from !== action.date), { from: action.date, cents: action.cents }].sort((a, b) => a.from.localeCompare(b.from));
  } else {
    if (action.supplierId && !next.supplierProducts?.some((p) => p.id === action.supplierId)) throw Error("Producto del proveedor inexistente.");
    const valid = new Set((next.listings ?? []).flatMap((item) => item.variations.length ? item.variations.map((v) => `${item.id}:${v.id}`) : [listingKey(item), `${item.id}:0`]));
    if (action.keys.some((key) => !valid.has(key))) throw Error("La publicación o variante ya no está disponible. Actualizá la pantalla.");
    const links = next.supplierLinks ??= {};
    for (const key of action.keys) {
      if (action.supplierId) links[key] = { supplierId: action.supplierId, units: action.units };
      else delete links[key];
    }
  }
  return next;
}

export function supplierReport(state: State, orders: Order[], date: string) {
  const rows = new Map<string, { id: string; name: string; units: number; unitCents: number; totalCents: number }>();
  const details = orders.map((order) => {
    const missing: string[] = [];
    let totalCents = 0;
    for (const line of order.lines) {
      const [itemId, variant = "0"] = line.productId.split(":");
      const item = state.listings?.find((p) => p.id === itemId);
      const link = state.supplierLinks?.[line.productId] ?? (variant === "0" && item ? state.supplierLinks?.[listingKey(item)] : undefined);
      const product = state.supplierProducts?.find((p) => p.id === link?.supplierId);
      const cost = costAt(product, date);
      if (!link || !product || cost === undefined) {
        missing.push(`${line.productId}: ${!link || !product ? "sin producto del proveedor asociado" : "sin costo vigente en esta fecha"}`); continue;
      }
      const units = line.quantity * link.units;
      const subtotal = units * cost;
      if (!Number.isSafeInteger(subtotal) || !Number.isSafeInteger(totalCents + subtotal)) throw Error("El importe supera el límite permitido.");
      totalCents += subtotal;
      const row = rows.get(product.id) ?? { id: product.id, name: product.name, units: 0, unitCents: cost, totalCents: 0 };
      row.units += units; row.totalCents += subtotal; rows.set(product.id, row);
    }
    return { orderId: order.id, totalCents, missing, review: !!order.cancelled || !!order.review };
  });
  const totalCents = details.reduce((sum, d) => sum + d.totalCents, 0);
  if (!Number.isSafeInteger(totalCents)) throw Error("El total supera el límite permitido.");
  return { rows: [...rows.values()], orders: details, totalCents, complete: details.every((d) => !d.missing.length && !d.review) };
}
