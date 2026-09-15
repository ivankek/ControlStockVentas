"use client";
import { useEffect, useRef, useState } from "react";
import type { Listing } from "@/lib/listings";
import type { Product, State } from "@/lib/domain";
import { listingGroups, listingKey } from "@/lib/supplier";
import { installmentLabel } from "@/lib/sale-option";
function UnitsField({ initial }: { initial: number }) {
  const [editing, setEditing] = useState(false);
  const [units, setUnits] = useState(String(initial));
  return <div className="units-control"><span>Unidades por venta: <strong>{units || "—"}</strong></span>
    <button type="button" className="units-toggle" aria-expanded={editing} onClick={() => setEditing(!editing)}>{editing ? "Ocultar" : "Cambiar"}</button>
    <input name="units" type={editing ? "number" : "hidden"} aria-label="Unidades del proveedor por venta" min={1} max={10000} step={1} required value={units} onChange={(e) => setUnits(e.target.value)} />
    {editing && <small>Dejá 1 salvo que cada venta incluya varias unidades del producto del proveedor.</small>}
  </div>;
}
const statuses: Record<string, string> = { active: "Activa", paused: "Pausada", closed: "Finalizada", under_review: "En revisión", inactive: "Inactiva", payment_required: "Pago pendiente", not_yet_active: "Pendiente de activación" };
export default function Listings({ token }: { token?: string }) {
  const [items, setItems] = useState<Listing[]>([]);
  const [products, setProducts] = useState<Product[]>([]);
  const [links, setLinks] = useState<NonNullable<State["supplierLinks"]>>({});
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
      setProducts(data.products ?? []); setLinks(data.links ?? {});
      if (update) setMessage(`${data.added} nuevas · ${data.updated} actualizadas · ${data.unchanged} sin cambios.`);
    } catch (error) { if (!controller.signal.aborted) setMessage(error instanceof Error ? error.message : "No se pudo completar la operación."); }
    finally { if (!controller.signal.aborted) setBusy(false); }
  }
  const visible = listingGroups(items, links).filter((group) => group.options.some((item) => `${item.id} ${item.title}`.toLocaleLowerCase().includes(filter.toLocaleLowerCase())));
  async function associate(keys: string[], supplierId: string, units: number) {
    if (!token) return;
    active.current?.abort(); const controller = new AbortController(); active.current = controller;
    setBusy(true); setMessage("");
    try {
      const res = await fetch("/api/suppliers", { method: "POST", headers: { Authorization: `Bearer ${token}`, "Content-Type": "application/json" }, body: JSON.stringify({ type: "link", keys, supplierId: supplierId || null, units }), signal: controller.signal });
      const data = await res.json(); if (!res.ok) throw Error(data.error || "No se pudo asociar.");
      if (!controller.signal.aborted) { setLinks(data.links); setProducts(data.products); setMessage("Asociación guardada. Volvé a consultar Despachos para calcular el costo."); }
    } catch (e) { if (!controller.signal.aborted) setMessage((e as Error).message); }
    finally { if (!controller.signal.aborted) setBusy(false); }
  }
  function binding(keys: string[]) {
    const current = links[keys[0]];
    const mixed = keys.some((key) => links[key]?.supplierId !== current?.supplierId || links[key]?.units !== current?.units);
    return <form className="supplier-binding" key={`${keys.join()}-${JSON.stringify(keys.map((key) => links[key]))}`} onSubmit={(e) => {
      e.preventDefault(); const data = new FormData(e.currentTarget);
      void associate(keys, String(data.get("supplier")), Number(data.get("units")));
    }}><label>Producto del proveedor<select name="supplier" defaultValue={mixed ? "" : current?.supplierId ?? ""} disabled={busy}>
      <option value="">Sin asociación</option>{products.map((p) => <option value={p.id} key={p.id}>{p.name}</option>)}
    </select></label><UnitsField initial={mixed ? 1 : current?.units ?? 1} />
      <button disabled={busy || !token}>Guardar asociación</button>{mixed && <small>Hay asociaciones diferentes. Guardar aplica la selección a todas estas opciones.</small>}
    </form>;
  }
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
      <p className="table-note">Agrupadas por producto de Mercado Libre o nombre exacto y variantes iguales. Una asociación aplica a todas las opciones del grupo. Actualizá para consultar cuotas y envío gratis. No se suma el stock compartido.</p>
      {visible.map((group) => <details className="listing-group" key={group.id}><summary><strong>{group.title}</strong> · {group.options.length} opciones de venta</summary>
        {binding([...new Set(group.options.flatMap((item) => item.variations.length ? item.variations.map((v) => `${item.id}:${v.id}`) : [listingKey(item), `${item.id}:0`]))])}
        {group.options.map((item, index) => <div className="pending-row" key={item.id}><div className="order-text"><strong>Opción {index + 1} · {price(item.price, item.currency_id)}</strong><p>{item.id}</p>
          <p>{price(item.price, item.currency_id)} · Stock: {item.available_quantity} · {statuses[item.status] ?? "Otro estado"}</p>
          <p>{installmentLabel(item)} · {item.shipping?.free_shipping === true ? "Envío gratis" : item.shipping?.free_shipping === false ? "Sin envío gratis" : "Envío gratis: no informado"}</p>
          {item.variations.map((v) => <div key={v.id}><p>{v.attribute_combinations.map((a) => a.value_name).filter(Boolean).join(" / ") || v.id} · {price(v.price, item.currency_id)} · Stock: {v.available_quantity}</p></div>)}
        </div></div>)}
      </details>)}
      {!visible.length && !busy && <div className="empty">{items.length ? "No hay coincidencias." : "Todavía no hay publicaciones guardadas. Usá Importar publicaciones para comenzar."}</div>}
    </section>
  </>;
}
