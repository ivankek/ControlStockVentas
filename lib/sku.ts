import type { Listing } from "./listings";

export type SkuEntry = { key: string; sku?: string | null };
// SKUs are identifiers: preserve case, punctuation and leading zeros.
export function skuPlan(entries: SkuEntry[], variants: { id: string; sku: string | null }[]) {
  const index = new Map<string, string[]>();
  for (const variant of variants) {
    const sku = variant.sku?.trim();
    if (sku) index.set(sku, [...(index.get(sku) ?? []), variant.id]);
  }
  const matches: Record<string, string> = {};
  let missing = 0, unmatched = 0, ambiguous = 0;
  for (const entry of entries) {
    const sku = entry.sku?.trim();
    if (!sku) { missing++; continue; }
    const ids = index.get(sku) ?? [];
    if (!ids.length) unmatched++;
    else if (ids.length > 1) ambiguous++;
    else matches[entry.key] = ids[0];
  }
  return { matches, missing, unmatched, ambiguous };
}
export function meliSkuEntries(items: Listing[]): SkuEntry[] {
  // SELLER_SKU is the platform's SKU. seller_custom_field is a separate legacy
  // custom field, so do not guess that it identifies a supplier product.
  const sku = (value: Listing | Listing["variations"][number]) => value.attributes?.find((a) => a.id === "SELLER_SKU")?.value_name;
  return items.flatMap((item) => item.variations.length
    ? item.variations.map((v) => ({ key: `${item.id}:${v.id}`, sku: sku(v) }))
    : [{ key: `${item.id}:0`, sku: sku(item) }]);
}
export function skuMessage(result: { matched: number; missing: number; unmatched: number; ambiguous: number }) {
  return `${result.matched} coincidencias asociadas · ${result.missing} sin SKU · ${result.unmatched} sin coincidencia · ${result.ambiguous} ambiguas. Las asociaciones sin coincidencia se conservaron.`;
}
