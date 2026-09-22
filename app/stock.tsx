"use client";
import { useEffect, useState } from "react";
import { canManageSupplier, type StockMapping, type StockVariant } from "@/lib/inventory";
import { costAt, money, today } from "@/lib/domain";
import ProductEditor from "./product-editor";
import { useInventory } from "./inventory-context";

export default function Stock() {
  const { data, command } = useInventory();
  const [filter, setFilter] = useState("");
  const [busy, setBusy] = useState(false), [message, setMessage] = useState("");
  const [expanded, setExpanded] = useState<string | null>(null);
  const [editing, setEditing] = useState<StockVariant | "new" | null>(null);
  async function refresh() { setBusy(true); setMessage(""); try { await command(); setMessage("Stock actualizado."); } catch (e) { setMessage((e as Error).message); } finally { setBusy(false); } }
  async function save(v: StockVariant, physical: number) {
    setBusy(true); setMessage("");
    try {
      await command({ type: "adjust", variantId: v.id, delta: physical - v.stock, expectedVersion: v.version, movementType: "CORRECTION", note: "Actualización de stock", requestId: crypto.randomUUID() });
      setMessage(`Stock de ${v.product_name} actualizado.`);
    } catch (e) { setMessage((e as Error).message); } finally { setBusy(false); }
  }
  if (!data) return <p className="notice">Iniciá sesión para consultar stock.</p>;
  const person = (id: string) => data.people.find((p) => p.id === id)?.display_name ?? id;
  const variants = data.variants.filter((v) => `${v.product_name} ${v.sku ?? ""} ${person(v.supplier_id)}`.toLocaleLowerCase().includes(filter.toLocaleLowerCase()));
  return <div className="inventory-view">
    <p className="notice">{data.profile.role === "USER" ? "Consultá los productos de tus proveedores. Para vincularlos con tus publicaciones, ingresá a Publicaciones." : "Creá tus productos con SKU, precio y stock. Podés modificar el stock directamente en la grilla."}</p>
    <div className="toolbar stock-toolbar"><label>Buscar producto, SKU o proveedor<input value={filter} onChange={(e) => setFilter(e.target.value)} /></label><button disabled={busy} onClick={() => void refresh()}>Actualizar stock</button>{data.profile.role !== "USER" && <button className="primary" disabled={busy || editing !== null} onClick={() => setEditing("new")}>Nuevo producto</button>}</div>
    {message && <p className="notice" role="status">{message}</p>}
    {editing && <ProductEditor key={editing === "new" ? "new" : editing.id} editing={editing === "new" ? undefined : editing} onClose={() => setEditing(null)} />}
    <section className="panel stock-grid-panel">
      <div className="panel-title"><h2>Stock de productos</h2><span>{variants.length} productos</span></div>
      <div className="table-wrap"><table className="stock-grid"><thead><tr><th>Producto</th><th>SKU</th><th>Precio unitario</th><th>Stock</th><th>Acciones</th></tr></thead><tbody>
        {variants.map((v) => <StockRow key={`${v.id}:${v.version}`} variant={v} supplier={person(v.supplier_id)} mappings={data.mappings.filter((m) => m.variant_id === v.id)} expanded={expanded === v.id} busy={busy || editing !== null} canEdit={canManageSupplier(data.profile, v.supplier_id)} onEdit={() => { setEditing(v); document.querySelector(".content")?.scrollTo({ top: 0 }); }} onToggle={() => setExpanded(expanded === v.id ? null : v.id)} onSave={save} />)}
      </tbody></table></div>
      {!variants.length && <p className="empty">{filter ? "No hay productos que coincidan con la búsqueda." : data.profile.role === "USER" ? "Tu proveedor debe cargar sus productos y el administrador debe habilitar tu relación con él." : "Agregá el primer producto para comenzar."}</p>}
    </section>
  </div>;
}
function StockRow({ variant: v, supplier, mappings, expanded, busy, canEdit, onEdit, onToggle, onSave }: { variant: StockVariant; supplier: string; mappings: StockMapping[]; expanded: boolean; busy: boolean; canEdit: boolean; onEdit: () => void; onToggle: () => void; onSave: (v: StockVariant, physical: number) => Promise<void> }) {
  const [physical, setPhysical] = useState(String(v.stock));
  useEffect(() => setPhysical(String(v.stock)), [v.stock, v.version]);
  const amount = Number(physical);
  const changed = physical !== "" && Number.isInteger(amount) && amount >= 0 && amount <= 1000000000 && amount !== v.stock;
  const price = costAt(v, today());
  const mainMappings = primaryMappings(mappings);
  return <>
    <tr>
      <td className="stock-product"><strong>{v.product_name}</strong><small>{supplier}</small></td>
      <td className="stock-sku" title={v.sku ?? ""}><code>{v.sku}</code></td>
      <td>{price === undefined ? "Sin precio vigente" : money(price)}</td>
      <td>{canEdit ? <input disabled={busy} className="stock-number" aria-label={`Stock de ${v.product_name}`} type="number" min={0} max={1000000000} step={1} value={physical} onChange={(e) => setPhysical(e.target.value)} /> : v.stock}</td>
      <td><div className="stock-actions">{canEdit && <><button className="primary stock-save" disabled={busy || !changed} onClick={() => void onSave(v, amount)}>Guardar stock</button><button disabled={busy} onClick={onEdit}>Editar</button></>}<button onClick={onToggle}>{expanded ? "Ocultar" : "Publicaciones"} ({mainMappings.length})</button></div></td>
    </tr>
    {expanded && <tr className="stock-expanded"><td colSpan={5}><strong>Publicaciones principales asociadas</strong>{mainMappings.length ? mainMappings.map((m) => <div className="stock-association" key={`${m.account_id}:${m.item_id}`}><strong>{m.title}</strong><span>{m.item_id}</span><small>{m.nickname ?? "Cuenta ML"} · Stock ML: {m.ml_quantity ?? "No disponible"} · Deseado: {v.stock}</small></div>) : <p className="table-note">No hay publicaciones asociadas.</p>}<details><summary>Historial de precios</summary>{v.costs.map((c) => <p key={c.from}>{c.from} · {money(c.cents)}</p>)}</details></td></tr>}
  </>;
}

function primaryMappings(mappings: StockMapping[]) {
  const byItem = new Map<string, StockMapping>();
  for (const mapping of mappings) {
    // Mercado Libre puede representar las opciones comerciales como varios item_id.
    // user_product_id identifica el producto principal; si falta, el stock asociado
    // funciona como respaldo para no repetir todas las opciones en esta vista.
    const key = `${mapping.account_id}:${mapping.user_product_id ? `up:${mapping.user_product_id}` : `variant:${mapping.variant_id}`}`;
    const current = byItem.get(key);
    if (!current || mapping.variation_id === "0") byItem.set(key, mapping);
  }
  return [...byItem.values()];
}
