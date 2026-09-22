"use client";
import { useState } from "react";
import { desiredListingQuantity } from "@/lib/inventory";
import { useInventory } from "./inventory-context";
export default function ListingBinding({ keys, policyOnly = false }: { keys: string[]; policyOnly?: boolean }) {
  const { data, account, command } = useInventory();
  const [busy, setBusy] = useState(false), [message, setMessage] = useState("");
  const [editUnits, setEditUnits] = useState(false), [mode, setMode] = useState<string>();
  if (!data) return null;
  const mappings = keys.map((key) => data.mappings.find((m) => m.account_id === account && `${m.item_id}:${m.variation_id}` === key));
  const current = mappings[0];
  const mixed = mappings.some((m) => m?.variant_id !== current?.variant_id || m?.units_per_sale !== current?.units_per_sale);
  const selectedMode = mode ?? current?.mode ?? "REAL";
  const v = data.variants.find((v) => v.id === current?.variant_id);
  if (policyOnly && !current) return null;
  return <form className="supplier-binding" key={JSON.stringify(mappings)} onSubmit={async (e) => {
    e.preventDefault(); const f = new FormData(e.currentTarget); setBusy(true); setMessage("");
    try {
      if (policyOnly) {
        await command({ type: "mapping", accountId: account, keys, variantId: current!.variant_id, units: current!.units_per_sale, mode: selectedMode, fixed: selectedMode === "FIXED" ? Number(f.get("fixed")) : null });
      } else {
        // Preserve each option's policy when changing the group's supplier link.
        // One command applies all group keys atomically; policies are retained server-side.
        await command({ type: "mapping", accountId: account, keys, variantId: String(f.get("variant")) || null, units: Number(f.get("units")), mode: "REAL", fixed: null, preservePolicy: true });
      }
      setMessage("Asociación guardada.");
    } catch (e) { setMessage((e as Error).message); } finally { setBusy(false); }
  }}>
    {!policyOnly ? <><label>Producto / variante del proveedor<select name="variant" defaultValue={mixed ? "" : current?.variant_id ?? ""} disabled={busy}><option value="">Sin asociación</option>{data.variants.map((v) => <option key={v.id} value={v.id}>{data.people.find((p) => p.id === v.supplier_id)?.display_name} · {v.product_name}{v.name === "Única" ? "" : ` · ${v.name}`}</option>)}</select></label>
      <div className="units-control"><span>Unidades por venta: {mixed ? 1 : current?.units_per_sale ?? 1}</span><button type="button" className="units-toggle" onClick={() => setEditUnits(!editUnits)}>Cambiar</button><input aria-label="Unidades del proveedor por venta" name="units" type={editUnits ? "number" : "hidden"} min={1} max={10000} step={1} defaultValue={mixed ? 1 : current?.units_per_sale ?? 1} required /></div>
      {mixed && <small>El grupo tiene asociaciones diferentes. Guardar aplica la selección a estas opciones.</small>}
    </> : <><label>Política de stock<select value={selectedMode} onChange={(e) => setMode(e.target.value)}><option value="REAL">REAL · stock vendible</option><option value="FIXED">FIXED · cantidad fija</option></select></label>{selectedMode === "FIXED" && <label>Cantidad fija<input name="fixed" type="number" min={0} max={1000000000} step={1} defaultValue={current?.fixed_quantity ?? 999} required /></label>}
      {v && <small>Deseado guardado: {desiredListingQuantity({ mode: current!.mode, fixedQuantity: current!.fixed_quantity, sellableStock: v.stock })} · No se envía a Mercado Libre</small>}
    </>}
    <button disabled={busy || !account}>{policyOnly ? "Guardar política" : "Guardar asociación"}</button>{message && <small role="status">{message}</small>}
  </form>;
}
