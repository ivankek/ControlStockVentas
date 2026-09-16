"use client";
import { useEffect, useState } from "react";
import { emptyBusiness, type Business } from "@/lib/business";
import { money, today } from "@/lib/domain";

export default function BusinessCosts({ token }: { token?: string }) {
  const [data, setData] = useState<Business>(emptyBusiness);
  const [busy, setBusy] = useState(false);
  const [message, setMessage] = useState("");
  const [loaded, setLoaded] = useState(false);

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

    } catch (e) { setMessage((e as Error).message); }
    finally { setBusy(false); }
  }

  return <>
    {!token && <p className="notice">Iniciá sesión para cargar los gastos de tu negocio.</p>}
    {message && <p className="notice" role="status">{message}</p>}
    <section className="panel"><div className="panel-title"><h2>Envíos</h2></div>
      <div className="shipping-defaults">
        <div><strong>Flex · todas las zonas</strong><span>$5.000 por envío</span><p>Tarifa provisoria aplicada a todos los períodos. La configuración por zona y el mapa quedan para más adelante.</p></div>
        <div><strong>Mercado Envíos · correo</strong><span>Sin descuento adicional</span><p>Se parte del neto recibido de la venta.</p></div>
        <div><strong>Acordar con el comprador</strong><span>Costo manual por venta</span><p>Completalo en Despachos o en el detalle de Ganancias.</p></div>
      </div>
    </section>    <section className="panel pending"><div className="panel-title"><h2>Gastos mensuales</h2></div>
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
