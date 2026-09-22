"use client";
import { useState } from "react";
import { useInventory } from "./inventory-context";
export default function Users() {
  const { data, command } = useInventory();
  const [busy, setBusy] = useState(false), [message, setMessage] = useState("");
  if (!data || data.profile.role !== "ADMIN") return null;
  const suppliers = data.people.filter((p) => p.role === "SUPPLIER"), sellers = data.people.filter((p) => p.role !== "SUPPLIER");
  const name = (id: string) => data.people.find((p) => p.id === id)?.display_name ?? id;
  async function run(action?: unknown) { setBusy(true); setMessage(""); try { await command(action); setMessage("Administración actualizada."); } catch (e) { setMessage((e as Error).message); } finally { setBusy(false); } }
  return <div className="inventory-view"><p className="table-note">Creá usuarios desde Supabase Authentication. Sus perfiles empiezan como USER. ADMIN se asigna por SQL seguro, nunca desde este formulario.</p><button disabled={busy} onClick={() => void run()}>Actualizar usuarios</button>
    {message && <p className="notice" role="status">{message}</p>}
    <section className="panel"><div className="panel-title"><h2>Usuarios</h2></div>{data.people.map((p) => <div className="pending-row" key={p.id}><div className="order-text"><strong>{p.display_name}</strong><p>{p.role} · {data.accounts.filter((a) => a.owner_id === p.id).length} cuentas ML conectadas</p></div>
      {p.role !== "ADMIN" && <form className="inventory-inline" onSubmit={(e) => { e.preventDefault(); void run({ type: "role", userId: p.id, role: new FormData(e.currentTarget).get("role") }); }}><select name="role" aria-label={`Rol de ${p.display_name}`} defaultValue={p.role}><option>USER</option><option>SUPPLIER</option></select><button disabled={busy}>Guardar rol</button></form>}
    </div>)}</section>
    <section className="panel stock-card"><h2>Relaciones proveedor–vendedor</h2><form className="inventory-form" onSubmit={(e) => { e.preventDefault(); const f = new FormData(e.currentTarget); void run({ type: "relationship", supplierId: f.get("supplier"), sellerId: f.get("seller"), active: true }); }}><label>Proveedor<select name="supplier" required><option value="">Seleccionar</option>{suppliers.map((p) => <option key={p.id} value={p.id}>{p.display_name}</option>)}</select></label><label>Vendedor<select name="seller" required><option value="">Seleccionar</option>{sellers.map((p) => <option key={p.id} value={p.id}>{p.display_name}</option>)}</select></label><button disabled={busy}>Habilitar relación</button></form>
      {data.relationships.map((r) => <div className="stock-association" key={`${r.supplier_id}:${r.seller_user_id}`}><span>{name(r.supplier_id)} → {name(r.seller_user_id)} · {r.active ? "Activa" : "Inactiva"}</span> <button disabled={busy} onClick={() => void run({ type: "relationship", supplierId: r.supplier_id, sellerId: r.seller_user_id, active: !r.active })}>{r.active ? "Desactivar" : "Activar"}</button></div>)}
    </section>
  </div>;
}
