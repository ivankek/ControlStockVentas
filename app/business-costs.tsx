"use client";
import { useEffect, useState } from "react";
import { emptyBusiness, type Business } from "@/lib/business";
import { money, today } from "@/lib/domain";

export default function BusinessCosts({ token }: { token?: string }) {
  const [data, setData] = useState<Business>(emptyBusiness);
  const [busy, setBusy] = useState(false);
  const [message, setMessage] = useState("");
  const [loaded, setLoaded] = useState(false);
  const [zoneId, setZoneId] = useState("");
  const [month, setMonth] = useState(today().slice(0, 7));
  useEffect(() => {
    const controller = new AbortController(); setLoaded(false); setData(emptyBusiness());
    if (token) fetch("/api/business", { headers: { Authorization: `Bearer ${token}` }, cache: "no-store", signal: controller.signal }).then(async (response) => { const result = await response.json(); if (!response.ok) throw Error(result.error); return result; }).then((result) => { setData(result); setLoaded(true); }).catch((e) => { if (!controller.signal.aborted) setMessage(e.message); });
    return () => controller.abort();
  }, [token]);
  async function save(action: unknown) {
    if (!token) return;
    setBusy(true); setMessage("");
    try {
      const response = await fetch("/api/business", { method: "POST", headers: { Authorization: `Bearer ${token}`, "Content-Type": "application/json" }, body: JSON.stringify(action) });
      const result = await response.json(); if (!response.ok) throw Error(result.error);
      setData(result); setMessage("Guardado. Volvé a consultar Ganancias para aplicar los costos.");
      if ((action as { type: string }).type === "zone") setZoneId((action as { id: string }).id);
    } catch (e) { setMessage((e as Error).message); }
    finally { setBusy(false); }
  }
  const zone = data.zones.find((entry) => entry.id === zoneId);
  return <>
    {!token && <p className="notice">Iniciá sesión para cargar los gastos de tu negocio.</p>}
    {message && <p className="notice" role="status">{message}</p>}
    <section className="panel"><div className="panel-title"><h2>Logística Flex · zonas AMBA</h2></div>
      <p className="table-note">Cargá la provincia y las localidades tal como aparecen en tus pedidos. Cada localidad debe coincidir con una sola zona. Las tarifas se aplican según la fecha de venta y no se suman entre opciones de una publicación.</p>
      <div className="supplier-form"><label>Zona<select value={zoneId} onChange={(e) => setZoneId(e.target.value)}><option value="">Crear zona</option>{data.zones.map((entry) => <option key={entry.id} value={entry.id}>{entry.name}</option>)}</select></label></div>
      <form className="supplier-form" key={`${zoneId}-${JSON.stringify(zone)}`} onSubmit={(event) => {
        event.preventDefault(); const form = new FormData(event.currentTarget);
        void save({ type: "zone", id: zoneId || crypto.randomUUID(), name: form.get("name"), province: form.get("province"), cities: String(form.get("cities")).split(/[\n,;]/).map((value) => value.trim()).filter(Boolean), from: form.get("from"), cents: Math.round(Number(form.get("amount")) * 100) });
      }}>
        <label>Nombre de zona<input name="name" required maxLength={100} defaultValue={zone?.name ?? ""} placeholder="Ej.: Zona oeste" /></label>
        <label>Provincia<input name="province" required defaultValue={zone?.province ?? "Buenos Aires"} /></label>
        <label>Localidades (una por línea)<textarea name="cities" required rows={4} defaultValue={zone?.cities.join("\n") ?? ""} placeholder="Morón&#10;Castelar&#10;Ituzaingó" /></label>
        <label>Tarifa por envío ($)<input name="amount" type="number" min="0" step="0.01" required defaultValue={zone?.rates.at(-1) ? zone.rates.at(-1)!.cents / 100 : ""} /></label>
        <label>Vigente desde<input name="from" type="date" required defaultValue={today()} /></label>
        <button className="primary" disabled={busy || !loaded}>Guardar tarifa</button>
        {zone && <small>Cambiar una tarifa en la misma fecha reemplaza su valor. Usá una fecha nueva para conservar el historial.</small>}
      </form>
      {data.zones.map((entry) => <div className="pending-row" key={entry.id}><div><strong>{entry.name} · {entry.province}</strong><p>{entry.cities.join(", ")}</p>{entry.rates.map((rate) => <p key={rate.from}>Desde {rate.from}: {money(rate.cents)}</p>)}</div></div>)}
    </section>
    <section className="panel pending"><div className="panel-title"><h2>Gastos mensuales</h2></div>
      <p className="table-note">Ingresá publicidad y otros cargos de la factura de Mercado Libre que no estén ya descontados del neto de las ventas. No cargues la factura completa si repite comisiones. Se prorratean por días calendario al filtrar por semana o día.</p>
      <div className="supplier-form"><label>Mes<input type="month" required value={month} onChange={(e) => setMonth(e.target.value)} /></label></div>
      <form className="supplier-form" key={`${month}-${JSON.stringify(data.months[month])}`} onSubmit={(event) => {
        event.preventDefault(); const form = new FormData(event.currentTarget);
        void save({ type: "month", month, taxCents: Math.round(Number(form.get("tax")) * 100), billingCents: Math.round(Number(form.get("billing")) * 100) });
      }}>
        <label>Monotributo del mes ($)<input name="tax" type="number" min="0" step="0.01" required defaultValue={data.months[month] ? data.months[month].taxCents / 100 : ""} /></label>
        <label>Facturación ML: cargos adicionales ($)<input name="billing" type="number" min="0" step="0.01" required defaultValue={data.months[month] ? data.months[month].billingCents / 100 : ""} /></label>
        <small>Ingresá 0 para confirmar que ese mes no hubo ese gasto. Los meses sin cargar quedan pendientes.</small>
        <button className="primary" disabled={busy || !loaded || !month}>Guardar mes</button>
      </form>
      {Object.entries(data.months).sort(([a], [b]) => b.localeCompare(a)).map(([key, value]) => <div className="pending-row" key={key}><strong>{key}</strong><span>Monotributo: {money(value.taxCents)} · Adicionales ML: {money(value.billingCents)}</span><button onClick={() => setMonth(key)}>Editar</button></div>)}
    </section>
  </>;
}
