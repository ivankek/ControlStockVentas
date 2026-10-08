import { get } from "./meli";

export type FlexCredit = { id: string; shipmentId: string; orderId?: string; cents: number };
export type FlexCreditReport = { credits: FlexCredit[]; warnings: string[] };
type Detail = { charge_info?: { detail_id?: number | string; detail_amount?: number; detail_type?: string; concept_type?: string }; shipping_info?: { shipping_id?: number | string; order?: { order_id?: number | string } }; currency_info?: { currency_id?: string } };
type Page<T> = { results: T[]; total: number; last_id?: string | number; errors?: unknown[] };
const id = (value: unknown) => typeof value === "string" && /^\d+$/.test(value) ? value : typeof value === "number" && Number.isSafeInteger(value) && value > 0 ? String(value) : undefined;
export function parseFlexCredit(detail: Detail): FlexCredit | undefined {
  const charge = detail.charge_info, shipping = detail.shipping_info;
  if (charge?.concept_type !== "FLEX") return undefined;
  const key = id(charge.detail_id), shipment = id(shipping?.shipping_id);
  const amount = charge.detail_amount;
  if (!key || !shipment || typeof amount !== "number" || amount < 0 || !Number.isSafeInteger(Math.round(amount * 100)) || !["BONUS", "CHARGE"].includes(charge.detail_type ?? "") || (detail.currency_info && detail.currency_info.currency_id !== "ARS")) throw Error("Bonificación Flex incompleta");
  return { id: key, shipmentId: shipment, orderId: id(shipping?.order?.order_id), cents: Math.round(amount * 100) * (charge.detail_type === "BONUS" ? 1 : -1) };
}
function validate<T>(page: Page<T>) {
  if (!Array.isArray(page.results) || !Number.isInteger(page.total) || page.total < 0 || page.errors?.length) throw Error("Consulta de bonificaciones incompleta");
}
async function billingPage<T>(path: string, token: string, context: string): Promise<Page<T>> {
  try {
    const page = await get<Page<T>>(path, token);
    validate(page);
    return page;
  } catch (error) {
    throw Error(`${context}: ${error instanceof Error ? error.message : "consulta incompleta"}`);
  }
}
// Billing cycles depend on the seller. Query their actual keys, including later
// periods where a credit or reversal for an earlier sale may have been posted.
export async function flexCreditReport(token: string, from: string): Promise<FlexCreditReport> {
  const credits = new Map<string, FlexCredit>();
  const warnings: string[] = [];
  const conflicting = new Set<string>();
  for (const document of ["BILL", "CREDIT_NOTE"]) {
    const periods: { key: string; period: { date_to: string } }[] = [];
    try {
      for (let offset = 0; ; offset += 12) {
        if (offset >= 120) throw Error("Demasiados períodos de facturación");
        const page = await billingPage<typeof periods[number]>(`/billing/integration/monthly/periods?group=ML&document_type=${document}&offset=${offset}&limit=12`, token, `Períodos de facturación ${document}`);
        periods.push(...page.results.filter((p) => p.period?.date_to >= from));
        if (offset + page.results.length >= page.total) break;
        if (!page.results.length) throw Error("La consulta de períodos no avanzó");
      }
    } catch (error) { warnings.push(`${document}: ${error instanceof Error ? error.message : "No se pudieron consultar los períodos"}`); }
    // Keep periods already read even if a later page fails. A failure in one
    // document/period must not discard valid movements from the others.
    for (const period of periods) {
      try {
        if (!/^\d{4}-\d{2}-\d{2}$/.test(period.key)) throw Error("Período de facturación inválido");
        let cursor = "0", read = 0;
        for (let pages = 0; ; pages++) {
          if (pages >= 100) throw Error("Demasiadas bonificaciones en un período");
          const page = await billingPage<Detail>(`/billing/integration/periods/key/${period.key}/group/ML/flex/details?document_type=${document}&limit=1000&from_id=${encodeURIComponent(cursor)}&sort_by=ID&order_by=ASC`, token, `Bonificaciones Flex ${document}, período ${period.key}`);
          for (const detail of page.results) {
            const credit = parseFlexCredit(detail);
            if (!credit) continue;
            const prior = credits.get(credit.id);
            if (prior && JSON.stringify(prior) !== JSON.stringify(credit)) {
              credits.delete(credit.id); conflicting.add(credit.id);
              warnings.push(`Movimiento Flex ${credit.id}: datos contradictorios; no se incluye.`);
            }
            if (conflicting.has(credit.id)) continue;
            credits.set(credit.id, credit);
          }
          read += page.results.length;
          if (read >= page.total) break;
          const next = id(page.last_id) ?? id(page.results.at(-1)?.charge_info?.detail_id);
          if (!page.results.length || !next || BigInt(next) <= BigInt(cursor)) throw Error("La consulta de bonificaciones no avanzó");
          cursor = next;
        }
      } catch (error) { warnings.push(`${document}, ${period.key}: ${error instanceof Error ? error.message : "No se pudieron consultar los movimientos"}`); }
    }
  }
  return { credits: [...credits.values()], warnings };
}
export async function flexCredits(token: string, from: string): Promise<FlexCredit[]> {
  const report = await flexCreditReport(token, from);
  if (report.warnings.length) throw Error(report.warnings.join(" · "));
  return report.credits;
}

export type PaymentFees = { transaction_amount?: number; taxes_amount?: number; fee_details?: { amount?: number; fee_payer?: string; type?: string }[] };
const moneyCents = (amount: unknown) => typeof amount === "number" && Number.isFinite(amount) && amount >= 0 && Number.isSafeInteger(Math.round(amount * 100)) ? Math.round(amount * 100) : undefined;

// ML may omit marketplace fees from MP's fee_details. Prefer the fee attached
// to this payment; use per-unit order fees only for a single-payment order.
export function orderPaymentFee(order: { payments?: { id: number; status: string; marketplace_fee?: number | null }[]; order_items: { quantity: number; sale_fee?: number }[] }, paymentId: number) {
  const approved = order.payments?.filter((p) => p.status === "approved") ?? [];
  const payment = approved.find((p) => p.id === paymentId);
  const explicit = moneyCents(payment?.marketplace_fee);
  if (explicit !== undefined) return explicit;
  if (approved.length !== 1 || !payment || !order.order_items.length) return undefined;
  let total = 0;
  for (const item of order.order_items) {
    const fee = moneyCents(item.sale_fee);
    if (fee === undefined || !Number.isSafeInteger(item.quantity) || item.quantity <= 0) return undefined;
    total += fee * item.quantity;
  }
  return Number.isSafeInteger(total) ? total : undefined;
}

// An empty fee list is not evidence of a commission-free sale. Never treat
// gross as item net just because MP omitted ML's marketplace commission.
export function paymentBase(data: PaymentFees, marketplaceFeeCents?: number) {
  const amount = moneyCents(data.transaction_amount), taxes = moneyCents(data.taxes_amount);
  if (amount === undefined || taxes === undefined || !Array.isArray(data.fee_details)) return undefined;
  let cents = amount, taxesInFees = false, marketplaceInFees = false;
  for (const fee of data.fee_details) {
    if (fee.fee_payer === "payer") continue;
    const charge = moneyCents(fee.amount);
    if (fee.fee_payer !== "collector" || charge === undefined || !fee.type) return undefined;
    if (/shipping|envio|flex/i.test(fee.type)) return undefined;
    taxesInFees ||= /tax|impuesto|retenc/i.test(fee.type);
    marketplaceInFees ||= fee.type === "marketplace_fee";
    cents -= charge;
  }
  if (!marketplaceInFees) {
    if (marketplaceFeeCents === undefined || !Number.isSafeInteger(marketplaceFeeCents) || marketplaceFeeCents < 0) return undefined;
    cents -= marketplaceFeeCents;
  }
  if (!taxesInFees) cents -= taxes;
  return Number.isSafeInteger(cents) && cents >= 0 ? cents : undefined;
}
