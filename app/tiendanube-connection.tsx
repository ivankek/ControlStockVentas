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
    <p>Conectá tu aplicación a medida con acceso de lectura a productos. Para renovar el acceso de una tienda, ingresá su mismo ID y el token nuevo.</p>
    <form className="toolbar" onSubmit={async (event) => {
      event.preventDefault(); const form = event.currentTarget, values = new FormData(form);
      setBusy(true); setMessage("");
      try {
        const response = await fetch("/api/tiendanube", { method: "POST", headers: { Authorization: `Bearer ${token}`, "Content-Type": "application/json" }, body: JSON.stringify({ storeId: values.get("storeId"), token: values.get("accessToken") }) });
        const data = await response.json(); if (!response.ok) throw Error(data.error);
        setAccounts(data.accounts); form.reset(); setMessage("Tiendanube conectada. Ya podés importar sus publicaciones.");
      } catch (e) { setMessage(e instanceof Error ? e.message : "No se pudo conectar."); }
      finally { setBusy(false); }
    }}>
      <label>ID de tienda<input name="storeId" inputMode="numeric" pattern="[0-9]+" required disabled={busy || !token} /></label>
      <label>Token de acceso<input name="accessToken" type="password" autoComplete="off" required disabled={busy || !token} /></label>
      <button className="primary" disabled={busy || !token}>{busy ? "Conectando…" : "Conectar Tiendanube / renovar"}</button>
    </form>
    <p className="table-note">El token se guarda cifrado y no se muestra al consultar la conexión.</p>
    {message && <p className="notice" role="status">{message}</p>}
  </div>;
}
