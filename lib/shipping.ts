import { localDate } from "./domain";
export type Shipment = {
  id: number;
  status: string;
  substatus?: string;
  logistic_type?: string;
  mode?: string;
  destination?: {
    receiver_name?: string;
    shipping_address?: { state?: { name?: string }; city?: { name?: string } };
  };
  receiver_address?: { receiver_name?: string; state?: { name?: string }; city?: { name?: string } };
  logistic?: { mode?: string; type?: string };
  lead_time?: { estimated_delivery_time?: { date?: string } };
  status_history?: { date_shipped?: string };
  shipping_option?: { estimated_delivery_time?: { date?: string } };
};
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
