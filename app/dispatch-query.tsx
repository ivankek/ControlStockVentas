"use client";
import { useEffect, useRef, useState } from "react";
import { today } from "@/lib/domain";
import type { Order } from "@/lib/domain";
import type { DispatchQueryResult } from "@/lib/dispatch-query";

const statuses: Record<string, string> = {
  pending: "Pendiente", handling: "En preparación", ready_to_ship: "Listo para enviar",
  shipped: "En camino", delivered: "Entregado", not_delivered: "No entregado",
  cancelled: "Cancelado", returned: "Devuelto",
};
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
    const mode = o.mode === "flex" ? "Flex" : o.mode === "correo" ? "Mercado Envíos · correo" : "Acordar con el comprador / personalizado";
    return <div className="pending-row" key={o.id}><div className="order-text">
      <strong>Pedido {o.id}</strong>
      <p>{o.lines.map((l) => `${result?.products.find((p) => p.id === l.productId)?.name ?? l.productId} × ${l.quantity}`).join(" · ")}</p>
      <small>{mode} · {statuses[o.shippingStatus ?? ""] ?? o.shippingStatus ?? "Sin seguimiento disponible"}</small>
      {o.cancelled && <small>Venta cancelada: revisar antes de pagar al proveedor.</small>}
      {o.evidence && <small>{o.evidence}</small>}
      {o.review && <small>{o.review}</small>}
    </div></div>;
  }
  return <>
    <div className="toolbar"><label>Fecha de despacho
      <input aria-label="Fecha de despacho" type="date" max={today()} value={date} disabled={busy}
        onChange={(e) => { setDate(e.target.value); setResult(undefined); setError(""); }} />
    </label><button className="primary" disabled={busy || !date} onClick={() => void consult()}>
      {busy ? "Consultando…" : "Consultar despachos"}
    </button></div>
    <p className="table-note">Consulta temporal: los pedidos no se guardan en la base de datos. Al salir de esta pantalla se descartan los resultados.</p>
    {error && <p className="warning" role="alert">{error}</p>}
    {!result && !busy && !error && <div className="empty">Elegí una fecha y consultá los despachos registrados en Mercado Libre.</div>}
    {busy && <p role="status">Consultando ventas e historial de envíos. Puede tardar unos minutos.</p>}
    {result && <>
      <p className="warning">{result.warning}</p>
      <section className="panel"><div className="panel-title"><h2>Despachos del {result.date}</h2><span className="pill">{result.orders.length} pedidos</span></div>
        {result.orders.map(row)}
        {!result.orders.length && <div className="empty">No se encontraron despachos registrados para esa fecha dentro del período consultado.</div>}
      </section>
      <details className="panel pending"><summary>Sin fecha de despacho verificable ({result.unverified.length})</summary>
        <p className="table-note">Estos pedidos del período consultado no se cuentan como despachados en la fecha elegida. Los envíos acordados requieren una confirmación externa; todavía no se registra desde esta consulta.</p>
        {result.unverified.map(row)}
      </details>
    </>}
  </>;
}
