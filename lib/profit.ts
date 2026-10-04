import { localDate, type Order, type State } from "./domain";
import { emptyBusiness, resolveFlex, resolveFlexShipments, type Business } from "./business";
import { supplierReport } from "./supplier";
import type { FlexCredit } from "./flex-credits";
import type { SaleShipping } from "./sale-shipping";
export type Sale = Order & { shippingCosts?: SaleShipping; flexReconciliation?: "deferred"; grossCents?: number; receivedCents?: number; paymentBaseCents?: number; flexCredits?: FlexCredit[]; flexCreditsUnavailable?: boolean; paymentIds: string[]; issues: string[] };
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
  const usedCredits = new Set<string>();
  const flexByOrder = resolveFlexShipments(business, sales);
  return [...sales].sort((a, b) => a.id.localeCompare(b.id)).map((sale) => {
    const date = localDate(sale.createdAt);
    const note = business.notes[sale.id];
    const supplier = supplierReport(state, [sale], date).orders[0];
    const issues = [...sale.issues];
    let received = note?.netCents ?? sale.receivedCents;
    if (note?.netCents === undefined && sale.paymentIds.some((id) => paymentCounts.get(id)! > 1)) { received = undefined; issues.push("Pago compartido: completar el neto correspondiente a esta orden"); }
    let bonus = 0, bonusAdded = 0, bonusCount = 0, bonusUnresolved = false;
    if (sale.mode === "flex") {
      for (const credit of sale.flexCredits ?? []) {
        if (credit.shipmentId !== sale.shipmentId || (credit.orderId && credit.orderId !== sale.id) || usedCredits.has(credit.id)) continue;
        usedCredits.add(credit.id); bonus += credit.cents; bonusCount++;
        if (!credit.orderId && sales.filter((other) => other.shipmentId === sale.shipmentId).length > 1 && note?.netCents === undefined) {
          bonusUnresolved = true;
          issues.push("Bonificación de envío compartido sin orden identificada: completá el recibido total de cada venta.");
        }
      }
      if (note?.netCents === undefined) {
        if (sale.flexCreditsUnavailable) { issues.push("No se pudieron verificar las bonificaciones Flex; volvé a consultar o completá el recibido total."); bonusUnresolved = true; }
        if (bonusCount > 0 && received !== undefined) {
          if (!bonusUnresolved && sale.paymentBaseCents !== undefined && received === sale.paymentBaseCents) { bonusAdded = bonus; received += bonus; }
          else if (sale.paymentBaseCents === undefined || received !== sale.paymentBaseCents + bonus) {
            issues.push("Bonificación Flex informada: falta conciliar si ya está incluida en el recibido. Completá el recibido total."); bonusUnresolved = true;
          }
        }
      }
    }
    if (received === undefined) issues.push("Falta el neto recibido");
    issues.push(...supplier.missing);
    if (sale.orderStatus !== "paid") issues.push("Cancelación o devolución: revisar ingresos y costos manualmente");
    let shipping: number | undefined = 0;
    let flex: ReturnType<typeof resolveFlex> | undefined;
    if (sale.mode === "flex") {
      const key = sale.shipmentId ?? sale.id;
      flex = flexByOrder[sale.id];
      shipping = flex.cents === undefined ? undefined : shipments.has(key) ? 0 : flex.cents;
      if (shipping === undefined) issues.push("Zona Flex desconocida: seleccioná la zona manualmente");
      shipments.add(key);
    } else if (sale.mode === "acordar") {
      shipping = note?.shippingCents;
      if (shipping === undefined) issues.push("Falta costo del envío acordado (ingresá 0 si no tiene costo)");
    }
    const usable = sale.orderStatus === "paid" && !supplier.missing.length && received !== undefined && shipping !== undefined && !sale.review && !bonusUnresolved;
    if (sale.review) issues.push(sale.review);
    return { sale, date, flex, bonus, bonusAdded, bonusCount, bonusUnresolved, gross: sale.orderStatus === "paid" ? sale.grossCents : undefined, received, supplier: supplier.missing.length ? undefined : supplier.totalCents, shipping, net: usable ? received! - supplier.totalCents - shipping! : undefined, issues: [...new Set(issues)], manualNet: note?.netCents !== undefined };
  });
}
export function reportTotals(rows: ReturnType<typeof profitRows>, business: Business, from: string, to: string) {
  const selected = rows.filter((row) => row.date >= from && row.date <= to);
  const expenses = { tax: 0, billing: 0, total: 0 }; // Monthly expenses are suspended.
  return { gross: selected.reduce((sum, row) => sum + (row.gross ?? 0), 0), net: selected.reduce((sum, row) => sum + (row.net ?? 0), 0) - expenses.total, expenses, missingGross: selected.filter((row) => row.gross === undefined).length, missingNet: selected.filter((row) => row.net === undefined).length, missingMonths: [] as string[], count: selected.length };
}
