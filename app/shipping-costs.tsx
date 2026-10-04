import { money } from "@/lib/domain";
import type { Sale } from "@/lib/profit";
const amount = (value: number | null | undefined) => value == null ? "No disponible" : money(value);
export default function ShippingCosts({ sale }: { sale: Sale }) {
  const cost = sale.shippingCosts;
  if (!cost) return null;
  return <details><summary>Costos del envío informados por Mercado Libre</summary>
    <p>Paquete: {sale.packId ?? "No informado"} · Envío: {sale.shipmentId ?? "Sin envío asociado"}</p>
    <p>Flex: {cost.isFlex === null ? "No determinado" : cost.isFlex ? "Sí" : "No"} · Logística: {cost.shippingLogisticType ?? "No disponible"}</p>
    <p>Estado: {sale.shippingStatus ?? "No disponible"}{sale.shippingSubstatus ? ` · ${sale.shippingSubstatus}` : ""}</p>
    <p>Bruto del envío: {amount(cost.shippingGrossCents)}</p>
    <p>A cargo del comprador: {amount(cost.buyerShippingCostCents)}</p>
    <p><strong>Costo final del vendedor: {amount(cost.sellerShippingCostCents)}</strong></p>
    <p>Subsidio informado por Mercado Libre: {amount(cost.shippingPromotedCents)}{sale.mode === "flex" ? " · tratado como ingreso Flex según la regla configurada; el detalle de la venta indica si se sumó o ya estaba incluido." : " · informativo para Mercado Envíos correo."}</p>
    {cost.shippingPromotedCents === 0 && <p>Este recurso no informa un importe de subsidio. Esto no confirma que no exista una acreditación Flex por separado.</p>}
    {cost.shippingDiscounts?.map((discount, index) => <p key={index}>{discount.type ?? "Descuento"}{discount.rate !== undefined ? ` · tasa informada: ${discount.rate}` : ""} · Importe: {discount.promoted_amount === undefined ? "No informado" : money(Math.round(discount.promoted_amount * 100))}</p>)}
    {cost.shippingError && <p role="status">{cost.shippingError}</p>}
    <p>El costo de Mercado Libre y el pago al transportista propio son conceptos distintos. Este costo no se vuelve a descontar del neto recibido de Mercado Pago.</p>
    {sale.mode === "flex" && <p>La facturación Flex todavía no se consulta. Para este cálculo se usa el subsidio informado del envío, sin sumarlo nuevamente cuando ya está incluido en el recibido.</p>}
  </details>;
}
