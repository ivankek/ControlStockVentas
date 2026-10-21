"use client";
import { useCallback, useEffect, useState } from "react";
import type { HomeAccount, HomeSales, HomeListing } from "@/lib/supplier-home";

async function request<T>(token: string, account?: string, signal?: AbortSignal): Promise<T> {
  const response = await fetch(`/api/supplier-home${account ? `?account=${encodeURIComponent(account)}` : ""}`, {
    method: account ? "POST" : "GET", headers: { Authorization: `Bearer ${token}` }, signal,
  });
  const data = await response.json();
  if (!response.ok) throw Error(data.error || "No se pudo consultar la cuenta.");
  return data;
}
function Listings({ listings, linked }: { listings: HomeListing[]; linked: boolean }) {
  return <details className="supplier-listings" open={!linked}>
    <summary>{linked ? "Publicaciones asociadas" : "Publicaciones sin asociar"} ({listings.length})</summary>
    {!listings.length ? <p>No hay publicaciones en este grupo.</p> : <ul>{listings.map((l) => <li key={l.key}>
      <strong>{l.title}</strong>{l.variant && <span> · {l.variant}</span>}
      <small>{l.key} · SKU: {l.sku || "Sin SKU"}</small>
      {linked && <small>{l.supplierName || "Asociada a otro proveedor"}{l.units > 1 ? ` · ${l.units} unidades por venta` : ""}</small>}
    </li>)}</ul>}
  </details>;
}
type Report = { sales?: HomeSales; busy: boolean; error: string };
function Account({ account, token, active, onReport }: { account: HomeAccount; token: string; active: boolean; onReport: (id: string, report: Report) => void }) {
  const [sales, setSales] = useState<HomeSales>();
  const [error, setError] = useState("");
  const [busy, setBusy] = useState(true);
  const [revision, setRevision] = useState(0);
  const [search, setSearch] = useState("");
  useEffect(() => {
    const controller = new AbortController();
    setBusy(true); setError(""); setSales(undefined);
    request<HomeSales>(token, account.id, controller.signal).then(setSales).catch((e) => {
      if (!controller.signal.aborted) setError(e.message);
    }).finally(() => { if (!controller.signal.aborted) setBusy(false); });
    return () => controller.abort();
  }, [token, account.id, revision]);
  useEffect(() => { onReport(account.id, {sales, busy, error}); }, [account.id, sales, busy, error, onReport]);
  const listings = account.listings.filter((l) => `${l.title} ${l.variant} ${l.sku ?? ""} ${l.key}`.toLocaleLowerCase().includes(search.toLocaleLowerCase()));
  return <section className="supplier-account" role="tabpanel" id={`account-panel-${account.id}`} aria-labelledby={`account-tab-${account.id}`} hidden={!active}>
    <div className="supplier-account-heading"><div><small>{account.platform === "meli" ? "Mercado Libre" : "Tiendanube"}</small><h2>{account.name}</h2></div>
      <button disabled={busy} onClick={() => setRevision((r) => r+1)}>{busy ? "Consultando ventas…" : "Actualizar ventas"}</button></div>
    {error && <div className="notice" role="alert">{error}</div>}
    {busy && <p role="status">Consultando pedidos y plazos de despacho de esta cuenta…</p>}
    {sales && <>
      <p>Despachos del {sales.date.split("-").reverse().join("/")} · Consultado a las {new Date(sales.updatedAt).toLocaleTimeString("es-AR", {timeZone:"America/Argentina/Buenos_Aires", hour:"2-digit",minute:"2-digit"})}</p>
      {sales.warnings.map((w) => <div className="notice" key={w}>{w}</div>)}
      <div className="supplier-counts">{(["today", "late", "review"] as const).map((group) => <div key={group}><strong>{sales.orders.filter((o) => o.group === group).length}</strong><span>{group === "today" ? "Para hoy" : group === "late" ? "Atrasados pendientes" : "Para revisar"}</span></div>)}</div>
      {(["late", "today", "review"] as const).map((group) => {
        const orders = sales.orders.filter((o) => o.group === group);
        if (!orders.length) return null;
        return <section className="supplier-sales" key={group}><h3>{group === "late" ? "Atrasados pendientes" : group === "today" ? "A despachar hoy" : "Sin fecha o estado verificable"}</h3>
          {orders.map((o) => <article key={o.id} className="supplier-sale"><div className="supplier-sale-heading"><strong>Venta #{o.id}</strong><span className="pill">{o.mode}</span></div>
            {o.due && <small>Despachar hasta: {o.due.split("-").reverse().join("/")}</small>}{o.shipment && <small> · Envío {o.shipment}</small>}
            <ul>{o.lines.map((l, i) => <li key={i}><strong>{l.quantity} ×</strong> {l.title}<small>{l.supplierName ? `${l.supplierName} · ${l.quantity*l.units} unidades del stock` : "Sin producto asociado"}</small></li>)}</ul>
            {o.note && <p>{o.note}</p>}</article>)}
        </section>;
      })}
      {!sales.orders.length && <p>{sales.warnings.length ? "La consulta está incompleta. Actualizá las ventas para volver a intentarlo." : "No se encontraron pedidos pendientes para hoy, atrasados o para revisar."}</p>}
    </>}
    <div className="supplier-catalog"><h3>Publicaciones de la cuenta</h3><p>Catálogo guardado en la app. Cada variante se muestra por separado.</p>
      {account.error ? <div className="notice">{account.error}</div> : <><label>Buscar publicación o SKU<input value={search} onChange={(e) => setSearch(e.target.value)} /></label>
      <Listings listings={listings.filter((l) => !l.linked)} linked={false} /><Listings listings={listings.filter((l) => l.linked)} linked /></>}
    </div>
  </section>;
}
export default function SupplierHome({ token }: { token?: string }) {
  const [accounts, setAccounts] = useState<HomeAccount[]>();
  const [error, setError] = useState("");
  const [revision, setRevision] = useState(0);
  const [selected, setSelected] = useState("");
  const [reports, setReports] = useState<Record<string, Report>>({});
  const onReport = useCallback((id: string, report: Report) => setReports((current) => ({...current, [id]: report})), []);
  useEffect(() => {
    if (!token) return;
    const controller = new AbortController(); setAccounts(undefined); setError(""); setReports({});
    request<{accounts:HomeAccount[]}>(token, undefined, controller.signal).then((data) => setAccounts(data.accounts)).catch((e) => { if (!controller.signal.aborted) setError(e.message); });
    return () => controller.abort();
  }, [token, revision]);
  const active = accounts?.some((a) => a.id === selected) ? selected : accounts?.[0]?.id;
  const loaded = accounts?.filter((a) => reports[a.id]?.sales && !reports[a.id]?.busy) ?? [];
  const orders = loaded.flatMap((a) => reports[a.id].sales!.orders);
  const incomplete = accounts?.some((a) => !reports[a.id]?.sales || reports[a.id]?.busy || reports[a.id]?.sales?.warnings.length);
  const cards = [
    { label: "Cuentas vinculadas", value: accounts?.length, detail: "Mercado Libre y Tiendanube" },
    { label: "Ventas para hoy", value: loaded.length ? orders.filter((o) => o.group === "today").length : undefined, detail: "Pendientes de despacho" },
    { label: "Ventas atrasadas", value: loaded.length ? orders.filter((o) => o.group === "late").length : undefined, detail: "Todavía pendientes" },
    { label: "Ventas para revisar", value: loaded.length ? orders.filter((o) => o.group === "review").length : undefined, detail: "Sin fecha o estado confirmado" },
    { label: "Sin asociar", value: accounts?.some((a) => a.error) ? undefined : accounts?.reduce((n, a) => n + a.listings.filter((l) => !l.linked).length, 0), detail: "Variantes de publicaciones" },
  ];
  return <div className="supplier-home"><div className="toolbar"><p>Resumen de todas tus cuentas vinculadas.</p><button disabled={!token || (!accounts && !error)} onClick={() => setRevision((r) => r+1)}>Actualizar inicio</button></div>
    <div className="supplier-overview">{cards.map((card) => <article key={card.label}><span>{card.label}</span><strong>{card.value ?? "—"}</strong><small>{card.detail}</small></article>)}</div>
    {!!accounts?.length && <p className="supplier-summary-status" role="status">{incomplete ? `Resumen parcial · ${loaded.length} de ${accounts.length} cuentas consultadas. Revisá los avisos de cada cuenta.` : "Resumen de todas las cuentas actualizado."}</p>}
    {error && <div className="notice" role="alert">{error}</div>}
    {!accounts && !error && <p role="status">Cargando cuentas vinculadas…</p>}
    {accounts?.length === 0 && <p>Todavía no hay cuentas conectadas de vendedores vinculados a este proveedor.</p>}
    {!!accounts?.length && <div className="platform-tabs supplier-tabs" role="tablist" aria-label="Cuentas vinculadas">{accounts.map((a, index) => <button key={a.id} id={`account-tab-${a.id}`} role="tab" aria-selected={active === a.id} aria-controls={`account-panel-${a.id}`} tabIndex={active === a.id ? 0 : -1} onClick={() => setSelected(a.id)} onKeyDown={(e) => {
      const next = e.key === "ArrowRight" ? (index + 1) % accounts.length : e.key === "ArrowLeft" ? (index + accounts.length - 1) % accounts.length : e.key === "Home" ? 0 : e.key === "End" ? accounts.length - 1 : -1;
      if (next < 0) return; e.preventDefault(); setSelected(accounts[next].id); document.getElementById(`account-tab-${accounts[next].id}`)?.focus();
    }}><img src={a.platform === "meli" ? "https://http2.mlstatic.com/frontend-assets/ui-navigation/6.6.139/mercadolibre/favicon.svg" : "/platforms/tiendanube.png"} alt="" width={26} height={26} /><span>{a.name}<small>{a.platform === "meli" ? "Mercado Libre" : "Tiendanube"}</small></span></button>)}</div>}
    {token && accounts?.map((a) => <Account key={`${revision}:${a.platform}:${a.id}`} account={a} token={token} active={active === a.id} onReport={onReport} />)}
  </div>;
}
