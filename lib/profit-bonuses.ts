import type { FlexCreditReport } from "./flex-credits";
import type { Sale } from "./profit";

// Billing is consulted once for the complete set of sales, not once per page.
// Never infer a cash bonus from the shipping gross amount or a zero discount.
export function applyFlexCredits(sales: Sale[], report: FlexCreditReport): Sale[] {
  return sales.map((sale) => {
    if (sale.mode !== "flex") return sale;
    const shipmentCredits = report.credits.filter((credit) => credit.shipmentId === sale.shipmentId && (!credit.orderId || sales.some((other) => other.shipmentId === credit.shipmentId && other.id === credit.orderId)));
    const credits = shipmentCredits.filter((credit) => !credit.orderId || credit.orderId === sale.id);
    const fallback = (sale.shippingCosts?.shippingPromotedCents ?? 0) > 0;
    return {
      ...sale,
      flexReconciliation: report.warnings.length ? "partial" : "queried",
      // Keep the user's subsidy rule when there is no billing movement, but
      // prefer billing whenever available. Never add the two sources together.
      flexCredits: shipmentCredits.length ? credits : fallback ? undefined : [],
      flexCreditsUnavailable: !shipmentCredits.length && !fallback,
    };
  });
}
