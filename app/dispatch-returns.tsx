"use client";
import { useEffect, useState } from "react";
import { useAccountPath } from "./inventory-context";
import { returnsPeriod, type DispatchReturn, type ReturnsPage } from "@/lib/dispatch-returns";

const labels: Record<string, string> = { pending: "Pendiente de envío", handling: "En preparación", ready_to_ship: "Lista para despachar", label_generated: "Etiqueta generada", shipped: "En camino", delivered: "Llegó a destino", not_delivered: "No entregada", cancelled: "Devolución cancelada", scheduled: "Retiro programado", return_to_buyer: "Volviendo al comprador", expired: "Vencida", failed: "Fallida", pending_delivered: "Entrega en proceso" };
export default function DispatchReturns({ token, from, to }: { token?: string; from: string; to: string }) {
  const accountPath = useAccountPath();
  const url = accountPath("/api/returns");
  const period = returnsPeriod(from, to);
  const [rows, setRows] = useState<DispatchReturn[]>([]);
  const [warnings, setWarnings] = useState<string[]>([]);
  const [error, setError] = useState("");
  const [busy, setBusy] = useState(false);
  const [refresh, setRefresh] = useState(0);
  useEffect(() => {
    const controller = new AbortController();
    setRows([]); setWarnings([]); setError("");
    if (!token) return;
    setBusy(true);
    void (async () => {
      try {
        let offset: number | null = 0;
        const found = new Map<string, DispatchReturn>();
        while (offset !== null) {
          const response = await fetch(url, { method: "POST", headers: { Authorization: `Bearer ${token}`, "Content-Type": "application/json" }, body: JSON.stringify({ from: period.from, to: period.to, offset }), signal: controller.signal });
          const data: ReturnsPage & { error?: string } = await response.json();
          if (!response.ok) throw Error(data.error || "No se pudieron consultar las devoluciones.");
          if (controller.signal.aborted) return;
          data.returns.forEach((row) => found.set(row.id, row));
          setRows([...found.values()].sort((a, b) => b.date_created.localeCompare(a.date_created)));
          setWarnings((current) => [...current, ...data.warnings]);
          offset = data.next;
        }
      } catch (e) { if (!controller.signal.aborted) setError(e instanceof Error ? e.message : "Error al consultar devoluciones."); }
      finally { if (!controller.signal.aborted) setBusy(false); }
    })();
    return () => controller.abort();
  }, [token, url, period.from, period.to, refresh]);
  return <section className="panel"><div className="panel-title"><h2>Devoluciones del {period.from.split("-").reverse().join("/")} al {period.to.split("-").reverse().join("/")}</h2><button disabled={busy || !token} onClick={() => setRefresh((value) => value + 1)}>Actualizar devoluciones</button></div>
    <p className="table-note">Devoluciones físicas iniciadas, enviadas o recibidas en este período, aunque se hayan iniciado antes. Se muestra su estado actual. No modifican el total ni el resumen del proveedor.</p>
    {busy && <p className="table-note" role="status">Consultando devoluciones…</p>}
    {(error || warnings.length > 0) && <div className="warning" role="alert">Consulta incompleta. {error}{warnings.length > 0 && <details><summary>Ver incidencias ({warnings.length})</summary>{warnings.map((warning, i) => <p key={i}>{warning}</p>)}</details>}</div>}
    {!busy && !error && !warnings.length && !rows.length && <p className="table-note">No hay devoluciones físicas iniciadas, enviadas o recibidas en este período.</p>}
    {rows.map((row) => <div className="dispatch-day" key={row.id}><h3>Devolución {row.id}</h3><p>Iniciada: {new Date(row.date_created).toLocaleDateString("es-AR", { timeZone: "America/Argentina/Buenos_Aires" })} · {labels[row.status] || row.status}</p>
      {row.orders.map((order) => <p key={`${order.order_id}:${order.item_id}`}>Orden {order.order_id}{order.item_id && ` · ${order.item_id}`}{order.return_quantity !== undefined && ` · ${order.return_quantity} unidad(es)`}</p>)}
      {row.shipments.map((shipment) => <div key={shipment.shipment_id}><p><strong>{labels[shipment.status] || shipment.status}</strong> · {shipment.destination?.name === "warehouse" ? "Depósito de Mercado Libre" : shipment.destination?.name === "seller_address" ? "Domicilio del vendedor" : "Destino sin informar"} · Envío {shipment.shipment_id}{shipment.tracking_number && ` · Seguimiento: ${shipment.tracking_number}`}</p>{shipment.history?.filter((event) => ["shipped", "delivered"].includes(event.status)).map((event, index) => <p key={index}>{event.status === "delivered" ? "Llegada" : "Enviada"}: {new Date(event.date).toLocaleDateString("es-AR", { timeZone: "America/Argentina/Buenos_Aires" })}</p>)}</div>)}
    </div>)}
  </section>;
}
