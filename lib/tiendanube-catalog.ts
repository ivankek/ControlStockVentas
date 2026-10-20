import { z } from "zod";
const id = z.union([z.number().int().safe().positive(), z.string().regex(/^\d+$/)]).transform(String);
const localized = z.record(z.string(), z.string());
export function localName(value: Record<string, string>) { return value.es || value.pt || value.en || Object.values(value).find(Boolean) || ""; }
const rawProduct = z.object({
  id, name: localized, published: z.boolean(), variants: z.array(z.object({
    id, sku: z.string().nullish(), price: z.union([z.string(), z.number()]).nullable(),
    stock: z.number().int().nonnegative().nullable(), values: z.array(localized).default([]),
  })),
});
export function normalizeNubeProduct(raw: unknown) {
  const p = rawProduct.parse(raw);
  return { id: p.id, title: localName(p.name), published: p.published, variants: p.variants.map((v) => ({
    id: v.id, sku: v.sku ?? "", price: v.price === null ? null : String(v.price), stock: v.stock,
    title: v.values.map(localName).join(" / "),
  })) };
}
export type NubeProduct = ReturnType<typeof normalizeNubeProduct>;
export type NubeAccount = { id: string; store_id: string; name: string };
export type NubeCatalog = { products: NubeProduct[]; links: Record<string, string>; version: number };
