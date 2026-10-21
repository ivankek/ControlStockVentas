import test from "node:test";
import assert from "node:assert/strict";
import { dispatchGroup, pendingShipment } from "../lib/supplier-home";

test("el plazo de despacho usa la fecha argentina y separa atrasados, hoy y futuros", () => {
  assert.equal(dispatchGroup("2026-10-21T02:00:00Z", "2026-10-21"), "late");
  assert.equal(dispatchGroup("2026-10-21T18:00:00-03:00", "2026-10-21"), "today");
  assert.equal(dispatchGroup("2026-10-22T18:00:00-03:00", "2026-10-21"), "future");
  assert.equal(dispatchGroup(undefined, "2026-10-21"), "review");
  assert.equal(dispatchGroup("invalid", "2026-10-21"), "review");
});
test("no cuenta como pendiente un envío retirado, entregado o Full", () => {
  assert.equal(pendingShipment("ready_to_ship", "printed", "self_service"), true);
  for (const substatus of ["picked_up", "authorized_by_carrier", "in_hub"]) assert.equal(pendingShipment("ready_to_ship", substatus), false);
  assert.equal(pendingShipment("shipped"), false);
  assert.equal(pendingShipment("delivered"), false);
  assert.equal(pendingShipment("cancelled"), false);
  assert.equal(pendingShipment("ready_to_ship", undefined, "fulfillment"), false);
});
