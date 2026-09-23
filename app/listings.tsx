"use client";
import { useEffect, useRef, useState } from "react";
import type { Listing } from "@/lib/listings";
import type { Product, State } from "@/lib/domain";
import { listingGroups, listingKey } from "@/lib/supplier";
import ListingBinding from "./listing-binding";
import { useAccountPath, useInventory } from "./inventory-context";
import { installmentLabel } from "@/lib/sale-option";
import { listingView, type AssociationFilter, type ListingSort } from "@/lib/listing-view";
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
  const path = useAccountPath();
  const { account, data: inventory } = useInventory();
  const [items, setItems] = useState<Listing[]>([]);
  const [products, setProducts] = useState<Product[]>([]);
  const [links, setLinks] = useState<NonNullable<State["supplierLinks"]>>({});
  const [busy, setBusy] = useState(false);
  const [message, setMessage] = useState("");
  const [filter, setFilter] = useState("");
  const [association, setAssociation] = useState<AssociationFilter>("all");
  const [sort, setSort] = useState<ListingSort>("original");
  const active = useRef<AbortController | null>(null);
  useEffect(() => { setItems([]); setMessage(""); if (token) void request(false); return () => active.current?.abort(); }, [token, account]);
  async function request(update: boolean) {
    if (!token) return;
    active.current?.abort();
    const controller = new AbortController(); active.current = controller;
    setBusy(true); setMessage("");
    try {
      const response = await fetch(path("/api/listings"), { method: update ? "POST" : "GET", headers: { Authorization: `Bearer ${token}` }, signal: controller.signal, cache: "no-store" });
      const data = await response.json();
      if (!response.ok) throw Error(data.error || "No se pudieron consultar las publicaciones.");
      if (controller.signal.aborted) return;
      setItems(data.listings);
      setProducts(data.products ?? []); setLinks(data.links ?? {});
      if (update) setMessage(`${data.added} nuevas · ${data.updated} actualizadas · ${data.unchanged} sin cambios.`);
    } catch (error) { if (!controller.signal.aborted) setMessage(error instanceof Error ? error.message : "No se pudo completar la operación."); }
    finally { if (!controller.signal.aborted) setBusy(false); }
  }
  const visible = listingView(items, inventory?.mappings ?? [], inventory?.variants ?? [], account, filter, association, sort);
  const price = (amount: number, currency: string) => {
    try { return new Intl.NumberFormat("es-AR", { style: "currency", currency }).format(amount); }
    catch { return `${amount} ${currency}`; }
  };
  return <>
    <div className="toolbar"><label>Buscar por título o ID<input value={filter} onChange={(event) => setFilter(event.target.value)} /></label>
      <label>Asociación<select value={association} onChange={(e) => setAssociation(e.target.value as AssociationFilter)}><option value="all">Todas</option><option value="none">Sin asociar</option><option value="partial">Parcialmente asociadas</option><option value="complete">Asociadas</option></select></label>
      <label>Ordenar<select value={sort} onChange={(e) => setSort(e.target.value as ListingSort)}><option value="original">Orden original</option><option value="unlinked">Sin asociar primero</option><option value="title">Título A–Z</option><option value="title-desc">Título Z–A</option><option value="stock">Menor stock primero</option><option value="stock-desc">Mayor stock primero</option><option value="price">Menor precio primero</option><option value="price-desc">Mayor precio primero</option></select></label>
      <button className="primary" disabled={!token || !account || busy} onClick={() => void request(true)}>{busy ? "Consultando…" : items.length ? "Actualizar publicaciones" : "Importar publicaciones"}</button>
    </div>
    <p className="table-note">Las publicaciones se guardan en tu cuenta. Cada ID aparece una sola vez: solo se agregan las nuevas y se actualizan los datos que cambiaron. Los precios son de venta, no costos del proveedor.</p>
    {!token && <p className="warning">Iniciá sesión y conectá Mercado Libre para importar tus publicaciones.</p>}
    {message && <p className="notice" role="status">{message}</p>}
    <section className="panel"><div className="panel-title"><h2>Mis publicaciones</h2><span className="pill">{items.length} guardadas</span></div>
      <p className="table-note">Agrupadas por producto de Mercado Libre o nombre exacto y variantes iguales. Una asociación aplica a todas las opciones del grupo. Actualizá para consultar cuotas y envío gratis. No se suma el stock compartido.</p>
      <p className="table-note">{visible.length} grupos visibles. El orden por stock o precio usa el menor valor de las opciones del grupo.</p>
      {visible.map((group) => <details className="listing-group" key={group.id}><summary><strong>{group.title}</strong> · {group.options.length} opciones de venta <span className="pill listing-stock">Stock: {[...new Set(group.options.map((item) => item.available_quantity))].join(" / ")}{new Set(group.options.map((item) => item.available_quantity)).size > 1 ? " según opción" : ""}</span><span className={`listing-association association-${group.association}`}>{!inventory ? "Consultando asociación…" : group.association === "none" ? "Sin producto asociado" : `${group.association === "partial" ? "Asociación parcial" : "Asociada"} · ${group.products.join(" · ")}`}</span></summary>
        {(() => {
          const physical = new Map<string, { label: string; keys: string[] }>();
          for (const item of group.options) {
            if (!item.variations.length) { const entry = physical.get("default") ?? { label: "", keys: [] }; entry.keys.push(`${item.id}:0`); physical.set("default", entry); }
            for (const v of item.variations) {
              const signature = JSON.stringify(v.attribute_combinations);
              const entry = physical.get(signature) ?? { label: v.attribute_combinations.map((a) => a.value_name).filter(Boolean).join(" / ") || v.id, keys: [] };
              entry.keys.push(`${item.id}:${v.id}`); physical.set(signature, entry);
            }
          }
          return [...physical].map(([key, entry]) => <div key={key}>{entry.label && <p className="table-note">Variante: {entry.label}</p>}<ListingBinding keys={entry.keys} /></div>);
        })()}
        {group.options.map((item, index) => <div className="pending-row" key={item.id}><div className="order-text"><strong>Opción {index + 1} · {price(item.price, item.currency_id)}</strong><p>{item.id}</p>
          <p>{price(item.price, item.currency_id)} · {statuses[item.status] ?? "Otro estado"}</p>
          <p>{installmentLabel(item)}{item.shipping?.free_shipping === true ? " · Envío gratis" : item.shipping?.free_shipping === false ? " · Sin envío gratis" : ""}</p>
          {!item.variations.length && <ListingBinding keys={[`${item.id}:0`]} policyOnly />}
          {item.variations.map((v) => <div key={v.id}><p>{v.attribute_combinations.map((a) => a.value_name).filter(Boolean).join(" / ") || v.id} · {price(v.price, item.currency_id)} · Stock: {v.available_quantity}</p><ListingBinding keys={[`${item.id}:${v.id}`]} policyOnly /></div>)}
        </div></div>)}
      </details>)}
      {!visible.length && !busy && <div className="empty">{items.length ? "No hay coincidencias." : "Todavía no hay publicaciones guardadas. Usá Importar publicaciones para comenzar."}</div>}
    </section>
  </>;
}
