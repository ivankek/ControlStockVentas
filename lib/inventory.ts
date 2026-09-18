import { z } from "zod";

export type Role = "ADMIN" | "USER" | "SUPPLIER";
export type AppUser = { id: string; role: Role; display_name: string };
export type MeliAccount = { id: string; owner_id: string; seller_id: string; nickname: string | null; updated_at: string };
export const quantity = z.number().int().min(0).max(1000000000);
export function sellableStock(physical: number, reserved: number, safety: number) {
  [physical, reserved, safety].forEach((n) => quantity.parse(n));
  if (reserved > physical) throw Error("La reserva no puede superar el stock físico.");
  return Math.max(physical - reserved - safety, 0);
}
export function desiredListingQuantity(input: { mode: "REAL" | "FIXED"; sellableStock: number; fixedQuantity?: number | null }) {
  quantity.parse(input.sellableStock);
  if (input.mode === "REAL") return input.sellableStock;
  if (input.mode !== "FIXED") throw Error("Política inválida.");
  const fixed = quantity.parse(input.fixedQuantity);
  return input.sellableStock > 0 ? fixed : 0;
}
export function canManageSupplier(actor: AppUser, supplier: string) {
  return actor.role === "ADMIN" || (actor.role === "SUPPLIER" && actor.id === supplier);
}
export function canConnect(role: Role) { return role === "ADMIN" || role === "USER"; }
export type StockVariant = {
  id: string; product_id: string; supplier_id: string; product_name: string; name: string; sku: string | null;
  physical_stock: number; reserved_stock: number; safety_stock: number; version: number;
  costs: { from: string; cents: number }[];
};
export type StockMapping = {
  account_id: string; item_id: string; variation_id: string; variant_id: string;
  units_per_sale: number; mode: "REAL" | "FIXED"; fixed_quantity: number | null;
  seller_id: string; owner_id: string; nickname: string | null; title: string;
  ml_quantity: number; user_product_id: string | null;
};
export type Movement = {
  id: string; variant_id: string; type: string; quantity_delta: number;
  stock_before: number; stock_after: number; reserved_before: number; reserved_after: number;
  safety_before: number; safety_after: number; actor_id: string; source: string; note: string | null; created_at: string;
};
export type InventorySnapshot = {
  profile: AppUser; accounts: MeliAccount[]; people: AppUser[];
  relationships: { supplier_id: string; seller_user_id: string; active: boolean }[];
  variants: StockVariant[]; mappings: StockMapping[]; movements: Movement[];
  legacy: { owner_id: string; count: number; assigned_supplier_id: string | null }[];
};
const uuid = z.uuid();
export const inventoryCommand = z.discriminatedUnion("type", [
  z.object({ type: z.literal("role"), userId: uuid, role: z.enum(["USER", "SUPPLIER"]) }),
  z.object({ type: z.literal("relationship"), supplierId: uuid, sellerId: uuid, active: z.boolean() }),
  z.object({ type: z.literal("assignLegacy"), ownerId: uuid, supplierId: uuid }),
  z.object({ type: z.literal("product"), supplierId: uuid, productId: uuid.optional(), variantId: uuid.optional(), name: z.string().trim().min(1).max(200), variantName: z.string().trim().min(1).max(100).default("Única"), sku: z.string().trim().min(1, "El SKU es obligatorio.").max(100), date: z.iso.date(), cents: z.number().int().min(0).max(100000000000) }),
  z.object({ type: z.literal("adjust"), variantId: uuid, delta: z.number().int().min(-1000000000).max(1000000000), reserved: quantity, safety: quantity, expectedVersion: quantity, movementType: z.enum(["MANUAL_ADJUSTMENT", "RESTOCK", "CORRECTION"]), note: z.string().trim().min(1).max(500), requestId: uuid }),
  z.object({ type: z.literal("mapping"), accountId: uuid, keys: z.array(z.string().regex(/^[A-Z]+\d+:\d+$/)).min(1).max(1000), variantId: uuid.nullable(), units: z.number().int().min(1).max(10000), mode: z.enum(["REAL", "FIXED"]), fixed: quantity.nullable(), preservePolicy: z.boolean().default(false) }),
]);
