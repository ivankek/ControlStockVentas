import { z } from "zod";
import { localDate } from "./domain";

const id = z.union([z.string(), z.number()]).transform(String);
const claimSchema = z.object({ id, related_entities: z.array(z.string()).optional() });
const shipmentSchema = z.object({ shipment_id: id, status: z.string(), tracking_number: z.string().nullable().optional(), destination: z.object({ name: z.string() }).optional() });
const returnSchema = z.object({
  id, date_created: z.iso.datetime({ offset: true }), status: z.string(), refund_at: z.string().optional(),
  shipments: z.array(shipmentSchema).default([]),
  orders: z.array(z.object({ order_id: id, item_id: z.string().optional(), return_quantity: z.number().optional() })).default([]),
});
export type DispatchReturn = z.infer<typeof returnSchema>;
export type ReturnsPage = { returns: DispatchReturn[]; next: number | null; warnings: string[] };

export function returnsPeriod(from: string, to: string) {
  if (from !== to) return { from, to };
  const start = new Date(`${from}T12:00:00Z`);
  start.setUTCDate(start.getUTCDate() - (start.getUTCDay() + 6) % 7);
  const end = new Date(start); end.setUTCDate(end.getUTCDate() + 6);
  return { from: start.toISOString().slice(0, 10), to: end.toISOString().slice(0, 10) };
}

export function physicalReturn(raw: unknown, from: string, to: string) {
  const value = returnSchema.parse(raw);
  const date = localDate(value.date_created);
  if (date < from || date > to || value.refund_at === "n/a" || !value.shipments.length) return null;
  return value;
}

// Search by last update, without an upper bound: older returns can change after
// the selected period. Filter by the return's own creation date afterwards.
export async function returnsPage(read: (path: string) => Promise<unknown>, seller: string, from: string, to: string, offset: number): Promise<ReturnsPage> {
  const query = new URLSearchParams({ "players.user_id": seller, "players.role": "respondent", range: `last_updated:after:${from}T00:00:00.000-03:00`, sort: "last_updated:asc", limit: "20", offset: String(offset) });
  const page = z.object({ paging: z.object({ total: z.number().int().nonnegative() }), data: z.array(claimSchema) }).parse(await read(`/post-purchase/v1/claims/search?${query}`));
  const returns: DispatchReturn[] = [], warnings: string[] = [];
  for (let i = 0; i < page.data.length; i += 4) {
    await Promise.all(page.data.slice(i, i + 4).map(async (claim) => {
      try {
        const detail = claim.related_entities ? claim : claimSchema.parse(await read(`/post-purchase/v1/claims/${claim.id}`));
        if (!detail.related_entities) throw Error("Mercado Libre no informó las entidades del reclamo");
        if (!detail.related_entities.includes("return")) return;
        const value = physicalReturn(await read(`/post-purchase/v2/claims/${claim.id}/returns`), from, to);
        if (value) returns.push(value);
      } catch { warnings.push(`No se pudo verificar la devolución del reclamo ${claim.id}.`); }
    }));
  }
  const next = offset + page.data.length;
  if (next < page.paging.total && (!page.data.length || next + 20 >= 10000)) {
    warnings.push("La consulta quedó incompleta por el límite de búsqueda de Mercado Libre.");
    return { returns, next: null, warnings };
  }
  return { returns, next: next < page.paging.total ? next : null, warnings };
}
