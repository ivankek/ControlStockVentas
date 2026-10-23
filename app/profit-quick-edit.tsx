"use client";
import { useEffect, useRef, useState } from "react";
import { useAccountPath } from "./inventory-context";
import { FLEX_LABELS, FLEX_ZONES } from "@/lib/flex-zones";
import type { Order } from "@/lib/domain";
import type { OrderNote } from "@/lib/business";

export default function ProfitQuickEdit({ order, note, field, token, onSaved }: { order: Order; note?: OrderNote; field: "flexZone" | "flexBonus"; token?: string; onSaved: () => void }) {
  const accountPath = useAccountPath();
  const dialog = useRef<HTMLDialogElement>(null);
  const [open, setOpen] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  useEffect(() => { if (open) dialog.current?.showModal(); }, [open]);
  const zone = field === "flexZone";
  return <><button className="units-toggle" disabled={!token} onClick={() => { setError(""); setOpen(true); }}>{zone ? "Completar zona" : "Confirmar bonificación"}</button>
    {open && <dialog ref={dialog} className="profit-quick-dialog" aria-label={zone ? "Completar zona Flex" : "Confirmar bonificación Flex"} onCancel={() => setOpen(false)} onClose={() => setOpen(false)}>
      <form onSubmit={async (event) => {
        event.preventDefault(); if (!token || busy) return;
        const value = new FormData(event.currentTarget).get(field);
        setBusy(true); setError("");
        try {
          const response = await fetch(accountPath("/api/business"), { method: "POST", headers: { Authorization: `Bearer ${token}`, "Content-Type": "application/json" }, body: JSON.stringify({ type: "note", id: order.id, [field]: value || null }) });
          const result = await response.json(); if (!response.ok) throw Error(result.error);
          setOpen(false); onSaved();
        } catch (e) { setError((e as Error).message); } finally { setBusy(false); }
      }}>
        <h2>{zone ? "Completar zona Flex" : "Bonificación Flex en el recibido"}</h2>
        <p><strong>Destino:</strong> {[order.province, order.city, order.neighborhood].filter((v, i, all) => v && all.indexOf(v) === i).join(" · ") || "Sin ubicación"}<small>Orden {order.id}</small></p>
        <label>{zone ? "Zona / cordón" : "¿La bonificación ya está incluida?"}<select name={field} defaultValue={note?.[field] ?? ""} disabled={busy}>
          <option value="">Verificar automáticamente</option>
          {zone ? [...FLEX_ZONES, "NONE" as const].map((z) => <option key={z} value={z}>{FLEX_LABELS[z]}</option>) : <><option value="included">Ya está incluida: no sumarla</option><option value="add">Falta sumarla al recibido</option></>}
        </select></label>
        {zone && <a href="/flex-cordones.jpg" target="_blank" rel="noreferrer" title="Abrir mapa en tamaño completo"><img className="profit-zone-map" src="/flex-cordones.jpg" alt="Mapa de CABA y cordones 1, 2 y 3 del Gran Buenos Aires" /></a>}
        {error && <p role="alert">{error}</p>}
        <div className="toolbar"><button type="submit" className="primary" disabled={busy}>{busy ? "Guardando…" : "Guardar"}</button><button type="button" disabled={busy} onClick={() => setOpen(false)}>Cancelar</button></div>
      </form>
    </dialog>}
  </>;
}
