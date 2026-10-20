"use client";
import { useEffect, useState } from "react";
import { useInventory } from "./inventory-context";
import Listings from "./listings";
import { skuMessage } from "@/lib/sku";
import type { NubeAccount, NubeCatalog } from "@/lib/tiendanube-catalog";

function PlatformTitle({ platform }: { platform: "meli" | "nube" }) {
  const label = platform === "meli" ? "Mercado Libre" : "Tiendanube";
  return <h2 className="platform-title"><img src={platform === "meli" ? "https://http2.mlstatic.com/frontend-assets/ui-navigation/6.6.139/mercadolibre/favicon.svg" : "https://www.tiendanube.com/favicon.ico"} alt="" width={32} height={32} />{label}</h2>;
}
function NubeListings({ account, token }: { account: NubeAccount; token: string }) {
  const { data: inventory } = useInventory();
  const [catalog, setCatalog] = useState<NubeCatalog>({ products: [], links: {}, version: 0 });
  const [busy, setBusy] = useState(false), [message, setMessage] = useState(""), [filter, setFilter] = useState("");
  async function request(action?: "refresh" | "sku", signal?: AbortSignal) {
    setBusy(true); setMessage("");
    try {
      const response = await fetch(`/api/tiendanube/listings?account=${encodeURIComponent(account.id)}`, {
        method: action ? "POST" : "GET", headers: { Authorization: `Bearer ${token}`, "Content-Type": "application/json" },
        ...(action ? { body: JSON.stringify({ action }) } : {}), signal, cache: "no-store",
      });
      const data = await response.json(); if (!response.ok) throw Error(data.error);
      if (signal?.aborted) return;
      setCatalog(data);
      if (action) setMessage(action === "sku" ? skuMessage(data) : `${data.products.length} publicaciones actualizadas.`);
    } catch (e) { if (!signal?.aborted) setMessage(e instanceof Error ? e.message : "No se pudo consultar Tiendanube."); }
    finally { if (!signal?.aborted) setBusy(false); }
  }
  useEffect(() => { const controller = new AbortController(); void request(undefined, controller.signal); return () => controller.abort(); }, [account.id, token]);
  const query = filter.trim().toLocaleLowerCase("es");
  const visible = catalog.products.filter((p) => `${p.title} ${p.id} ${p.variants.map((v) => v.sku).join(" ")}`.toLocaleLowerCase("es").includes(query));
  return <div><h3>{account.name} · {account.store_id}</h3>
    <div className="toolbar"><label>Buscar por título, ID o SKU<input value={filter} onChange={(e) => setFilter(e.target.value)} /></label>
      <button className="primary" disabled={busy} onClick={() => void request("refresh")}>{busy ? "Consultando…" : "Actualizar publicaciones"}</button>
      <button disabled={busy} onClick={() => void request("sku")}>Sincronizar SKU</button>
    </div>
    <p className="table-note">Asociá las variantes al producto del proveedor con el mismo SKU. Los SKU deben coincidir exactamente; las asociaciones sin coincidencia se conservan.</p>
    {message && <p className="notice" role="status">{message}</p>}
    <section className="panel"><div className="panel-title"><h3>Mis publicaciones de Tiendanube</h3><span className="pill">{visible.length} de {catalog.products.length}</span></div>
      {visible.map((p) => <details className="listing-group" key={p.id}><summary><strong>{p.title}</strong> · {p.published ? "Visible" : "Oculta"} · {p.variants.length} variantes</summary>
        {p.variants.map((v) => {
          const linked = catalog.links[`${p.id}:${v.id}`], supplier = inventory?.variants.find((x) => x.id === linked);
          return <div className="pending-row" key={v.id}><div className="order-text"><strong>{v.title || "Variante única"}</strong><p>Producto {p.id} · Variante {v.id} · SKU: {v.sku || "Sin SKU"}</p><p>Precio: {v.price ?? "Sin informar"} · Stock: {v.stock ?? "Sin límite"}</p><p>{supplier ? `Asociada · ${supplier.product_name}${supplier.name === "Única" ? "" : ` · ${supplier.name}`}` : linked ? "Asociada · producto del proveedor no disponible" : "Sin producto asociado"}</p></div></div>;
        })}
      </details>)}
      {!visible.length && !busy && <p className="empty">{catalog.products.length ? "No hay coincidencias." : "Usá Actualizar publicaciones para importar el catálogo."}</p>}
    </section>
  </div>;
}
export default function PlatformListings({ token }: { token?: string }) {
  const { data: inventory, account, setAccount } = useInventory();
  const accounts = inventory?.accounts.filter((a) => a.owner_id === inventory.profile.id) ?? [];
  const [nube, setNube] = useState<NubeAccount[]>([]), [loading, setLoading] = useState(true), [error, setError] = useState("");
  useEffect(() => {
    const controller = new AbortController();
    setNube([]); setError(""); setLoading(!!token);
    if (!token) return;
    void fetch("/api/tiendanube", { headers: { Authorization: `Bearer ${token}` }, signal: controller.signal }).then(async (response) => {
      const data = await response.json(); if (!response.ok) throw Error(data.error);
      if (!controller.signal.aborted) setNube(data.accounts);
    }).catch((e) => { if (!controller.signal.aborted) setError(e.message); }).finally(() => { if (!controller.signal.aborted) setLoading(false); });
    return () => controller.abort();
  }, [token]);
  return <>
    {accounts.length > 0 && <section className="platform-section"><PlatformTitle platform="meli" /><div className="toolbar"><label>Cuenta Mercado Libre<select value={account} onChange={(e) => setAccount(e.target.value)}><option value="">Seleccionar cuenta</option>{accounts.map((a) => <option key={a.id} value={a.id}>{a.nickname ?? a.seller_id}</option>)}</select></label></div>{account && <Listings key={account} token={token} />}</section>}
    {loading && <p role="status">Consultando tiendas conectadas…</p>}
    {error && <p className="warning" role="alert">{error}</p>}
    {!!nube.length && token && <section className="platform-section"><PlatformTitle platform="nube" />{nube.map((a) => <NubeListings key={`${token}:${a.id}`} account={a} token={token} />)}</section>}
    {!loading && !error && !accounts.length && !nube.length && <p className="empty">Conectá Mercado Libre o Tiendanube desde Conexión para ver tus publicaciones.</p>}
  </>;
}
