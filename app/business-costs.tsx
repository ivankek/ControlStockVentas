"use client";
import { useViewState } from "./view-state";
import { useEffect, useState } from "react";
import { emptyBusiness, resolveFlex, type Business } from "@/lib/business";
import { FLEX_ZONES, FLEX_LABELS } from "@/lib/flex-zones";
import { money, today } from "@/lib/domain";
import FlexCarrier from "./flex-carrier";

export default function BusinessCosts({ token }: { token?: string }) {
  const [data, setData] = useViewState<Business>("app/business-costs.tsx:data", emptyBusiness);
  const [busy, setBusy] = useState(false);
  const [message, setMessage] = useState("");
  const [loaded, setLoaded] = useViewState("app/business-costs.tsx:loaded", false);

  useEffect(() => {
    const controller = new AbortController();
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
    <FlexCarrier token={token} />
    <section className="panel"><div className="panel-title"><h2>Envíos</h2></div>
      <div className="shipping-defaults">
        {FLEX_ZONES.map((zone) => <div key={zone}><strong>Flex · {FLEX_LABELS[zone]}</strong><span>{money(resolveFlex(data, {}, today(), zone).cents!)} por envío</span>
          <details><summary>Editar tarifa</summary><form key={JSON.stringify(data.flexRates?.[zone])} onSubmit={(event) => {
            event.preventDefault(); const form = new FormData(event.currentTarget);
            void save({ type: "flexRate", zone, from: form.get("from"), cents: Math.round(Number(form.get("amount")) * 100) });
          }}><label>Precio ($)<input name="amount" type="number" min="0" step="0.01" required defaultValue={resolveFlex(data, {}, today(), zone).cents! / 100} /></label><label>Vigente desde<input name="from" type="date" required defaultValue={today()} /></label><button disabled={busy || !loaded}>Guardar tarifa</button></form>
          {data.flexRates?.[zone]?.map((r) => <p key={r.from}>Desde {r.from}: {money(r.cents)}</p>)}</details></div>)}
        <div><strong>Mercado Envíos · correo</strong><span>Sin descuento adicional</span><p>Se parte del neto recibido de la venta.</p></div>
        <div><strong>Acordar con el comprador</strong><span>Costo manual por venta</span><p>Completalo en Despachos o en el detalle de Ganancias.</p></div>
      </div>
      <p className="table-note">Flex se estima según municipio y localidad del destino. La Matanza se clasifica por localidad. Si no hay coincidencia confiable, la zona queda pendiente y podés elegirla en Despachos o Ganancias. Las tarifas base actuales se usan también para fechas antiguas sin una tarifa cargada; no representan costos históricos verificados. La vigencia se compara con la fecha de la venta. El costo se cuenta una sola vez por envío.</p>
    </section>
  </>;
}
