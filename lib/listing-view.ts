import type { Listing } from "./listings";
import type { StockMapping, StockVariant } from "./inventory";
import { listingGroups } from "./supplier";

export type AssociationFilter = "all" | "none" | "partial" | "complete";
export type ListingSort = "original" | "unlinked" | "title" | "title-desc" | "stock" | "stock-desc" | "price" | "price-desc";
export function listingView(items: Listing[], mappings: StockMapping[], variants: StockVariant[], account: string,
  search = "", filter: AssociationFilter = "all", sort: ListingSort = "original") {
  const map = new Map(mappings.filter((m) => m.account_id === account).map((m) => [`${m.item_id}:${m.variation_id}`, m]));
  const names = new Map(variants.map((v) => [v.id, v.product_name]));
  const normalize = (s: string) => s.normalize("NFD").replace(/[\u0300-\u036f]/g, "").toLocaleLowerCase("es-AR").trim();
  const groups = listingGroups(items).map((group) => {
    const keys = group.options.flatMap((i) => i.variations.length ? i.variations.map((v) => `${i.id}:${v.id}`) : [`${i.id}:0`]);
    const associated = keys.flatMap((key) => map.get(key) ? [map.get(key)!] : []);
    const association: AssociationFilter = !associated.length ? "none" : associated.length === keys.length ? "complete" : "partial";
    const products = [...new Set(associated.map((m) => names.get(m.variant_id) ?? "Producto asociado"))];
    return { ...group, association, products,
      stock: Math.min(...group.options.map((i) => i.available_quantity)),
      price: Math.min(...group.options.map((i) => i.price)) };
  }).filter((g) => (filter === "all" || g.association === filter) && normalize(`${g.title} ${g.options.map((i) => i.id).join(" ")} ${g.products.join(" ")}`).includes(normalize(search)));
  const byTitle = (a: typeof groups[number], b: typeof groups[number]) => a.title.localeCompare(b.title, "es", { sensitivity: "base", numeric: true }) || a.id.localeCompare(b.id);
  const rank = { none: 0, partial: 1, complete: 2, all: 3 };
  if (sort !== "original") groups.sort((a, b) => {
    if (sort === "unlinked") return rank[a.association] - rank[b.association] || byTitle(a, b);
    if (sort === "title-desc") return -byTitle(a, b);
    if (sort === "stock" || sort === "stock-desc") return (a.stock - b.stock) * (sort === "stock" ? 1 : -1) || byTitle(a, b);
    if (sort === "price" || sort === "price-desc") return (a.price - b.price) * (sort === "price" ? 1 : -1) || byTitle(a, b);
    return byTitle(a, b);
  });
  return groups;
}
