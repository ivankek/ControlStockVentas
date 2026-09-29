"use client";
import { useViewState } from "./view-state";
import { useAccountPath, useInventory } from "./inventory-context";
import { useEffect, useRef, useState } from "react";
import { today, money } from "@/lib/domain";
import type { Order } from "@/lib/domain";
import { dispatchMessage, filterDispatchOrders, type DispatchFilters, type DispatchQueryResult } from "@/lib/dispatch-query";
import { FLEX_LABELS } from "@/lib/flex-zones";
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
const shippingDetails: Record<string, string> = {
  returning_to_sender: "En devolución al remitente", returned_to_hub: "Devuelto al centro logístico",
  returned_to_agency: "Devuelto a la agencia", picked_up_for_return: "Retirado para devolución",
  receiver_absent: "Destinatario ausente", waiting_for_withdrawal: "Esperando retiro",
  not_localized: "Domicilio no localizado", destroyed: "Envío destruido",
  damaged: "Envío dañado", to_review: "En revisión", closed_by_user: "Cerrado por el usuario",
};
function statusColor(status?: string) {
  if (["delivered", "paid"].includes(status ?? "")) return "success";
  if (["shipped", "confirmed", "active"].includes(status ?? "")) return "info";
  if (["cancelled", "not_delivered", "invalid", "error"].includes(status ?? "")) return "danger";
  if (status && (statuses[status] || orderStatuses[status])) return "warning";
  return "neutral";
}
export default function DispatchQuery({ token }: { token?: string }) {
  const accountPath = useAccountPath();
  const { account } = useInventory();
  const [date, setDate] = useViewState("app/dispatch-query.tsx:date", today);
  const [from, setFrom] = useViewState("app/dispatch-query.tsx:from", today);
  const [period, setPeriod] = useViewState("app/dispatch-query.tsx:period", false);
  const [copyStatus, setCopyStatus] = useState("");
  const [result, setResult] = useViewState<DispatchQueryResult>("app/dispatch-query.tsx:result");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const emptyFilters: DispatchFilters = { from: "", to: "", shipping: "", order: "", reviewOnly: false, sort: "desc" };
  const [filters, setFilters] = useViewState<DispatchFilters>("app/dispatch-query.tsx:filters", emptyFilters);
  const [modalDay, setModalDay] = useState<string>();
  const dialog = useRef<HTMLDialogElement>(null);
  const detailSection = useRef<HTMLElement>(null);
  useEffect(() => {
    if (modalDay && result && dialog.current && !dialog.current.open) dialog.current.showModal();
  }, [modalDay, result]);
  const controller = useRef<AbortController | null>(null);
  useEffect(() => () => controller.current?.abort(), []);
  useEffect(() => {
    controller.current?.abort();
    setBusy(false);
    setModalDay(undefined);
  }, [token, account]);

  async function consult() {
    if (!token) { setError("Iniciá sesión y conectá Mercado Libre para consultar."); return; }
    controller.current?.abort();
    const request = new AbortController();
    controller.current = request;
    setBusy(true); setError(""); setCopyStatus(""); setResult(undefined); setModalDay(undefined); setFilters(emptyFilters);
    try {
      const response = await fetch(accountPath("/api/sync"), {
        method: "POST", headers: { Authorization: `Bearer ${token}`, "Content-Type": "application/json" },
        body: JSON.stringify({ date, from: period ? from : date }), signal: request.signal,
      });
      const data = await response.json();
      if (!response.ok) throw Error(data.error || "No se pudo completar la consulta.");
      if (!request.signal.aborted) setResult(data);
    } catch (e) {
      if (!request.signal.aborted) setError(e instanceof Error ? e.message : "No se pudo consultar.");
    } finally { if (!request.signal.aborted) setBusy(false); }
  }
  async function copy() {
    if (!result) return;
    try { await navigator.clipboard.writeText(dispatchMessage(result.days ?? [])); setCopyStatus("Resumen copiado. Ya podés enviárselo al proveedor."); }
    catch { setCopyStatus("No se pudo copiar automáticamente. Seleccioná y copiá el texto del resumen."); }
  }
  function row(o: Order) {
    const cost = result?.supplier?.orders.find((entry) => entry.orderId === o.id);
    const mode = o.mode === "flex" ? "Flex" : o.mode === "correo" ? "Mercado Envíos · correo" : "Acordar con el comprador / personalizado";
    return <div className="pending-row" key={o.id}><div className="order-text">
      <div className="dispatch-heading"><strong>ID de orden: {o.id}</strong>
        {o.cancelled && <span className="dispatch-status danger">Venta cancelada{o.cancellationRequestedBy === "buyer" ? " por el comprador" : o.cancellationRequestedBy === "seller" ? " por el vendedor" : ""}</span>}
        <span className={`dispatch-status ${o.cancelled ? "neutral" : statusColor(o.shippingStatus)}`}>Envío: {statuses[o.shippingStatus ?? ""] ?? o.shippingStatus ?? "Sin seguimiento"}</span>
        <span className={`dispatch-status ${statusColor(o.orderStatus)}`}>Pedido: {orderStatuses[o.orderStatus ?? ""] ?? "Sin información"}</span>
      </div>
      {o.packId && <small>Número de paquete: {o.packId}</small>}
      {o.shippingSubstatus && <small>Detalle del envío: {shippingDetails[o.shippingSubstatus] ?? o.shippingSubstatus}</small>}
      {o.cancellationReason && <small>Motivo de cancelación: {o.cancellationReason}</small>}
      <p>{o.lines.map((l) => `${result?.products.find((p) => p.id === l.productId)?.name ?? l.productId} × ${l.quantity}`).join(" · ")}</p>
      <p className="dispatch-customer">Comprador: <strong>{o.buyerName || "No informado"}</strong></p>
      {!o.buyerName && o.receiverName && <small>Destinatario: {o.receiverName}</small>}
      <small>Provincia: {o.province || "No informada"} · Localidad: {o.city || "No informada"}</small>
      <small>{mode}</small>
      {o.cancelled && o.shippingStatus && o.shippingStatus !== "cancelled" && <small>La venta está cancelada. El seguimiento del envío aún informa «{statuses[o.shippingStatus] ?? o.shippingStatus}».</small>}
      {o.dispatchedDate && <small>Despacho registrado: {o.dispatchedDate.split("-").reverse().join("/")} · {o.evidence === "Confirmado manualmente" ? "Confirmación manual" : "Mercado Libre"}</small>}
      {o.mode === "flex" && <small>Zona Flex: {result?.flex?.[o.id]?.zone ? FLEX_LABELS[result.flex[o.id].zone!] : "Desconocida"} · {result?.flex?.[o.id]?.cents === undefined ? "Costo pendiente" : money(result.flex[o.id].cents!)} · {result?.flex?.[o.id]?.reason}</small>}
      {(o.mode === "acordar" || o.mode === "flex") && <OrderNoteEditor key={`${o.id}-${result?.notes?.[o.id]?.updatedAt}`} order={o} note={result?.notes?.[o.id]} token={token} onSaved={() => void consult()} />}
      {o.review && <small>{o.review}</small>}
      {cost && <p><strong>{cost.missing.length && !cost.totalCents ? "Costo del proveedor pendiente" : `${cost.missing.length || cost.review ? "Costo parcial / a revisar" : "Costo del proveedor"}: ${money(cost.totalCents)}`}</strong></p>}
      {!!cost?.missing.length && <div className="dispatch-issues"><strong>Falta completar:</strong><ul>{cost.missing.map((text) => <li key={text}>{text}</li>)}</ul></div>}
    </div></div>;
  }
  const visibleOrders = result ? filterDispatchOrders(result, filters) : [];
  const reviewCount = result?.supplier?.orders.filter((o) => o.missing.length || o.review).length ?? 0;
  return <>
    <div className="toolbar"><label>Consultar<select value={period ? "range" : "day"} disabled={busy} onChange={(e) => { setPeriod(e.target.value === "range"); setResult(undefined); setCopyStatus(""); }}><option value="day">Un día</option><option value="range">Rango de fechas</option></select></label>
    {period && <label>Desde<input type="date" max={date} value={from} disabled={busy} onChange={(e) => { setFrom(e.target.value); setResult(undefined); setCopyStatus(""); }} /></label>}
    <label>{period ? "Hasta" : "Fecha de despacho"}
      <input aria-label="Fecha de despacho" type="date" max={today()} value={date} disabled={busy}
        onChange={(e) => { setDate(e.target.value); setResult(undefined); setError(""); }} />
    </label><button className="primary" disabled={busy || !date || (period && (!from || from > date))} onClick={() => void consult()}>
      {busy ? "Consultando…" : "Consultar despachos"}
    </button></div>
    <p className="table-note">Los pedidos consultados son temporales. Se guardan únicamente las confirmaciones y los costos de envío que cargues manualmente.</p>
    {error && <p className="warning" role="alert">{error}</p>}
    {!result && !busy && !error && <div className="empty">Elegí un día o un rango de fechas y consultá los despachos registrados en Mercado Libre.</div>}
    {busy && <p role="status">Consultando ventas e historial de envíos. Puede tardar unos minutos.</p>}
    {result && <>
      <p className="table-note">Se muestran los despachos registrados entre {result.from.split("-").reverse().join("/")} y {result.date.split("-").reverse().join("/")}.</p>
      <p className="table-note">Estados consultados: {new Date(result.queriedAt).toLocaleString("es-AR", { timeZone: "America/Argentina/Buenos_Aires" })}. <button disabled={busy} onClick={() => void consult()}>Actualizar estados</button></p>
      <details className="dispatch-coverage"><summary>Cómo se buscan los despachos y qué puede quedar fuera</summary><p>{result.warning}</p><p>Por ejemplo: una compra del viernes despachada el lunes debe aparecer al consultar el lunes. La búsqueda de órdenes usa la fecha de compra y luego comprobamos la fecha del envío.</p></details>
      {!!result.orders.length && <section className="panel dispatch-copy"><div className="panel-title"><h2>Resumen para el proveedor</h2><button className="primary" onClick={() => void copy()}>Copiar resumen</button></div>
        {result.days?.map((day) => <div className="dispatch-day" key={day.date}><div className="dispatch-heading"><h3>{dispatchMessage([day]).split("\n")[0]}</h3><button onClick={() => setModalDay(day.date)}>Ver envíos ({result.orders.filter((o) => o.dispatchedDate === day.date).length})</button></div><pre>{dispatchMessage([day]).split("\n").slice(1).join("\n")}</pre></div>)}
        <p className="table-note"><strong>{result.supplier?.complete ? "Total" : "Subtotal parcial"}: {money(result.supplier?.totalCents ?? 0)}</strong></p>{copyStatus && <p role="status">{copyStatus}</p>}
      </section>}
      {result.supplier && <section className="panel pending"><div className="panel-title"><h2>{result.supplier.complete ? "Total del período al proveedor" : "Subtotal calculable · pendiente de revisión"}</h2><strong>{money(result.supplier.totalCents)}</strong></div>
        <div className="table-wrap"><table><thead><tr><th>FECHA</th><th>PRODUCTO DEL PROVEEDOR</th><th>UNIDADES</th><th>COSTO UNITARIO</th><th>IMPORTE</th></tr></thead><tbody>{result.days?.flatMap((day) => day.supplier.rows.map((r) => <tr key={`${day.date}:${r.id}`}><td>{day.date.split("-").reverse().join("/")}</td><td>{r.name}</td><td>{r.units}</td><td>{money(r.unitCents)}</td><td>{money(r.totalCents)}</td></tr>))}</tbody></table></div>
        {!result.supplier.complete && <div className="warning">{reviewCount} pedidos necesitan revisión. Cada pedido indica el producto sin asociación, el costo faltante o la incidencia.<button onClick={() => { setFilters({ ...emptyFilters, reviewOnly: true }); detailSection.current?.scrollIntoView({ behavior: "smooth", block: "start" }); }}>Ver pedidos para revisar</button></div>}
        <p className="table-note">Costo vigente en cada fecha de despacho. No registra pagos ni descuenta pagos anteriores. Solo incluye despachos del período; los pedidos sin fecha verificable quedan fuera.</p>
      </section>}
      <section className="panel" ref={detailSection}><div className="panel-title"><h2>Despachos {result.from !== result.date ? `del ${result.from} al ${result.date}` : `del ${result.date}`}</h2><span className="pill">{visibleOrders.length} de {result.orders.length} pedidos</span></div>
        <div className="toolbar dispatch-filters">
          <label>Despachado desde<input type="date" min={result.from} max={result.date} value={filters.from} onChange={(e) => setFilters({ ...filters, from: e.target.value })} /></label>
          <label>Hasta<input type="date" min={filters.from || result.from} max={result.date} value={filters.to} onChange={(e) => setFilters({ ...filters, to: e.target.value })} /></label>
          <label>Estado del envío<select value={filters.shipping} onChange={(e) => setFilters({ ...filters, shipping: e.target.value })}><option value="">Todos</option>{[...new Set(result.orders.map((o) => o.shippingStatus ?? "unknown"))].sort().map((s) => <option key={s} value={s}>{statuses[s] ?? (s === "unknown" ? "Sin seguimiento" : s)}</option>)}</select></label>
          <label>Estado del pedido<select value={filters.order} onChange={(e) => setFilters({ ...filters, order: e.target.value })}><option value="">Todos</option>{[...new Set(result.orders.map((o) => o.orderStatus ?? "unknown"))].sort().map((s) => <option key={s} value={s}>{orderStatuses[s] ?? (s === "unknown" ? "Sin información" : s)}</option>)}</select></label>
          <label>Ordenar<select value={filters.sort} onChange={(e) => setFilters({ ...filters, sort: e.target.value })}><option value="desc">Más recientes primero</option><option value="asc">Más antiguos primero</option><option value="status">Estado del envío</option><option value="review">Para revisar primero</option></select></label>
          <label><input type="checkbox" checked={filters.reviewOnly} onChange={(e) => setFilters({ ...filters, reviewOnly: e.target.checked })} />Solo para revisar</label><button onClick={() => setFilters(emptyFilters)}>Limpiar filtros</button>
        </div>
        <p className="table-note">Los filtros se aplican a este detalle. El resumen y el total de arriba corresponden al período consultado completo.</p>
        {visibleOrders.map(row)}
        {!visibleOrders.length && <div className="empty">{result.orders.length ? "No hay pedidos que coincidan con estos filtros." : "No se encontraron despachos registrados para ese período dentro de la cobertura consultada."}</div>}
      </section>
      <details className="panel pending"><summary>Sin fecha de despacho verificable ({result.unverified.length})</summary>
        <p className="table-note">Estos pedidos no se cuentan como despachados en el período elegido. En los envíos acordados podés registrar el despacho y su fecha.</p>
        {result.unverified.map(row)}
      </details>
      {modalDay && <dialog ref={dialog} className="dispatch-dialog" aria-labelledby="dispatch-dialog-title" onCancel={() => setModalDay(undefined)} onClose={() => setModalDay(undefined)} onClick={(e) => { if (e.target === e.currentTarget) { dialog.current?.close(); setModalDay(undefined); } }}><div className="dispatch-dialog-content"><div className="panel-title"><h2 id="dispatch-dialog-title">Envíos del {modalDay.split("-").reverse().join("/")}</h2><button autoFocus onClick={() => { dialog.current?.close(); setModalDay(undefined); }}>Cerrar ×</button></div>{result.orders.filter((o) => o.dispatchedDate === modalDay).map(row)}</div></dialog>}
    </>}
  </>;
}
