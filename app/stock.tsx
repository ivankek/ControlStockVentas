"use client";
import { useState } from "react";
import { canManageSupplier, desiredListingQuantity, sellableStock, type StockVariant } from "@/lib/inventory";
import { useInventory } from "./inventory-context";

export default function Stock() {
  const { data, command } = useInventory();
  const [filter, setFilter] = useState("");
  const [busy, setBusy] = useState(false), [message, setMessage] = useState("");
  async function run(action?: unknown) { setBusy(true); setMessage(""); try { await command(action); setMessage(action ? "Ajuste registrado con su movimiento." : "Stock actualizado."); } catch (e) { setMessage((e as Error).message); } finally { setBusy(false); } }
  if (!data) return <p className="notice">Iniciá sesión para consultar stock.</p>;
  const person = (id: string) => data.people.find((p) => p.id === id)?.display_name ?? id;
  const variants = data.variants.filter((v) => `${v.product_name} ${v.name} ${v.sku ?? ""} ${person(v.supplier_id)}`.toLocaleLowerCase().includes(filter.toLocaleLowerCase()));
  return <div className="inventory-view">
    <p className="notice">Inventario interno. Los ajustes y las cantidades deseadas no modifican Mercado Libre. Las ventas todavía no descuentan stock.</p>
    <div className="toolbar"><label>Buscar producto, SKU o proveedor<input value={filter} onChange={(e) => setFilter(e.target.value)} /></label><button disabled={busy} onClick={() => void run()}>Actualizar stock</button></div>
    {message && <p className="notice" role="status">{message}</p>}
    {variants.map((v) => <section className="panel stock-card" key={v.id}><h2>{v.product_name}{v.name !== "Única" ? ` · ${v.name}` : ""}</h2><p>Proveedor: {person(v.supplier_id)}{v.sku ? ` · SKU: ${v.sku}` : ""}</p>
      <dl className="stock-values">{[["Físico", v.physical_stock], ["Reservado", v.reserved_stock], ["Seguridad", v.safety_stock], ["Vendible", sellableStock(v.physical_stock, v.reserved_stock, v.safety_stock)]].map(([name, value]) => <div key={name}><dt>{name}</dt><dd>{value}</dd></div>)}</dl>
      {canManageSupplier(data.profile, v.supplier_id) && <Adjustment key={`${v.id}-${v.version}`} variant={v} busy={busy} save={run} />}
      <details><summary>Publicaciones asociadas ({data.mappings.filter((m) => m.variant_id === v.id).length})</summary>
        {data.mappings.filter((m) => m.variant_id === v.id).map((m) => <div className="stock-association" key={`${m.account_id}:${m.item_id}:${m.variation_id}`}>
          <strong>{m.title}</strong><p>{person(m.owner_id)} · {m.nickname ?? "Cuenta ML"} · Seller {m.seller_id}</p><p>{m.item_id}{m.variation_id !== "0" ? ` / variante ${m.variation_id}` : ""}{m.user_product_id ? ` · UP ${m.user_product_id}` : ""}</p>
          <p>Stock ML: {m.ml_quantity ?? "No disponible"} · {m.units_per_sale} unidades por venta · {m.mode}{m.mode === "FIXED" ? ` (${m.fixed_quantity})` : ""} · <strong>Deseado: {desiredListingQuantity({ mode: m.mode, sellableStock: sellableStock(v.physical_stock, v.reserved_stock, v.safety_stock), fixedQuantity: m.fixed_quantity })}</strong></p>
          <small>La política se configura en Publicaciones de la cuenta correspondiente.</small>
        </div>)}
      </details>
      {canManageSupplier(data.profile, v.supplier_id) && <details><summary>Movimientos recientes</summary>{data.movements.filter((m) => m.variant_id === v.id).map((m) => <div className="stock-association" key={m.id}><strong>{({ MANUAL_ADJUSTMENT: "Ajuste manual", RESTOCK: "Reposición", CORRECTION: "Corrección" } as Record<string, string>)[m.type] ?? m.type} · {m.stock_before} → {m.stock_after}</strong><p>Reserva: {m.reserved_before} → {m.reserved_after} · Seguridad: {m.safety_before} → {m.safety_after}</p><p>{m.note}</p><small>{new Date(m.created_at).toLocaleString("es-AR")} · {person(m.actor_id)} · {m.source}</small></div>)}</details>}
    </section>)}
    {!variants.length && <p className="empty">No hay productos visibles. El administrador debe asignar el catálogo y habilitar la relación con el proveedor.</p>}
    <p className="table-note">Vendible = máximo de físico − reservado − seguridad y cero. REAL informa el vendible; FIXED muestra la cantidad configurada mientras haya vendible. No se divide por unidades por venta: esa será una decisión antes de activar sincronización de packs.</p>
  </div>;
}
function Adjustment({ variant: v, busy, save }: { variant: StockVariant; busy: boolean; save: (a: unknown) => Promise<void> }) {
  const [requestId] = useState(() => crypto.randomUUID());
  return <details><summary>Ajustar stock</summary><form className="inventory-form" onSubmit={(e) => {
    e.preventDefault(); const f = new FormData(e.currentTarget);
    void save({ type: "adjust", variantId: v.id, delta: Number(f.get("delta")), reserved: Number(f.get("reserved")), safety: Number(f.get("safety")), expectedVersion: v.version, movementType: f.get("type"), note: f.get("note"), requestId });
  }}><label>Tipo<select name="type"><option value="MANUAL_ADJUSTMENT">Ajuste manual</option><option value="RESTOCK">Reposición</option><option value="CORRECTION">Corrección</option></select></label>
    <label>Unidades a sumar o restar<input name="delta" type="number" step={1} min={-1000000000} max={1000000000} defaultValue={0} required /></label>
    <label>Reserva total<input name="reserved" type="number" min={0} step={1} max={1000000000} defaultValue={v.reserved_stock} required /></label>
    <label>Stock de seguridad<input name="safety" type="number" min={0} step={1} max={1000000000} defaultValue={v.safety_stock} required /></label>
    <label>Motivo<input name="note" required maxLength={500} /></label><button disabled={busy} className="primary">Registrar ajuste</button>
  </form></details>;
}
