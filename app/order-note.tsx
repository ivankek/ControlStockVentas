"use client";
import { useState } from "react";
import { localDate, today, type Order } from "@/lib/domain";
import type { OrderNote } from "@/lib/business";
export default function OrderNoteEditor({ order, note, token, onSaved, financial = false }: { order: Order; note?: OrderNote; token?: string; onSaved: () => void; financial?: boolean }) {
  const [open, setOpen] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const [dispatched, setDispatched] = useState(!!note?.dispatchedDate);
  return <div className="order-note"><button className="units-toggle" onClick={() => setOpen(!open)} aria-expanded={open}>{financial ? "Completar importes" : "Registrar / editar despacho"}</button>
    {open && <form className="supplier-binding" onSubmit={async (event) => {
      event.preventDefault(); if (!token) return;
      const data = new FormData(event.currentTarget);
      const amount = (key: string) => data.get(key) === "" ? null : Math.round(Number(data.get(key)) * 100);
      setBusy(true); setError("");
      try {
        const response = await fetch("/api/business", { method: "POST", headers: { Authorization: `Bearer ${token}`, "Content-Type": "application/json" }, body: JSON.stringify({ type: "note", id: order.id, ...(order.mode === "acordar" ? { ...(financial ? {} : { dispatchedDate: dispatched ? data.get("date") : null }), shippingCents: amount("shipping") } : {}), ...(financial ? { netCents: amount("net") } : {}) }) });
        const result = await response.json(); if (!response.ok) throw Error(result.error);
        setOpen(false); onSaved();
      } catch (e) { setError((e as Error).message); }
      finally { setBusy(false); }
    }}>
      {order.mode === "acordar" && <>
        {!financial && <><label>Estado<select value={dispatched ? "yes" : "no"} onChange={(e) => setDispatched(e.target.value === "yes")} disabled={busy}><option value="no">No despachado</option><option value="yes">Ya despachado</option></select></label>
          {dispatched && <label>Fecha de despacho<input name="date" type="date" min={localDate(order.createdAt)} max={today()} defaultValue={note?.dispatchedDate ?? today()} required disabled={busy} /></label>}</>}
        <label>Costo de envío a tu cargo ($)<input name="shipping" type="number" min="0" step="0.01" defaultValue={note?.shippingCents === undefined ? "" : note.shippingCents / 100} placeholder="Sin informar" disabled={busy} /></label>
      </>}
      {financial && <label>Neto recibido verificado ($)<input name="net" type="number" min="0" step="0.01" defaultValue={note?.netCents === undefined ? "" : note.netCents / 100} placeholder="Usar dato de la API" disabled={busy} /><small>Importe final después de cargos y ajustes de esta venta. Vacío vuelve a usar la API.</small></label>}
      <button disabled={busy || !token}>{busy ? "Guardando…" : "Guardar"}</button>
      {error && <small role="alert">{error}</small>}
    </form>}
  </div>;
}
