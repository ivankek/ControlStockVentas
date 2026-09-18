"use client";
import { useState } from "react";
import { costAt, money, today } from "@/lib/domain";
import { canManageSupplier, type StockVariant } from "@/lib/inventory";
import { useInventory } from "./inventory-context";
export default function Suppliers() {
  const { data, command } = useInventory();
  const [editing, setEditing] = useState<StockVariant>();
  const [busy, setBusy] = useState(false), [message, setMessage] = useState("");
  if (!data) return <p className="notice">Iniciá sesión para consultar productos y costos.</p>;
  const allowed = data.people.filter((p) => p.role === "SUPPLIER" && canManageSupplier(data.profile, p.id));
  const person = (id: string) => data.people.find((p) => p.id === id)?.display_name ?? id;
  return <div className="inventory-view">
    <p className="table-note">El proveedor administra sus productos, costos y stock. Cada producto se identifica con un SKU obligatorio.</p>
    {data.legacy.some((l) => !l.assigned_supplier_id) && <p className="warning">Hay un catálogo anterior pendiente de asignación. El administrador debe asignarlo a un SUPPLIER desde Usuarios. Sus costos siguen disponibles para las consultas anteriores.</p>}
    {message && <p className="notice" role="status">{message}</p>}
    {!!allowed.length && <form key={editing?.id ?? "new"} className="panel stock-card inventory-form" onSubmit={async (e) => {
      e.preventDefault(); const f = new FormData(e.currentTarget); setBusy(true); setMessage("");
      try {
        await command({ type: "product", supplierId: f.get("supplier"), productId: editing?.product_id, variantId: editing?.id, name: f.get("name"), variantName: editing?.name ?? "Única", sku: f.get("sku"), date: f.get("date"), cents: Math.round(Number(f.get("cost")) * 100) });
        setEditing(undefined); setMessage("Producto y costo guardados.");
      } catch (e) { setMessage((e as Error).message); } finally { setBusy(false); }
    }}>
      <h2>{editing ? "Editar producto y costo" : "Nuevo producto"}</h2>
      <label>Proveedor<select name="supplier" required defaultValue={editing?.supplier_id ?? (allowed.length === 1 ? allowed[0].id : "")}><option value="">Seleccionar</option>{allowed.map((p) => <option value={p.id} key={p.id}>{p.display_name}</option>)}</select></label>
      <label>Producto<input name="name" maxLength={200} defaultValue={editing?.product_name} required /></label>
      <label>SKU<input name="sku" maxLength={100} defaultValue={editing?.sku ?? ""} required placeholder="Ej.: BANDEJA-001" /><small>El SKU identifica el producto y es obligatorio.</small></label>
      <label>Costo unitario ARS<input name="cost" type="number" min={0} max={1000000000} step="0.01" required defaultValue={editing ? (costAt({ ...editing, name: editing.product_name }, today()) ?? 0) / 100 : undefined} /></label>
      <label>Vigente desde<input name="date" type="date" required defaultValue={today()} /></label>
      <button className="primary" disabled={busy}>Guardar producto y costo</button>{editing && <button type="button" onClick={() => setEditing(undefined)}>Cancelar edición</button>}
    </form>}
    <section className="panel"><div className="panel-title"><h2>Productos del proveedor</h2><span>{data.variants.length} productos</span></div>
      {data.variants.map((v) => <div className="pending-row" key={v.id}><div className="order-text"><strong>{v.product_name}</strong><p>{person(v.supplier_id)} · SKU: {v.sku ?? "Sin SKU"}</p><p>Costo vigente: {costAt(v, today()) === undefined ? "Sin costo" : money(costAt(v, today())!)}</p><details><summary>Historial de costos</summary>{v.costs.map((c) => <p key={c.from}>{c.from} · {money(c.cents)}</p>)}</details></div>
        {canManageSupplier(data.profile, v.supplier_id) && <div className="inventory-inline"><button onClick={() => { setEditing(v); document.querySelector(".content")?.scrollTo({ top: 0 }); }}>Editar producto / costo</button></div>}
      </div>)}
      {!data.variants.length && <p className="empty">Todavía no hay productos autorizados.</p>}
    </section>
  </div>;
}
