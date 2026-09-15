"use client";
import { useEffect, useRef, useState } from "react";
import type { Listing } from "@/lib/listings";
const statuses: Record<string, string> = { active: "Activa", paused: "Pausada", closed: "Finalizada", under_review: "En revisión", inactive: "Inactiva", payment_required: "Pago pendiente", not_yet_active: "Pendiente de activación" };
export default function Listings({ token }: { token?: string }) {
  const [items, setItems] = useState<Listing[]>([]);
  const [busy, setBusy] = useState(false);
  const [message, setMessage] = useState("");
  const [filter, setFilter] = useState("");
  const active = useRef<AbortController | null>(null);
  useEffect(() => { setItems([]); setMessage(""); if (token) void request(false); return () => active.current?.abort(); }, [token]);
  async function request(update: boolean) {
    if (!token) return;
    active.current?.abort();
    const controller = new AbortController(); active.current = controller;
    setBusy(true); setMessage("");
    try {
      const response = await fetch("/api/listings", { method: update ? "POST" : "GET", headers: { Authorization: `Bearer ${token}` }, signal: controller.signal, cache: "no-store" });
      const data = await response.json();
      if (!response.ok) throw Error(data.error || "No se pudieron consultar las publicaciones.");
      if (controller.signal.aborted) return;
      setItems(data.listings);
      if (update) setMessage(`${data.added} nuevas · ${data.updated} actualizadas · ${data.unchanged} sin cambios.`);
    } catch (error) { if (!controller.signal.aborted) setMessage(error instanceof Error ? error.message : "No se pudo completar la operación."); }
    finally { if (!controller.signal.aborted) setBusy(false); }
  }
  const visible = items.filter((item) => `${item.id} ${item.title}`.toLocaleLowerCase().includes(filter.toLocaleLowerCase()));
  const price = (amount: number, currency: string) => {
    try { return new Intl.NumberFormat("es-AR", { style: "currency", currency }).format(amount); }
    catch { return `${amount} ${currency}`; }
  };
  return <>
    <div className="toolbar"><label>Buscar por título o ID<input value={filter} onChange={(event) => setFilter(event.target.value)} /></label>
      <button className="primary" disabled={!token || busy} onClick={() => void request(true)}>{busy ? "Consultando…" : items.length ? "Actualizar publicaciones" : "Importar publicaciones"}</button>
    </div>
    <p className="table-note">Las publicaciones se guardan en tu cuenta. Cada ID aparece una sola vez: solo se agregan las nuevas y se actualizan los datos que cambiaron. Los precios son de venta, no costos del proveedor.</p>
    {!token && <p className="warning">Iniciá sesión y conectá Mercado Libre para importar tus publicaciones.</p>}
    {message && <p className="notice" role="status">{message}</p>}
    <section className="panel"><div className="panel-title"><h2>Mis publicaciones</h2><span className="pill">{items.length} guardadas</span></div>
      <div className="table-wrap"><table><thead><tr><th>PUBLICACIÓN</th><th>PRECIO DE VENTA</th><th>STOCK</th><th>ESTADO</th></tr></thead><tbody>
        {visible.map((item) => <tr key={item.id}><td><strong>{item.title}</strong><p>{item.id}</p>
          {!!item.variations.length && <details><summary>{item.variations.length} variantes</summary>{item.variations.map((v) => <p key={v.id}>{v.attribute_combinations.map((a) => a.value_name).filter(Boolean).join(" / ") || v.id} · {price(v.price, item.currency_id)} · Stock: {v.available_quantity}</p>)}</details>}
        </td><td>{price(item.price, item.currency_id)} <small>{item.currency_id}</small></td><td>{item.available_quantity}</td><td><span className={`dispatch-status ${item.status === "active" ? "success" : item.status === "paused" ? "warning" : "neutral"}`}>{statuses[item.status] ?? "Otro estado"}</span></td></tr>)}
      </tbody></table></div>
      {!visible.length && !busy && <div className="empty">{items.length ? "No hay coincidencias." : "Todavía no hay publicaciones guardadas. Usá Importar publicaciones para comenzar."}</div>}
    </section>
  </>;
}
