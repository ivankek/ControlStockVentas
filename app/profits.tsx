"use client";
import { useEffect, useMemo, useRef, useState } from "react";
import { emptyState, money, today, type State } from "@/lib/domain";
import { emptyBusiness } from "@/lib/business";
import { profitRows, reportTotals, expenseBreakdown, type Sale } from "@/lib/profit";
import { queryProfitSales } from "@/lib/profit-query";
import OrderNoteEditor from "./order-note";

const shift = (date: string, days: number) => new Date(Date.parse(date + "T12:00:00Z") + days * 86400000).toISOString().slice(0, 10);
function period(mode: string, selected: string) {
  const now = today();
  let from = selected, to = selected;
  if (mode === "Histórico") { from = shift(now, -364); to = now; }
  if (mode === "Año") { from = selected.slice(0, 4) + "-01-01"; to = selected.slice(0, 4) + "-12-31"; }
  if (mode === "Mes") { from = selected.slice(0, 7) + "-01"; to = new Date(Date.UTC(Number(selected.slice(0, 4)), Number(selected.slice(5, 7)), 0)).toISOString().slice(0, 10); }
  if (mode === "Semana") { const weekday = new Date(selected + "T12:00:00Z").getUTCDay(); from = shift(selected, -(weekday === 0 ? 6 : weekday - 1)); to = shift(from, 6); }
  return { from, to: to > now ? now : to };
}
export default function Profits({ token }: { token?: string }) {
  const [mode, setMode] = useState("Histórico");
  const [date, setDate] = useState(today);
  const [net, setNet] = useState(false);
  const [busy, setBusy] = useState(false);
  const [progress, setProgress] = useState("");
  const [error, setError] = useState("");
  const [result, setResult] = useState<{ sales: Sale[]; state: State; from: string; to: string; time: string }>();
  const controller = useRef<AbortController | null>(null);
  useEffect(() => { controller.current?.abort(); setResult(undefined); setBusy(false); return () => controller.current?.abort(); }, [token]);
  async function refreshCosts() {
    if (!token) return;
    try {
      const response = await fetch("/api/business", { headers: { Authorization: `Bearer ${token}` }, cache: "no-store" });
      const business = await response.json(); if (!response.ok) throw Error(business.error);
      setResult((current) => current ? { ...current, state: { ...current.state, business } } : current);
    } catch (e) { setError((e as Error).message); }
  }
  async function consult() {
    if (!token || !date) return;
    controller.current?.abort(); const request = new AbortController(); controller.current = request;
    const range = period(mode, date);
    setBusy(true); setError(""); setResult(undefined);
    const headers = { Authorization: `Bearer ${token}`, "Content-Type": "application/json" };
    async function json(url: string, body?: unknown) {
      const response = await fetch(url, { headers, method: body ? "POST" : "GET", body: body ? JSON.stringify(body) : undefined, signal: request.signal, cache: "no-store" });
      const data = await response.json(); if (!response.ok) throw Error(data.error || "No se pudo completar la consulta."); return data;
    }
    try {
      const [catalog, business] = await Promise.all([json("/api/listings"), json("/api/business")]);
      const state: State = { ...emptyState(), listings: catalog.listings, supplierProducts: catalog.products, supplierLinks: catalog.links, business };
      setProgress("Buscando las ventas del período…");
      const sales = await queryProfitSales(range, (page) => json("/api/profit", page), (count, total) => {
        if (!request.signal.aborted) setProgress(`${count} de ${total} ventas consultadas`);
      });      if (!request.signal.aborted) setResult({ sales, state, ...range, time: new Date().toLocaleString("es-AR") });
    } catch (e) { if (!request.signal.aborted) setError((e as Error).message); }
    finally { if (!request.signal.aborted) { setBusy(false); setProgress(""); } }
  }
  const rows = useMemo(() => result ? profitRows(result.state, result.sales) : [], [result]);
  const business = result?.state.business ?? emptyBusiness();
  const totals = result ? reportTotals(rows, business, result.from, result.to) : undefined;
  const buckets = useMemo(() => {
    if (!result) return [];
    const values: { label: string; gross: number; net: number }[] = [];
    for (let from = result.from; from <= result.to;) {
      const monthly = mode === "Histórico" || mode === "Año";
      const monthEnd = new Date(Date.UTC(Number(from.slice(0, 4)), Number(from.slice(5, 7)), 0)).toISOString().slice(0, 10);
      const to = monthly && monthEnd < result.to ? monthEnd : monthly ? result.to : from;
      const value = reportTotals(rows, result.state.business ?? emptyBusiness(), from, to);
      values.push({ label: monthly ? from.slice(0, 7) : from, gross: value.gross, net: value.net });
      from = shift(to, 1);
    }
    return values;
  }, [result, rows, mode]);
  const coverageMissing = !!result && result.from < shift(today(), -364);
  const incomplete = !!totals && (coverageMissing || (net ? totals.missingNet > 0 || totals.missingMonths.length > 0 : totals.missingGross > 0));
  const max = Math.max(1, ...buckets.map((bucket) => Math.abs(net ? bucket.net : bucket.gross)));
  return <div className="profits-view">
    <div className="toolbar"><label>Período<select value={mode} disabled={busy} onChange={(e) => { setMode(e.target.value); setResult(undefined); }}>{["Histórico", "Año", "Mes", "Semana", "Día"].map((label) => <option key={label}>{label}</option>)}</select></label>
      {mode !== "Histórico" && <label>{mode === "Día" ? "Fecha" : "Fecha dentro del período"}<input type="date" value={date} max={today()} disabled={busy} onChange={(e) => { setDate(e.target.value); setResult(undefined); }} /></label>}
      <button className="primary" disabled={busy || !token || !date} onClick={() => void consult()}>Consultar ganancias</button>
      <label className="profit-switch"><input type="checkbox" role="switch" checked={net} onChange={(e) => setNet(e.target.checked)} /> Ganancias netas</label>
    </div>
    <p className="table-note">Bruto = total vendido en ARS de pedidos pagados. Neto estimado = neto recibido − proveedor − logística propia − gastos mensuales. Se usa la fecha de creación de la venta y sus costos vigentes. No es un reporte de dinero disponible o liberado.</p>
    <p className="notice">Histórico disponible: últimos 365 días consultados. Mercado Libre limita el acceso a órdenes antiguas (hasta 12 meses). Los años anteriores pueden estar incompletos. Las ventas no se guardan en la base de datos.</p>
    {busy && <p className="query-progress" role="status">{progress || "Preparando consulta…"} <button onClick={() => { controller.current?.abort(); setBusy(false); setProgress(""); }}>Cancelar</button></p>}
    {error && <p className="warning" role="alert">{error}</p>}
    {totals && result && <>
      <div className="profit-cards"><section className="panel profit-card"><small>{net ? "Ganancia neta estimada" : "Total vendido · bruto"}{incomplete ? " · parcial" : ""}</small><strong>{money(net ? totals.net : totals.gross)}</strong><span>{result.from} al {result.to}</span></section>
        <section className="panel profit-card"><small>Ventas consultadas</small><strong>{totals.count}</strong><span>Actualizado: {result.time}</span></section>
        {net && <section className="panel profit-card"><small>Gastos mensuales del período</small><strong>{money(totals.expenses.total)}</strong><span>Monotributo {money(totals.expenses.tax)} · Adicionales ML {money(totals.expenses.billing)}</span></section>}
      </div>
      {net && <details className="panel expense-explanation"><summary>Cómo se descuentan los gastos mensuales</summary>
        <p>Importe mensual ÷ días del mes × días incluidos en el filtro. Se aplica a los días calendario, aunque no haya ventas. Los centavos se distribuyen entre días para que un mes completo coincida exactamente con lo cargado.</p>
        {expenseBreakdown(business, result.from, result.to).map((part) => <div className="expense-month" key={part.month}>
          <strong>{part.month} · {part.days} de {part.daysInMonth} días</strong>
          {part.configured ? <><p>Monotributo mensual: {money(part.configured.taxCents)} → se descuentan <strong>{money(part.tax)}</strong>.</p><p>Cargos ML mensuales: {money(part.configured.billingCents)} → se descuentan <strong>{money(part.billing)}</strong>.</p></> : <p>Pendiente de carga: no se descontó un importe para este mes.</p>}
        </div>)}
        <p><strong>Neto del período = suma de netos calculables ({money(totals.net + totals.expenses.total)}) − gastos mensuales ({money(totals.expenses.total)}) = {money(totals.net)}.</strong></p>
        <p>Los cargos ML deben incluir únicamente publicidad y otros cargos que no estén ya descontados del recibido.</p>
      </details>}
      {incomplete && <p className="warning">Resultado parcial: {coverageMissing && "El período excede el historial disponible. "}{net ? `${totals.missingNet} ventas sin neto calculable. Meses con gastos pendientes: ${totals.missingMonths.join(", ") || "ninguno"}.` : `${totals.missingGross} ventas excluidas por estado o importe no disponible.`} Los importes desconocidos no se toman como cero; esas ventas quedan fuera del subtotal.</p>}
      {net && <p className="table-note">Revisá el neto recibido contra una liquidación real: puede haber reintegros Flex, retenciones o cargos facturados por separado. Cargá ajustes en “Completar importes” y solo cargos mensuales no descontados. Un envío Flex compartido se cobra una vez entre las órdenes consultadas. Cancelaciones y devoluciones quedan pendientes de revisión.</p>}
      <section className="panel profit-chart"><h2>{net ? "Evolución del neto estimado" : "Evolución de ventas brutas"}{incomplete ? " · parcial" : ""}</h2>
        {buckets.map((bucket) => { const value = net ? bucket.net : bucket.gross; return <div className="profit-bar-row" key={bucket.label}><span>{bucket.label}</span><div className="profit-bar-track"><div className={value < 0 ? "profit-bar negative" : "profit-bar"} style={{ width: `${Math.max(0, Math.abs(value) / max * 100)}%` }} /></div><strong>{money(value)}</strong></div>; })}
      </section>
      <section className="panel pending"><div className="panel-title"><h2>Detalle por venta</h2><span className="pill">{rows.length} ventas</span></div>
        <div className="profit-sales">{rows.map((row) => <article className="profit-sale" key={row.sale.id}>
          <div className="profit-sale-heading"><strong>Orden {row.sale.id}</strong><span>{row.date} · {row.sale.mode === "correo" ? "Correo" : row.sale.mode === "flex" ? "Flex" : "Acordado"}</span></div>
          <p>{[row.sale.province, row.sale.city].filter(Boolean).join(" · ") || "Ubicación no informada"}</p>
          <dl className="sale-metrics"><div><dt>Bruto</dt><dd>{row.gross === undefined ? "A revisar" : money(row.gross)}</dd></div>
            {net && <><div><dt>Recibido</dt><dd>{row.received === undefined ? "Pendiente" : money(row.received)}{row.manualNet && <small>Manual</small>}</dd></div>
              <div><dt>Proveedor</dt><dd>{row.supplier === undefined ? "Pendiente" : money(row.supplier)}</dd></div>
              <div><dt>Envío propio</dt><dd>{row.shipping === undefined ? "Pendiente" : money(row.shipping)}</dd></div>
              <div className="sale-net"><dt>Neto de la venta</dt><dd>{row.net === undefined ? "Pendiente" : money(row.net)}</dd></div></>}
          </dl>
          {net && <details className="sale-detail"><summary>Revisar y completar importes{row.issues.length ? ` · ${row.issues.length} pendientes` : ""}</summary>
            {!!row.issues.length && <ul>{row.issues.map((issue) => <li key={issue}>{issue}</li>)}</ul>}
            <p>El neto de esta venta todavía no descuenta los gastos mensuales. Esos gastos se restan una sola vez del total del período.</p>
            <OrderNoteEditor financial order={row.sale} note={business.notes[row.sale.id]} token={token} onSaved={() => void refreshCosts()} />
          </details>}
        </article>)}</div>
        {!rows.length && <p className="empty">No se encontraron ventas en el período consultado.</p>}
      </section>    </>}
  </div>;
}
