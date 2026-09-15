import { z } from "zod";
import { isDeepStrictEqual } from "node:util";

const quantity = z.number().int().nonnegative();
const variationSchema = z.object({
  id: z.union([z.number().int().safe(), z.string()]).transform(String),
  price: z.number().nonnegative(),
  available_quantity: quantity,
  attribute_combinations: z.array(z.object({
    name: z.string().nullish(), value_name: z.string().nullish(),
  })).default([]),
});
const itemSchema = z.object({
  id: z.string().regex(/^[A-Z]+\d+$/),
  seller_id: z.number().int().safe(),
  user_product_id: z.string().nullish(),
  listing_type_id: z.string().nullish(),
  title: z.string(), price: z.number().nonnegative(),
  currency_id: z.string(), available_quantity: quantity,
  status: z.string(), variations: z.array(variationSchema).default([]),
});
export type Listing = z.infer<typeof itemSchema>;

export function normalizeListing(raw: unknown, seller: number): Listing {
  const parsed = itemSchema.safeParse(raw);
  if (!parsed.success || parsed.data.seller_id !== seller)
    throw Error("Mercado Libre devolvió una publicación incompleta o de otra cuenta. No se guardó la importación.");
  const item = parsed.data;
  item.variations.sort((a, b) => a.id.localeCompare(b.id));
  for (const variant of item.variations)
    variant.attribute_combinations.sort((a, b) => `${a.name}:${a.value_name}`.localeCompare(`${b.name}:${b.value_name}`));
  return item;
}

export function sameListings(a: Listing[], b: Listing[]) {
  return isDeepStrictEqual([...a].sort((x, y) => x.id.localeCompare(y.id)), [...b].sort((x, y) => x.id.localeCompare(y.id)));
}

export function mergeListings(previous: Listing[], incoming: Listing[]) {
  const stored = new Map(previous.map((item) => [item.id, item]));
  let added = 0, updated = 0, unchanged = 0;
  for (const item of new Map(incoming.map((item) => [item.id, item])).values()) {
    const old = stored.get(item.id);
    if (!old) added++;
    else if (!isDeepStrictEqual(old, item)) updated++;
    else { unchanged++; continue; }
    stored.set(item.id, item);
  }
  return { listings: [...stored.values()].sort((a, b) => a.id.localeCompare(b.id)), added, updated, unchanged };
}
