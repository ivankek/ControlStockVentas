import { localDate, type Order, type State } from "./domain";
import { emptyBusiness, type Business } from "./business";
import { supplierReport } from "./supplier";

export type Sale = Order & { grossCents?: number; receivedCents?: number; paymentIds: string[]; issues: string[] };
export const DEFAULT_FLEX_CENTS = 500000;
export function monthlyExpenses(business: Business, from: string, to: string) {
  let tax = 0, billing = 0;
  for (let day = from; day <= to; day = new Date(Date.parse(`${day}T12:00:00Z`) + 86400000).toISOString().slice(0, 10)) {
    const month = business.months[day.slice(0, 7)]; if (!month) continue;
    const [year, m, d] = day.split("-").map(Number);
    const days = new Date(Date.UTC(year, m, 0)).getUTCDate();
    // Distribute remainder cents across the first days. Daily totals reconcile exactly.
    const share = (cents: number) => Math.floor(cents / days) + (d <= cents % days ? 1 : 0);
    tax += share(month.taxCents); billing += share(month.billingCents);
  }
  return { tax, billing, total: tax + billing };
}
export function expenseBreakdown(business: Business, from: string, to: string) {
  const result = [];
  for (let start = from; start <= to;) {
    const month = start.slice(0, 7);
    const [year, m] = month.split("-").map(Number);
    const daysInMonth = new Date(Date.UTC(year, m, 0)).getUTCDate();
    const end = `${month}-${daysInMonth}` < to ? `${month}-${daysInMonth}` : to;
    result.push({ month, days: Math.round((Date.parse(end) - Date.parse(start)) / 86400000) + 1, daysInMonth, configured: business.months[month], ...monthlyExpenses(business, start, end) });
    start = new Date(Date.parse(end + "T12:00:00Z") + 86400000).toISOString().slice(0, 10);
  }
  return result;
}
export function profitRows(state: State, sales: Sale[]) {
  const business = state.business ?? emptyBusiness();
  const paymentCounts = new Map<string, number>();
  for (const sale of sales) for (const id of new Set(sale.paymentIds)) paymentCounts.set(id, (paymentCounts.get(id) ?? 0) + 1);
  const shipments = new Set<string>();
  return [...sales].sort((a, b) => a.id.localeCompare(b.id)).map((sale) => {
    const date = localDate(sale.createdAt);
    const note = business.notes[sale.id];
    const supplier = supplierReport(state, [sale], date).orders[0];
    const issues = [...sale.issues];
    let received = note?.netCents ?? sale.receivedCents;
    if (note?.netCents === undefined && sale.paymentIds.some((id) => paymentCounts.get(id)! > 1)) { received = undefined; issues.push("Pago compartido: completar el neto correspondiente a esta orden"); }
    if (received === undefined) issues.push("Falta el neto recibido");
    issues.push(...supplier.missing);
    if (sale.orderStatus !== "paid") issues.push("Cancelación o devolución: revisar ingresos y costos manualmente");
    let shipping: number | undefined = 0;
    if (sale.mode === "flex") {
      const key = sale.shipmentId ?? sale.id;
      shipping = shipments.has(key) ? 0 : DEFAULT_FLEX_CENTS;
      shipments.add(key);
    } else if (sale.mode === "acordar") {
      shipping = note?.shippingCents;
      if (shipping === undefined) issues.push("Falta costo del envío acordado (ingresá 0 si no tiene costo)");
    }
    const usable = sale.orderStatus === "paid" && !supplier.missing.length && received !== undefined && shipping !== undefined && !sale.review;
    if (sale.review) issues.push(sale.review);
    return { sale, date, gross: sale.orderStatus === "paid" ? sale.grossCents : undefined, received, supplier: supplier.missing.length ? undefined : supplier.totalCents, shipping, net: usable ? received! - supplier.totalCents - shipping! : undefined, issues: [...new Set(issues)], manualNet: note?.netCents !== undefined };
  });
}
export function reportTotals(rows: ReturnType<typeof profitRows>, business: Business, from: string, to: string) {
  const selected = rows.filter((row) => row.date >= from && row.date <= to);
  const expenses = monthlyExpenses(business, from, to);
  const missingMonths = new Set<string>();
  for (let day = from; day <= to; day = new Date(Date.parse(`${day}T12:00:00Z`) + 86400000).toISOString().slice(0, 10)) if (!business.months[day.slice(0, 7)]) missingMonths.add(day.slice(0, 7));
  return { gross: selected.reduce((sum, row) => sum + (row.gross ?? 0), 0), net: selected.reduce((sum, row) => sum + (row.net ?? 0), 0) - expenses.total, expenses, missingGross: selected.filter((row) => row.gross === undefined).length, missingNet: selected.filter((row) => row.net === undefined).length, missingMonths: [...missingMonths], count: selected.length };
}
