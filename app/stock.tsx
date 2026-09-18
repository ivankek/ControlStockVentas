"use client";
import { useEffect, useState } from "react";
import { canManageSupplier, desiredListingQuantity, sellableStock, type StockMapping, type StockVariant } from "@/lib/inventory";
import { useInventory } from "./inventory-context";

export default function Stock() {
  const { data, command } = useInventory();
  const [filter, setFilter] = useState("");
  const [busy, setBusy] = useState(false), [message, setMessage] = useState("");
  const [expanded, setExpanded] = useState<string | null>(null);
  async function refresh() { setBusy(true); setMessage(""); try { await command(); setMessage("Stock actualizado."); } catch (e) { setMessage((e as Error).message); } finally { setBusy(false); } }
  async function save(v: StockVariant, physical: number) {
    setBusy(true); setMessage("");
    try {
      await command({ type: "adjust", variantId: v.id, delta: physical - v.physical_stock, reserved: v.reserved_stock, expectedVersion: v.version, movementType: "CORRECTION", note: "Actualización manual del stock físico", requestId: crypto.randomUUID() });
      setMessage(`Stock de ${v.product_name} actualizado.`);
    } catch (e) { setMessage((e as Error).message); } finally { setBusy(false); }
  }
  if (!data) return <p className="notice">Iniciá sesión para consultar stock.</p>;
  const person = (id: string) => data.people.find((p) => p.id === id)?.display_name ?? id;
  const variants = data.variants.filter((v) => `${v.product_name} ${v.sku ?? ""} ${person(v.supplier_id)}`.toLocaleLowerCase().includes(filter.toLocaleLowerCase()));
  return <div className="inventory-view">
    <p className="notice">Modificá directamente el stock físico. El stock disponible se calcula descontando las unidades en reserva.</p>
    <div className="toolbar stock-toolbar"><label>Buscar producto, SKU o proveedor<input value={filter} onChange={(e) => setFilter(e.target.value)} /></label><button disabled={busy} onClick={() => void refresh()}>Actualizar stock</button></div>
    {message && <p className="notice" role="status">{message}</p>}
    <section className="panel stock-grid-panel">
      <div className="panel-title"><h2>Stock de productos</h2><span>{variants.length} productos</span></div>
      <div className="table-wrap"><table className="stock-grid"><thead><tr><th>Producto</th><th>SKU</th><th>Stock</th><th>Stock en reserva</th><th>Acciones</th></tr></thead><tbody>
        {variants.map((v) => <StockRow key={`${v.id}:${v.version}`} variant={v} supplier={person(v.supplier_id)} mappings={data.mappings.filter((m) => m.variant_id === v.id)} expanded={expanded === v.id} busy={busy} canEdit={canManageSupplier(data.profile, v.supplier_id)} onToggle={() => setExpanded(expanded === v.id ? null : v.id)} onSave={save} />)}
      </tbody></table></div>
      {!variants.length && <p className="empty">No hay productos visibles. El administrador debe asignar el catálogo y habilitar la relación con el proveedor.</p>}
    </section>
  </div>;
}
function StockRow({ variant: v, supplier, mappings, expanded, busy, canEdit, onToggle, onSave }: { variant: StockVariant; supplier: string; mappings: StockMapping[]; expanded: boolean; busy: boolean; canEdit: boolean; onToggle: () => void; onSave: (v: StockVariant, physical: number) => Promise<void> }) {
  const [physical, setPhysical] = useState(v.physical_stock);
  useEffect(() => setPhysical(v.physical_stock), [v.physical_stock, v.version]);
  const changed = physical !== v.physical_stock;
  const mainMappings = primaryMappings(mappings);
  return <>
    <tr>
      <td className="stock-product"><strong>{v.product_name}</strong><small>{supplier}</small></td>
      <td className="stock-sku" title={v.sku ?? ""}><code>{v.sku}</code></td>
      <td>{canEdit ? <input className="stock-number" aria-label={`Stock de ${v.product_name}`} type="number" min={0} max={1000000000} step={1} value={physical} onChange={(e) => setPhysical(Math.max(0, Number(e.target.value)))} /> : v.physical_stock}</td>
      <td>{v.reserved_stock}</td>
      <td><div className="stock-actions">{canEdit && <button className="primary stock-save" disabled={busy || !changed} onClick={() => void onSave(v, physical)}>Guardar</button>}<button onClick={onToggle}>{expanded ? "Ocultar" : "Publicaciones"} ({mainMappings.length})</button></div></td>
    </tr>
    {expanded && <tr className="stock-expanded"><td colSpan={5}><strong>Publicación principal asociada</strong>{mappings.length ? primaryMappings(mappings).map((m) => <div className="stock-association" key={`${m.account_id}:${m.item_id}`}><strong>{m.title}</strong><span>{m.item_id}</span><small>{m.nickname ?? "Cuenta ML"} · Stock ML: {m.ml_quantity ?? "No disponible"} · Deseado: {desiredListingQuantity({ mode: m.mode, sellableStock: sellableStock(v.physical_stock, v.reserved_stock), fixedQuantity: m.fixed_quantity })}</small></div>) : <p className="table-note">No hay publicaciones asociadas.</p>}</td></tr>}
  </>;
}

function primaryMappings(mappings: StockMapping[]) {
  const byItem = new Map<string, StockMapping>();
  for (const mapping of mappings) {
    const current = byItem.get(mapping.item_id);
    if (!current || mapping.variation_id === "0") byItem.set(mapping.item_id, mapping);
  }
  return [...byItem.values()];
}
