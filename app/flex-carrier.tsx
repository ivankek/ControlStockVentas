"use client";
import { useEffect, useRef, useState } from "react";
import { money, today } from "@/lib/domain";
import { carrierPeriod, type carrierReport } from "@/lib/flex-carrier";
import { FLEX_LABELS } from "@/lib/flex-zones";
import { useAccountPath, useInventory } from "./inventory-context";

type Result = { from: string; date: string; warning: string; carrier: ReturnType<typeof carrierReport> };
export default function FlexCarrier({ token }: { token?: string }) {
  const accountPath = useAccountPath();
  const { account } = useInventory();
  const [period, setPeriod] = useState("month");
  const [date, setDate] = useState(today);
  const [result, setResult] = useState<Result>();
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const controller = useRef<AbortController | null>(null);
  useEffect(() => { controller.current?.abort(); setResult(undefined); setBusy(false); return () => controller.current?.abort(); }, [token, account]);
  async function consult() {
    if (!token || !date) return;
    controller.current?.abort(); const request = new AbortController(); controller.current = request;
    setBusy(true); setError(""); setResult(undefined);
    try {
      const response = await fetch(accountPath("/api/sync"), { method: "POST", headers: { Authorization: `Bearer ${token}`, "Content-Type": "application/json" }, body: JSON.stringify(carrierPeriod(period, date, today())), signal: request.signal, cache: "no-store" });
      const data = await response.json();
      if (!response.ok) throw Error(data.error || "No se pudo consultar el período.");
      if (!request.signal.aborted) setResult(data);
    } catch (e) { if (!request.signal.aborted) setError((e as Error).message); }
    finally { if (!request.signal.aborted) setBusy(false); }
  }
  const formatDate = (value: string) => value.split("-").reverse().join("/");
  const days = result ? [...new Set(result.carrier.shipments.map(s => s.date))] : [];
  return <section className="panel" style={{ marginBottom: 24 }}>
    <div className="panel-title"><h2>A pagar al transportista Flex</h2></div>
    <div className="supplier-form">
      <label>Período<select value={period} disabled={busy} onChange={e => { setPeriod(e.target.value); setResult(undefined); }}>{[["year","Año"],["month","Mes"],["week","Semana"],["day","Día"]].map(([value,label]) => <option key={value} value={value}>{label}</option>)}</select></label>
      <label>{period === "day" ? "Fecha de despacho" : "Fecha dentro del período"}<input type="date" value={date} max={today()} disabled={busy} onChange={e => { setDate(e.target.value); setResult(undefined); }} /></label>
      <button className="primary" disabled={!token || busy || !date || date > today()} onClick={() => void consult()}>{busy ? "Consultando…" : "Consultar transporte Flex"}</button>
    </div>
    <p className="table-note">Cuenta cada envío despachado una sola vez, aunque incluya varias órdenes o productos. Usa la tarifa vigente el día del despacho. Excluye cancelados, correo y acordados. Es el costo del período: no descuenta pagos anteriores.</p>
    {busy && <p className="query-progress" role="status">Consultando fechas de despacho. Los períodos largos pueden tardar unos minutos. <button onClick={() => { controller.current?.abort(); setBusy(false); }}>Cancelar</button></p>}
    {error && <p className="warning" role="alert">{error}</p>}
    {result && <>
      <div className="panel-title"><div><h2>{result.carrier.pending ? "Subtotal calculable" : "Total del período"}: {money(result.carrier.totalCents)}</h2><p>{formatDate(result.from)} al {formatDate(result.date)} · {result.carrier.shipments.length} envíos</p></div></div>
      {result.carrier.pending > 0 && <p className="warning">{result.carrier.pending} envíos pendientes de revisión. No se incluyen como costo cero. Completá su zona en Despachos y volvé a consultar.</p>}
      {result.carrier.shipments.some(s => s.baselineRate) && <p className="table-note">Se usaron tarifas base actuales donde no había una tarifa guardada para la fecha. Revisalas antes de pagar períodos antiguos.</p>}
      <div className="table-wrap"><table><thead><tr><th>FECHA DE DESPACHO</th><th>ENVÍOS</th><th>IMPORTE</th></tr></thead><tbody>{days.map(day => {
        const shipments = result.carrier.shipments.filter(s => s.date === day);
        return <tr key={day}><td>{formatDate(day)}</td><td>{shipments.length}</td><td>{money(shipments.reduce((sum,s) => sum + (s.cents ?? 0),0))}{shipments.some(s => s.cents === undefined) ? " · parcial" : ""}</td></tr>;
      })}</tbody></table></div>
      {!days.length && <p className="empty">No se encontraron envíos Flex despachados en este período.</p>}
      <details className="expense-explanation"><summary>Ver envíos y tarifas</summary><div className="table-wrap"><table><thead><tr><th>FECHA</th><th>ENVÍO / ÓRDENES</th><th>ZONA</th><th>TARIFA</th></tr></thead><tbody>{result.carrier.shipments.map(s => <tr key={s.shipmentId ?? s.orderIds[0]}><td>{formatDate(s.date)}</td><td>{s.shipmentId ?? "Sin ID"}<small style={{display:"block"}}>{s.orderIds.join(", ")}</small></td><td>{s.zone ? FLEX_LABELS[s.zone] : "Desconocida"}</td><td>{s.cents === undefined ? s.issue : money(s.cents)}</td></tr>)}</tbody></table></div></details>
      <p className="table-note">{result.warning}</p>
    </>}
  </section>;
}
