import type { Business } from "./business";

export type ExpenseCycle = { startDay: number; endDay: number; startMonth: string };
export type ExpensePeriod = {
  accountId: string; month: string; from: string; to: string;
  mlCents: number; monotributoCents: number; iibbCents: number; otherCents: number;
  note: string; updatedAt: string;
};
const dayMs = 86400000;
const timestamp = (date: string) => Date.parse(date + "T00:00:00Z");
export const daysBetween = (from: string, to: string) => Math.round((timestamp(to) - timestamp(from)) / dayMs) + 1;
export function expenseRange(month: string, cycle: ExpenseCycle) {
  const [year, m] = month.split("-").map(Number);
  const date = (offset: number, day: number) => {
    const days = new Date(Date.UTC(year, m + offset, 0)).getUTCDate();
    return new Date(Date.UTC(year, m - 1 + offset, Math.min(day, days))).toISOString().slice(0, 10);
  };
  return { from: date(0, cycle.startDay), to: date(cycle.endDay <= cycle.startDay ? 1 : 0, cycle.endDay) };
}
export function expenseTotal(period: ExpensePeriod) {
  return period.mlCents + period.monotributoCents + period.iibbCents + period.otherCents;
}
// Assign remainder cents to the earliest days so daily and monthly reports
// reconcile exactly, including leap years and queries crossing periods.
export function expenseShare(cents: number, days: number, offset: number, count: number) {
  const remainder = cents % days;
  return Math.floor(cents / days) * count + Math.max(0, Math.min(offset + count, remainder) - offset);
}
export function periodExpenses(business: Business, from: string, to: string) {
  const periods = (business.expensePeriods ?? []).filter((p) => p.from <= to && p.to >= from).map((p) => {
    const start = p.from > from ? p.from : from, end = p.to < to ? p.to : to;
    const days = daysBetween(p.from, p.to), includedDays = daysBetween(start, end), offset = daysBetween(p.from, start) - 1;
    const share = (cents: number) => expenseShare(cents, days, offset, includedDays);
    const ml = share(p.mlCents), monotributo = share(p.monotributoCents), iibb = share(p.iibbCents), other = share(p.otherCents);
    return { ...p, days, includedDays, ml, monotributo, iibb, other, total: ml + monotributo + iibb + other };
  });
  const missingDates: string[] = [];
  const starts = Object.values(business.expenseCycles ?? {}).map((cycle) => expenseRange(cycle.startMonth, cycle).from).sort();
  const configuredFrom = starts[0];
  if (configuredFrom) for (let time = Math.max(timestamp(from), timestamp(configuredFrom)); time <= timestamp(to); time += dayMs) {
    const date = new Date(time).toISOString().slice(0, 10);
    if (!periods.some((p) => p.from <= date && p.to >= date)) missingDates.push(date);
  }
  return {
    periods, missingDates, configured: !!configuredFrom,
    billing: periods.reduce((sum, p) => sum + p.ml, 0),
    tax: periods.reduce((sum, p) => sum + p.monotributo + p.iibb, 0),
    other: periods.reduce((sum, p) => sum + p.other, 0),
    total: periods.reduce((sum, p) => sum + p.total, 0),
  };
}
