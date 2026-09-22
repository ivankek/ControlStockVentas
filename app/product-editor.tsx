"use client";
import { useState } from "react";
import { costAt, today } from "@/lib/domain";
import { canManageSupplier, type StockVariant } from "@/lib/inventory";
import { useInventory } from "./inventory-context";

export default function ProductEditor({ editing, onClose }: { editing?: StockVariant; onClose: () => void }) {
  const { data, command } = useInventory();
  const [busy, setBusy] = useState(false), [message, setMessage] = useState("");
  if (!data) return null;
  const allowed = data.people.filter((p) => p.role === "SUPPLIER" && canManageSupplier(data.profile, p.id));
  if (data.profile.role === "USER" || (editing && !canManageSupplier(data.profile, editing.supplier_id))) return null;
  if (!allowed.length) return <p className="notice">Primero creá un usuario proveedor y asignale el rol SUPPLIER desde Usuarios. <button onClick={onClose}>Cerrar</button></p>;
  return <form className="panel stock-card inventory-form" onSubmit={async (e) => {
    e.preventDefault(); const f = new FormData(e.currentTarget); setBusy(true); setMessage("");
    try {
      await command({ type: "product", supplierId: editing?.supplier_id ?? (data.profile.role === "SUPPLIER" ? data.profile.id : f.get("supplier")), productId: editing?.product_id, variantId: editing?.id, expectedVersion: editing?.version, name: f.get("name"), sku: f.get("sku"), date: f.get("date"), cents: Math.round(Number(f.get("cost")) * 100), stock: Number(f.get("stock")) });
      onClose();
    } catch (e) { setMessage((e as Error).message); } finally { setBusy(false); }
  }}>
    <h2>{editing ? "Editar producto" : "Nuevo producto"}</h2>
    {data.profile.role === "ADMIN" && !editing && <label>Proveedor<select name="supplier" required defaultValue=""><option value="">Seleccionar</option>{allowed.map((p) => <option value={p.id} key={p.id}>{p.display_name}</option>)}</select></label>}
    <label>Producto<input name="name" maxLength={200} defaultValue={editing?.product_name} required /></label>
    <label>SKU<input name="sku" maxLength={100} defaultValue={editing?.sku ?? ""} required placeholder="Ej.: BANDEJA-001" /></label>
    <label>Precio unitario ARS<input name="cost" type="number" min={0} max={1000000000} step="0.01" required defaultValue={editing ? (costAt(editing, today()) ?? 0) / 100 : undefined} /></label>
    <label>Stock<input name="stock" type="number" min={0} max={1000000000} step={1} required defaultValue={editing?.stock ?? 0} /></label>
    <label>Precio vigente desde<input name="date" type="date" required defaultValue={today()} /><small>Se conserva el historial de precios para calcular ventas anteriores.</small></label>
    {message && <p className="warning" role="alert">{message}</p>}
    <button className="primary" disabled={busy}>Guardar producto</button><button type="button" disabled={busy} onClick={onClose}>Cancelar</button>
  </form>;
}
