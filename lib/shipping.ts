import { localDate } from "./domain";
export type Shipment = {
  id: number;
  status: string;
  substatus?: string;
  logistic_type?: string;
  mode?: string;
  status_history?: { date_shipped?: string };
  shipping_option?: { estimated_delivery_time?: { date?: string } };
};
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
