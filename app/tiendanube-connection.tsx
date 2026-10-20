"use client";
import { useEffect, useState } from "react";
import type { NubeAccount } from "@/lib/tiendanube-catalog";
export default function TiendanubeConnection({ token }: { token?: string }) {
  const [accounts, setAccounts] = useState<NubeAccount[]>([]), [message, setMessage] = useState("");
  const [busy, setBusy] = useState(false);
  useEffect(() => {
    const controller = new AbortController();
    if (!token) { setAccounts([]); return; }
    void fetch("/api/tiendanube", { headers: { Authorization: `Bearer ${token}` }, signal: controller.signal }).then(async (r) => {
      const data = await r.json(); if (!r.ok) throw Error(data.error);
      if (!controller.signal.aborted) setAccounts(data.accounts);
    }).catch((e) => { if (!controller.signal.aborted) setMessage(e.message); });
    return () => controller.abort();
  }, [token]);
  return <div className="nube-connection"><h3>3. Tiendanube</h3>
    {accounts.map((a) => <div className="account-card" key={a.id}><strong>{a.name}</strong><p>Conectada · ID de tienda: {a.store_id}</p></div>)}
    <p>Autorizá a Despachos desde Tiendanube. El ID de tu tienda y el acceso se guardan automáticamente.</p>
    <form className="toolbar" onSubmit={async (event) => {
      event.preventDefault();
      setBusy(true); setMessage("");
      try {
        const response = await fetch("/api/tiendanube/connect", { method: "POST", headers: { Authorization: `Bearer ${token}` } });
        const data = await response.json(); if (!response.ok) throw Error(data.error);
        window.location.assign(data.url);
      } catch (e) { setMessage(e instanceof Error ? e.message : "No se pudo conectar."); }
      finally { setBusy(false); }
    }}>
      <button className="primary" disabled={busy || !token}>{busy ? "Conectando…" : "Conectar Tiendanube / renovar"}</button>
    </form>
    <p className="table-note">El token se guarda cifrado y no se muestra al consultar la conexión.</p>
    <p className="table-note">Esta conexión permite importar publicaciones y asociarlas por SKU. Las ventas de Tiendanube todavía no descuentan el stock compartido.</p>
    {message && <p className="notice" role="status">{message}</p>}
  </div>;
}
