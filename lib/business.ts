import { z } from "zod";
import { detectFlexZone, FLEX_RATES, FLEX_ZONES, type FlexSelection, type FlexZone, type FlexDestination } from "./flex-zones";
import { localDate, today, type Order, type State } from "./domain";

export type OrderNote = { accountId?: string; flexZone?: FlexSelection; dispatchedDate?: string; shippingCents?: number; netCents?: number; updatedAt: string };
export type Business = {
  flexRates?: Partial<Record<FlexZone, { from: string; cents: number }[]>>;
  notes: Record<string, OrderNote>;
  zones: { id: string; name: string; province: string; cities: string[]; rates: { from: string; cents: number }[] }[];
  months: Record<string, { taxCents: number; billingCents: number }>;
};
export const emptyBusiness = (): Business => ({ notes: {}, zones: [], months: {} });
const cents = z.number().int().min(0).max(100000000000);
export const businessCommand = z.discriminatedUnion("type", [
  z.object({ type: z.literal("note"), id: z.string().regex(/^\d+$/), flexZone: z.enum([...FLEX_ZONES, "NONE"]).nullable().optional(), dispatchedDate: z.iso.date().nullable().optional(), shippingCents: cents.nullable().optional(), netCents: cents.nullable().optional() }),
  z.object({ type: z.literal("flexRate"), zone: z.enum(FLEX_ZONES), from: z.iso.date(), cents }),
  z.object({ type: z.literal("zone"), id: z.string().uuid(), name: z.string().trim().min(1).max(100), province: z.string().trim().min(1).max(100), cities: z.array(z.string().trim().min(1).max(100)).min(1).max(200), from: z.iso.date(), cents }),
  z.object({ type: z.literal("month"), month: z.string().regex(/^\d{4}-(0[1-9]|1[0-2])$/), taxCents: cents, billingCents: cents }),
]);
export function updateBusiness(state: State, action: z.infer<typeof businessCommand>, order?: Order): State {
  const next = structuredClone(state);
  const business = next.business ??= emptyBusiness();
  if (action.type === "note") {
    if (!order || order.id !== action.id) throw Error("No se pudo verificar la venta.");
    if (action.dispatchedDate !== undefined || action.shippingCents !== undefined) {
      if (order.mode !== "acordar") throw Error("La confirmación y el envío manual son para pedidos acordados con el comprador.");
    }
    if (action.dispatchedDate && (order.cancelled || action.dispatchedDate > today() || action.dispatchedDate < localDate(order.createdAt))) throw Error("Revisá el estado y la fecha del despacho.");
    const note = business.notes[action.id] ?? { updatedAt: "" };
    if (action.flexZone !== undefined && order.mode !== "flex") throw Error("La zona Flex solo se aplica a envíos Flex.");
    for (const key of ["dispatchedDate", "shippingCents", "netCents", "flexZone"] as const) {
      const value = action[key];
      if (value === null) delete note[key];
      else if (value !== undefined) Object.assign(note, { [key]: value });
    }
    note.updatedAt = new Date().toISOString();
    business.notes[action.id] = note;
  } else if (action.type === "flexRate") {
    const rates = business.flexRates ??= {};
    rates[action.zone] = [...(rates[action.zone] ?? []).filter((r) => r.from !== action.from), { from: action.from, cents: action.cents }].sort((a, b) => a.from.localeCompare(b.from));
  } else if (action.type === "zone") {
    const old = business.zones.find((zone) => zone.id === action.id);
    const zone = { id: action.id, name: action.name, province: action.province, cities: [...new Set(action.cities)], rates: [...(old?.rates ?? []).filter((rate) => rate.from !== action.from), { from: action.from, cents: action.cents }].sort((a, b) => a.from.localeCompare(b.from)) };
    business.zones = [...business.zones.filter((entry) => entry.id !== action.id), zone];
  } else business.months[action.month] = { taxCents: action.taxCents, billingCents: action.billingCents };
  return next;
}
export function manualDispatches(orders: Order[], business?: Business) {
  return orders.map((order) => {
    const date = business?.notes[order.id]?.dispatchedDate;
    if (order.mode !== "acordar" || !date) return order;
    return { ...order, dispatchedDate: date, evidence: "Confirmado manualmente", review: order.review === "Entregado sin fecha de despacho verificable" ? undefined : order.review };
  });
}
export const normalizedPlace = (value: string) => value.normalize("NFD").replace(/[\u0300-\u036f]/g, "").trim().toLocaleLowerCase("es-AR").replace(/\s+/g, " ");
export function flexCost(business: Business, order: Order, date: string): number | undefined {
  if (!order.city || !order.province) return undefined;
  const zones = business.zones.filter((zone) => normalizedPlace(zone.province) === normalizedPlace(order.province!) && zone.cities.some((city) => normalizedPlace(city) === normalizedPlace(order.city!)));
  if (zones.length !== 1) return undefined;
  return zones[0].rates.filter((rate) => rate.from <= date).sort((a, b) => b.from.localeCompare(a.from))[0]?.cents;
}
export function resolveFlex(business: Business | undefined, destination: FlexDestination, date: string, manual?: FlexSelection) {
  const detection = detectFlexZone(destination, manual);
  const zone = detection.zone;
  const rate = zone && zone !== "NONE" ? business?.flexRates?.[zone]?.filter((r) => r.from <= date).sort((a, b) => b.from.localeCompare(a.from))[0] : undefined;
  return { ...detection, cents: zone === "NONE" ? 0 : zone ? rate?.cents ?? FLEX_RATES[zone] : undefined, baselineRate: !!zone && zone !== "NONE" && !rate };
}
export function resolveFlexShipments(business: Business | undefined, orders: Order[], dateOf = (order: Order) => localDate(order.createdAt)) {
  const groups = new Map<string, Order[]>();
  for (const order of orders.filter((o) => o.mode === "flex")) {
    const key = order.shipmentId ?? order.id;
    groups.set(key, [...(groups.get(key) ?? []), order]);
  }
  const result: Record<string, ReturnType<typeof resolveFlex>> = {};
  for (const siblings of groups.values()) {
    const date = siblings.map(dateOf).sort()[0];
    const manual = [...new Set(siblings.map((o) => business?.notes[o.id]?.flexZone).filter((z) => z !== undefined))];
    const detected = siblings.map((o) => resolveFlex(business, o, date, manual[0]));
    const known = detected.filter((d) => d.zone !== undefined);
    const flex: ReturnType<typeof resolveFlex> = manual.length > 1 || new Set(known.map((d) => d.zone)).size > 1
      ? { method: "unknown", reason: "Zonas contradictorias para el mismo envío", cents: undefined, baselineRate: false }
      : known[0] ?? detected[0];
    for (const order of siblings) result[order.id] = flex;
  }
  return result;
}
