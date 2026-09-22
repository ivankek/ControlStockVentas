import { test } from "node:test";
import assert from "node:assert/strict";
import { carrierPeriod, carrierReport } from "../lib/flex-carrier";
import { emptyBusiness } from "../lib/business";
import type { Order } from "../lib/domain";
const order = (extra: Partial<Order> = {}): Order => ({ id: "1", shipmentId: "50", mode: "flex", createdAt: "2026-08-01T12:00:00Z", dispatchedDate: "2026-09-02", province: "Capital Federal", cancelled: false, orderStatus: "paid", lines: [], ...extra });
test("carrier charges once per shipment using dispatch-date rates, excludes other modes and cancellations", () => {
  const business = emptyBusiness();
  business.flexRates = { CABA: [{ from: "2026-08-01", cents: 300000 }, { from: "2026-09-01", cents: 320000 }] };
  const report = carrierReport([order(), order({ id: "2" }), order({id:"3", shipmentId:"51", cancelled:true}), order({id:"4", shipmentId:"52", mode:"correo"}), order({id:"5", shipmentId:"53", dispatchedDate:undefined}), order({id:"6",shipmentId:"54",mode:"acordar"})], business);
  assert.equal(report.totalCents, 320000);
  assert.equal(report.shipments.length, 1);
  assert.equal(report.pending, 0);
  assert.deepEqual(report.shipments[0].orderIds, ["1","2"]);
});
test("carrier preserves pending amounts and honors manual zone on sibling orders", () => {
  const business = emptyBusiness(); business.notes["2"] = { updatedAt: "", flexZone: "CORDON_2" };
  const report = carrierReport([order({province:undefined}),order({id:"2",province:undefined}),order({id:"3",shipmentId:"60",province:undefined}),order({id:"4",shipmentId:undefined})],business);
  assert.equal(report.totalCents,420000);
  assert.equal(report.pending,2);
  assert.equal(report.shipments[1].cents,undefined);
});
test("conflicting dates do not silently double charge a shipment", () => {
  const report = carrierReport([order(),order({id:"2",dispatchedDate:"2026-09-03"})]);
  assert.equal(report.pending,1);
  assert.equal(report.totalCents,0);
});
test("periods cover leap months, Monday to Sunday weeks, and stop at today", () => {
  assert.deepEqual(carrierPeriod("month","2024-02-12","2026-09-22"),{from:"2024-02-01",date:"2024-02-29"});
  assert.deepEqual(carrierPeriod("week","2026-09-20","2026-09-22"),{from:"2026-09-14",date:"2026-09-20"});
  assert.deepEqual(carrierPeriod("year","2026-09-22","2026-09-22"),{from:"2026-01-01",date:"2026-09-22"});
  assert.deepEqual(carrierPeriod("day","2026-09-20","2026-09-22"),{from:"2026-09-20",date:"2026-09-20"});
});
