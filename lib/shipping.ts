import { localDate } from "./domain";
type ShippingAddress = { receiver_name?: string; state?: { name?: string }; city?: { name?: string }; municipality?: { name?: string }; neighborhood?: { name?: string }; zip_code?: string; latitude?: number; longitude?: number };
export type Shipment = {
  id: number;
  status: string;
  substatus?: string;
  logistic_type?: string;
  mode?: string;
  destination?: {
    receiver_name?: string;
    shipping_address?: ShippingAddress;
  };
  receiver_address?: ShippingAddress;
  logistic?: { mode?: string; type?: string };
  lead_time?: { estimated_delivery_time?: { date?: string } };
  status_history?: { date_shipped?: string };
  shipping_option?: { estimated_delivery_time?: { date?: string } };
};
export function shipmentDestination(shipment: Shipment) {
  const a = shipment.destination?.shipping_address ?? shipment.receiver_address;
  const text = (value: unknown) => typeof value === "string" ? value.trim() || undefined : undefined;
  return { province: text(a?.state?.name), city: text(a?.city?.name), municipality: text(a?.municipality?.name), neighborhood: text(a?.neighborhood?.name), postalCode: text(a?.zip_code),
    latitude: typeof a?.latitude === "number" && Math.abs(a.latitude) <= 90 ? a.latitude : undefined,
    longitude: typeof a?.longitude === "number" && Math.abs(a.longitude) <= 180 ? a.longitude : undefined };
}
// x-format-new nests logistics and estimates; keep support for legacy responses.
export function normalizeShipment(shipment: Shipment): Shipment {
  return {
    ...shipment,
    mode: shipment.logistic?.mode ?? shipment.mode,
    logistic_type: shipment.logistic?.type ?? shipment.logistic_type,
    shipping_option: shipment.lead_time ?? shipment.shipping_option,
  };
}
export type History = { status: string; substatus?: string; date: string }[];
export function dispatchEvidence(shipment: Shipment, history: History) {
  const events = history.filter(
    (e) =>
      Number.isFinite(Date.parse(e.date)) &&
      (e.status === "shipped" ||
        (e.status === "ready_to_ship" &&
          ["picked_up", "authorized_by_carrier"].includes(e.substatus ?? ""))),
  );
  if (
    shipment.status_history?.date_shipped &&
    Number.isFinite(Date.parse(shipment.status_history.date_shipped))
  )
    events.push({
      status: "shipped",
      date: shipment.status_history.date_shipped,
    });
  events.sort((a, b) => Date.parse(a.date) - Date.parse(b.date));
  const event = events[0];
  return event
    ? {
        date: localDate(event.date),
        evidence: `Mercado Libre: ${event.status}${event.substatus ? " / " + event.substatus : ""} · ${event.date}`,
      }
    : undefined;
}
