import { localDate } from "./domain";
export type HomeListing = { key: string; title: string; variant: string; sku?: string | null; supplierName?: string; units: number; linked: boolean };
export type HomeAccount = { id: string; name: string; platform: "meli" | "nube"; listings: HomeListing[]; error?: string };
export type HomeSale = { id: string; shipment?: string; mode: string; due?: string; group: "today" | "late" | "review"; lines: { title: string; quantity: number; supplierName?: string; units: number }[]; note?: string };
export type HomeSales = { date: string; orders: HomeSale[]; warnings: string[]; updatedAt: string };
export function dispatchGroup(expected: unknown, date: string): HomeSale["group"] | "future" {
  if (typeof expected !== "string" || !Number.isFinite(Date.parse(expected))) return "review";
  const due = localDate(expected);
  return due < date ? "late" : due === date ? "today" : "future";
}
export function pendingShipment(status: string, substatus?: string, logistic?: string) {
  return ["pending", "handling", "ready_to_ship", "to_be_agreed"].includes(status)
    && !["picked_up", "authorized_by_carrier", "in_hub"].includes(substatus ?? "") && logistic !== "fulfillment";
}
