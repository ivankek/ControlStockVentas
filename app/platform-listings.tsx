"use client";
import { useEffect, useState } from "react";
import { useInventory } from "./inventory-context";
import Listings from "./listings";
import { skuMessage } from "@/lib/sku";
import type { NubeAccount, NubeCatalog } from "@/lib/tiendanube-catalog";

function PlatformTitle({ platform }: { platform: "meli" | "nube" }) {
  const label = platform === "meli" ? "Mercado Libre" : "Tiendanube";
  return <><img src={platform === "meli" ? "https://http2.mlstatic.com/frontend-assets/ui-navigation/6.6.139/mercadolibre/favicon.svg" : "/platforms/tiendanube.png"} alt="" width={32} height={32} />{label}</>;
}
function NubeListings({ account, token }: { account: NubeAccount; token: string }) {
  const { data: inventory } = useInventory();
  const [catalog, setCatalog] = useState<NubeCatalog>({ products: [], links: {}, version: 0 });
  const [busy, setBusy] = useState(false), [message, setMessage] = useState(""), [filter, setFilter] = useState("");
  const [drafts, setDrafts] = useState<Record<string, string>>({});
  async function associate(key: string, variantId: string) {
    setBusy(true); setMessage("");
    try {
      const response = await fetch(`/api/tiendanube/listings?account=${encodeURIComponent(account.id)}`, {
        method: "POST", headers: { Authorization: `Bearer ${token}`, "Content-Type": "application/json" },
        body: JSON.stringify({ action: "associate", key, variantId, version: catalog.version }),
      });
      const data = await response.json(); if (!response.ok) throw Error(data.error);
      setCatalog(data); setDrafts((previous) => { const next = { ...previous }; delete next[key]; return next; });
      setMessage("Asociación guardada.");
    } catch (e) { setMessage(e instanceof Error ? e.message : "No se pudo guardar la asociación."); }
    finally { setBusy(false); }
  }
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
    <p className="table-note">Abrí una publicación para asociar sus variantes al producto del proveedor. También podés usar Sincronizar SKU para asociar las coincidencias automáticamente; las demás asociaciones se conservan.</p>
    {message && <p className="notice" role="status">{message}</p>}
    <section className="panel"><div className="panel-title"><h3>Mis publicaciones de Tiendanube</h3><span className="pill">{visible.length} de {catalog.products.length}</span></div>
      {visible.map((p) => <details className="listing-group" key={p.id}><summary><strong>{p.title}</strong> · {p.published ? "Visible" : "Oculta"} · {p.variants.length} variantes</summary>
        {p.variants.map((v) => {
          const linked = catalog.links[`${p.id}:${v.id}`], supplier = inventory?.variants.find((x) => x.id === linked);
          const key = `${p.id}:${v.id}`, selected = drafts[key] ?? linked ?? "";
          return <div className="pending-row" key={v.id}><div className="order-text"><strong>{v.title || "Variante única"}</strong><p>Producto {p.id} · Variante {v.id} · SKU: {v.sku || "Sin SKU"}</p><p>Precio: {v.price ?? "Sin informar"} · Stock: {v.stock ?? "Sin límite"}</p><p>{supplier ? `Asociada · ${supplier.product_name}${supplier.name === "Única" ? "" : ` · ${supplier.name}`}` : linked ? "Asociada · producto del proveedor no disponible" : "Sin producto asociado"}</p>
            <form className="toolbar nube-association" onSubmit={(event) => { event.preventDefault(); if (selected) void associate(key, selected); }}>
              <label>Producto / variante del proveedor<select value={selected} disabled={busy || !inventory} onChange={(event) => setDrafts((previous) => ({ ...previous, [key]: event.target.value }))}>
                <option value="" disabled>Seleccionar producto del stock</option>
                {linked && !supplier && <option value={linked} disabled>Producto asociado no disponible</option>}
                {inventory?.variants.map((variant) => <option key={variant.id} value={variant.id}>{variant.product_name}{variant.name === "Única" ? "" : ` · ${variant.name}`}{variant.sku ? ` · SKU: ${variant.sku}` : ""}</option>)}
              </select></label>
              <button disabled={busy || !selected || selected === linked || !inventory?.variants.some((variant) => variant.id === selected)}>Guardar asociación</button>
            </form>
            {inventory && !inventory.variants.length && <p>No hay productos disponibles. Agregalos desde Stock para poder asociarlos.</p>}
          </div></div>;
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
  const [platform, setPlatform] = useState<"meli" | "nube">("meli");
  const active = platform === "meli" && !accounts.length ? "nube" : platform === "nube" && !nube.length ? "meli" : platform;
  const platforms = ([...(accounts.length ? ["meli"] : []), ...(nube.length ? ["nube"] : [])] as ("meli" | "nube")[]);
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
    {!!platforms.length && <div className="platform-tabs" role="tablist" aria-label="Plataforma de publicaciones">{platforms.map((value, index) => <button key={value} type="button" role="tab" id={`platform-tab-${value}`} aria-controls={`platform-panel-${value}`} aria-selected={active === value} tabIndex={active === value ? 0 : -1} onClick={() => setPlatform(value)} onKeyDown={(event) => {
      if (!["ArrowLeft", "ArrowRight", "Home", "End"].includes(event.key)) return;
      event.preventDefault(); const next = event.key === "Home" ? platforms[0] : event.key === "End" ? platforms[platforms.length - 1] : platforms[(index + (event.key === "ArrowRight" ? 1 : -1) + platforms.length) % platforms.length];
      setPlatform(next); document.getElementById(`platform-tab-${next}`)?.focus();
    }}><PlatformTitle platform={value} /></button>)}</div>}
    {accounts.length > 0 && <section hidden={active !== "meli"} role="tabpanel" id="platform-panel-meli" aria-labelledby="platform-tab-meli" className="platform-section"><div className="toolbar"><label>Cuenta Mercado Libre<select value={account} onChange={(e) => setAccount(e.target.value)}><option value="">Seleccionar cuenta</option>{accounts.map((a) => <option key={a.id} value={a.id}>{a.nickname ?? a.seller_id}</option>)}</select></label></div>{account && <Listings key={account} token={token} />}</section>}
    {loading && <p role="status">Consultando tiendas conectadas…</p>}
    {error && <p className="warning" role="alert">{error}</p>}
    {!!nube.length && token && <section hidden={active !== "nube"} role="tabpanel" id="platform-panel-nube" aria-labelledby="platform-tab-nube" className="platform-section">{nube.map((a) => <NubeListings key={`${token}:${a.id}`} account={a} token={token} />)}</section>}
    {!loading && !error && !accounts.length && !nube.length && <p className="empty">Conectá Mercado Libre o Tiendanube desde Conexión para ver tus publicaciones.</p>}
  </>;
}
