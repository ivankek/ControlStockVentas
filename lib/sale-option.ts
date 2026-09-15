import type { Listing } from "./listings";
export function installmentLabel(item: Listing) {
  if (!item.tags) return "Cuotas: actualizá las publicaciones";
  if (item.tags.includes("pcj-co-funded")) return "3 a 12 cuotas con interés bajo";
  if (item.listing_type_id === "gold_special") return "Sin cuotas agregadas por el vendedor";
  if (item.listing_type_id === "gold_pro") {
    const campaigns = item.tags.filter((tag) => /^\d+x_campaign$/.test(tag));
    if (campaigns.length > 1) return "Cuotas: campaña a verificar";
    const count = campaigns.length ? Number(campaigns[0].split("x")[0]) : 6;
    return `${count} cuotas al mismo precio publicado`;
  }
  return "Cuotas no informadas";
}
