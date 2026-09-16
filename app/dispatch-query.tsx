"use client";
import { useEffect, useRef, useState } from "react";
import { today, money } from "@/lib/domain";
import type { Order } from "@/lib/domain";
import type { DispatchQueryResult } from "@/lib/dispatch-query";
import OrderNoteEditor from "./order-note";

const statuses: Record<string, string> = {
  pending: "Pendiente", handling: "En preparación", ready_to_ship: "Listo para enviar",
  shipped: "En camino", delivered: "Entregado", not_delivered: "No entregado",
  cancelled: "Cancelado", returned: "Devuelto",
  to_be_agreed: "A coordinar", not_verified: "Sin verificar", closed: "Cerrado",
  error: "Error de envío", active: "Activo", not_specified: "Sin especificar",
  stale_ready_to_ship: "Pendiente de envío demorado", stale_shipped: "Envío demorado",
};
const orderStatuses: Record<string, string> = {
  confirmed: "Confirmado", payment_required: "Pendiente de pago", payment_in_process: "Pago en proceso",
  partially_paid: "Pago parcial", paid: "Pagado", partially_refunded: "Reembolso parcial",
  pending_cancel: "Cancelación pendiente", cancelled: "Cancelado", invalid: "No válido",
};
function statusColor(status?: string) {
  if (["delivered", "paid"].includes(status ?? "")) return "success";
  if (["shipped", "confirmed", "active"].includes(status ?? "")) return "info";
  if (["cancelled", "not_delivered", "invalid", "error"].includes(status ?? "")) return "danger";
  if (status && (statuses[status] || orderStatuses[status])) return "warning";
  return "neutral";
}
export default function DispatchQuery({ token }: { token?: string }) {
  const [date, setDate] = useState(today);
  const [result, setResult] = useState<DispatchQueryResult>();
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const controller = useRef<AbortController | null>(null);
  useEffect(() => () => controller.current?.abort(), []);
  useEffect(() => {
    controller.current?.abort();
    setResult(undefined);
    setBusy(false);
  }, [token]);

  async function consult() {
    if (!token) { setError("Iniciá sesión y conectá Mercado Libre para consultar."); return; }
    controller.current?.abort();
    const request = new AbortController();
    controller.current = request;
    setBusy(true); setError(""); setResult(undefined);
    try {
      const response = await fetch("/api/sync", {
        method: "POST", headers: { Authorization: `Bearer ${token}`, "Content-Type": "application/json" },
        body: JSON.stringify({ date }), signal: request.signal,
      });
      const data = await response.json();
      if (!response.ok) throw Error(data.error || "No se pudo completar la consulta.");
      if (!request.signal.aborted) setResult(data);
    } catch (e) {
      if (!request.signal.aborted) setError(e instanceof Error ? e.message : "No se pudo consultar.");
    } finally { if (!request.signal.aborted) setBusy(false); }
  }
  function row(o: Order) {
    const cost = result?.supplier?.orders.find((entry) => entry.orderId === o.id);
    const mode = o.mode === "flex" ? "Flex" : o.mode === "correo" ? "Mercado Envíos · correo" : "Acordar con el comprador / personalizado";
    return <div className="pending-row" key={o.id}><div className="order-text">
      <div className="dispatch-heading"><strong>ID de orden: {o.id}</strong>
        <span className={`dispatch-status ${statusColor(o.shippingStatus)}`}>Envío: {statuses[o.shippingStatus ?? ""] ?? (o.shippingStatus ? "Estado no reconocido" : "Sin seguimiento")}</span>
        <span className={`dispatch-status ${statusColor(o.orderStatus)}`}>Pedido: {orderStatuses[o.orderStatus ?? ""] ?? "Sin información"}</span>
      </div>
      <p>{o.lines.map((l) => `${result?.products.find((p) => p.id === l.productId)?.name ?? l.productId} × ${l.quantity}`).join(" · ")}</p>
      <p className="dispatch-customer">Comprador: <strong>{o.buyerName || "No informado"}</strong></p>
      {!o.buyerName && o.receiverName && <small>Destinatario: {o.receiverName}</small>}
      <small>Provincia: {o.province || "No informada"} · Localidad: {o.city || "No informada"}</small>
      <small>{mode}</small>
      {o.cancelled && <small>Venta cancelada: revisar antes de pagar al proveedor.</small>}
      {o.dispatchedDate && <small>Despacho registrado: {o.dispatchedDate.split("-").reverse().join("/")} · {o.evidence === "Confirmado manualmente" ? "Confirmación manual" : "Mercado Libre"}</small>}
      {o.mode === "acordar" && <OrderNoteEditor key={`${o.id}-${result?.notes?.[o.id]?.updatedAt}`} order={o} note={result?.notes?.[o.id]} token={token} onSaved={() => void consult()} />}
      {o.review && <small>{o.review}</small>}
      {cost && <p><strong>{cost.missing.length || cost.review ? "Costo parcial / a revisar" : "Costo del proveedor"}: {money(cost.totalCents)}</strong></p>}
      {cost?.missing.map((text) => <small key={text}>{text}</small>)}
    </div></div>;
  }
  return <>
    <div className="toolbar"><label>Fecha de despacho
      <input aria-label="Fecha de despacho" type="date" max={today()} value={date} disabled={busy}
        onChange={(e) => { setDate(e.target.value); setResult(undefined); setError(""); }} />
    </label><button className="primary" disabled={busy || !date} onClick={() => void consult()}>
      {busy ? "Consultando…" : "Consultar despachos"}
    </button></div>
    <p className="table-note">Los pedidos consultados son temporales. Se guardan únicamente las confirmaciones y los costos de envío que cargues manualmente.</p>
    {error && <p className="warning" role="alert">{error}</p>}
    {!result && !busy && !error && <div className="empty">Elegí una fecha y consultá los despachos registrados en Mercado Libre.</div>}
    {busy && <p role="status">Consultando ventas e historial de envíos. Puede tardar unos minutos.</p>}
    {result && <>
      <p className="warning">{result.warning}</p>
      {result.supplier && <section className="panel pending"><div className="panel-title"><h2>{result.supplier.complete ? "Total del día al proveedor" : "Subtotal calculable · pendiente de revisión"}</h2><strong>{money(result.supplier.totalCents)}</strong></div>
        <div className="table-wrap"><table><thead><tr><th>PRODUCTO DEL PROVEEDOR</th><th>UNIDADES</th><th>COSTO UNITARIO</th><th>IMPORTE</th></tr></thead><tbody>{result.supplier.rows.map((r) => <tr key={r.id}><td>{r.name}</td><td>{r.units}</td><td>{money(r.unitCents)}</td><td>{money(r.totalCents)}</td></tr>)}</tbody></table></div>
        {!result.supplier.complete && <p className="warning">Faltan asociaciones o costos, o hay pedidos con incidencias. Revisá el detalle antes de pagar.</p>}
        <p className="table-note">Costo vigente en la fecha consultada. No registra pagos ni descuenta pagos anteriores. Solo incluye despachos de esta fecha; los pedidos sin fecha verificable quedan fuera.</p>
      </section>}
      <section className="panel"><div className="panel-title"><h2>Despachos del {result.date}</h2><span className="pill">{result.orders.length} pedidos</span></div>
        {result.orders.map(row)}
        {!result.orders.length && <div className="empty">No se encontraron despachos registrados para esa fecha dentro del período consultado.</div>}
      </section>
      <details className="panel pending"><summary>Sin fecha de despacho verificable ({result.unverified.length})</summary>
        <p className="table-note">Estos pedidos no se cuentan como despachados en la fecha elegida. En los envíos acordados podés registrar el despacho y su fecha.</p>
        {result.unverified.map(row)}
      </details>
    </>}
  </>;
}
