import test from "node:test";
import assert from "node:assert/strict";
import { businessCommand, emptyBusiness, updateBusiness } from "../lib/business";
import { emptyState } from "../lib/domain";
import { expenseRange, periodExpenses, type ExpensePeriod } from "../lib/business-expenses";
import { reportTotals } from "../lib/profit";
const period = (more: Partial<ExpensePeriod> = {}): ExpensePeriod => ({ accountId: "a", month: "2026-10", from: "2026-10-10", to: "2026-11-10", mlCents: 32001, monotributoCents: 64000, iibbCents: 3200, otherCents: 0, note: "Publicidad", updatedAt: "", ...more });

test("ciclo inclusivo conserva días en meses siguientes y ajusta fin de mes/bisiestos", () => {
  const cycle = { startDay: 10, endDay: 10, startMonth: "2026-10" };
  assert.deepEqual(expenseRange("2026-10", cycle), { from: "2026-10-10", to: "2026-11-10" });
  assert.deepEqual(expenseRange("2026-12", cycle), { from: "2026-12-10", to: "2027-01-10" });
  assert.deepEqual(expenseRange("2024-01", { ...cycle, startDay: 31, endDay: 31 }), { from: "2024-01-31", to: "2024-02-29" });
  assert.deepEqual(expenseRange("2025-02", { ...cycle, startDay: 31, endDay: 31 }), { from: "2025-02-28", to: "2025-03-31" });
  assert.deepEqual(expenseRange("2026-10", { ...cycle, startDay: 1, endDay: 31 }), { from: "2026-10-01", to: "2026-10-31" });
});
test("cada día resta su proporción y la suma reconcilia al centavo sin depender de ventas", () => {
  const business = { ...emptyBusiness(), expensePeriods: [period()] };
  const whole = periodExpenses(business, "2026-10-10", "2026-11-10");
  assert.equal(whole.total, 99201); assert.equal(whole.periods[0].days, 32);
  let sum = 0;
  for (let t = Date.parse("2026-10-10"); t <= Date.parse("2026-11-10"); t += 86400000) {
    const day = new Date(t).toISOString().slice(0, 10);
    sum += periodExpenses(business, day, day).total;
  }
  assert.equal(sum, whole.total);
  assert.equal(periodExpenses(business, "2026-10-09", "2026-10-09").total, 0);
  assert.equal(periodExpenses(business, "2026-11-10", "2026-11-10").total, 3100);
  assert.equal(reportTotals([], business, "2026-10-10", "2026-10-10").net, -3101);
  assert.equal(periodExpenses(business, "2026-10-10", "2026-10-31").total + periodExpenses(business, "2026-11-01", "2026-11-10").total, whole.total);
});
test("cierres inclusivos aplican las proporciones de ambos períodos y diferencian cero de faltantes", () => {
  const business = { ...emptyBusiness(), expenseCycles: { a: { startDay: 10, endDay: 10, startMonth: "2026-10" } }, expensePeriods: [period(), period({ month: "2026-11", from: "2026-11-10", to: "2026-12-10", mlCents: 31000, monotributoCents: 0, iibbCents: 0 })] };
  const overlap = periodExpenses(business, "2026-11-10", "2026-11-10");
  assert.equal(overlap.total, 4100); assert.equal(overlap.periods.length, 2);
  assert.equal(overlap.missingDates.length, 0);
  assert.equal(periodExpenses(business, "2026-12-10", "2026-12-12").missingDates.length, 2);
  business.expensePeriods = [period({ mlCents: 0, monotributoCents: 0, iibbCents: 0 })];
  assert.equal(periodExpenses(business, "2026-10-10", "2026-10-10").missingDates.length, 0);
  assert.equal(periodExpenses(business, "2026-10-01", "2026-10-09").missingDates.length, 0);
});
test("gastos se guardan/editan/eliminan por cuenta y conservan períodos históricos", () => {
  const action = businessCommand.parse({ type: "expensePeriod", ...period() });
  let state = updateBusiness(emptyState(), action, undefined, "a");
  state = updateBusiness(state, action, undefined, "b");
  state = updateBusiness(state, businessCommand.parse({ ...action, mlCents: 100 }), undefined, "a");
  assert.equal(state.business!.expensePeriods!.length, 2);
  assert.equal(state.business!.expensePeriods!.find((p) => p.accountId === "b")!.mlCents, 32001);
  state = updateBusiness(state, { type: "expenseCycle", startDay: 12, endDay: 12, startMonth: "2026-10" }, undefined, "a");
  assert.equal(state.business!.expensePeriods!.find((p) => p.accountId === "a")!.from, "2026-10-10");
  state = updateBusiness(state, { type: "expenseDelete", month: "2026-10" }, undefined, "a");
  assert.equal(state.business!.expensePeriods!.length, 1);
  assert.throws(() => updateBusiness(state, action), /cuenta/);
  for (const bad of [{ to: "2026-10-09" }, { to: "2027-01-01" }, { month: "2026-09" }, { mlCents: -1 }, { iibbCents: 1.5 }]) assert.equal(businessCommand.safeParse({ ...action, ...bad }).success, false);
});
