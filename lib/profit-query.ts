import type { Sale } from "./profit";
type Range = { from: string; to: string };
type Page = { sales: Sale[]; total: number; nextOffset: number | null; splitRequired?: boolean };
const shift = (date: string, days: number) => new Date(Date.parse(date + "T12:00:00Z") + days * 86400000).toISOString().slice(0, 10);
// Query the whole period first. Split only when ML's 10,000-result ceiling requires it.
export async function queryProfitSales(range: Range, fetchPage: (range: Range & { offset: number }) => Promise<Page>, progress: (count: number, total: number) => void) {
  const ranges = [range];
  const sales = new Map<string, Sale>();
  while (ranges.length) {
    const current = ranges.shift()!;
    let offset: number | null = 0;
    let expectedTotal: number | undefined;
    const baseCount = sales.size;
    while (offset !== null) {
      const page = await fetchPage({ ...current, offset });
      if (page.splitRequired) {
        if (offset !== 0 || current.from === current.to) throw Error("Demasiadas ventas en un día. Es necesario ampliar el método de consulta.");
        const days = Math.round((Date.parse(current.to) - Date.parse(current.from)) / 86400000);
        const midpoint = shift(current.from, Math.floor(days / 2));
        ranges.unshift({ from: current.from, to: midpoint }, { from: shift(midpoint, 1), to: current.to });
        break;
      }
      if (expectedTotal !== undefined && expectedTotal !== page.total) throw Error("Las ventas cambiaron durante la consulta. Volvé a consultar.");
      expectedTotal = page.total;
      for (const sale of page.sales) {
        if (sales.has(sale.id)) throw Error("La API repitió una venta entre páginas. Volvé a consultar.");
        sales.set(sale.id, sale);
      }
      progress(sales.size, baseCount + page.total);
      if (page.nextOffset !== null && page.nextOffset <= offset) throw Error("La consulta no avanzó. Volvé a intentar.");
      offset = page.nextOffset;
    }
  }
  return [...sales.values()];
}
