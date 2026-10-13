"use client";
import { useState } from "react";
import { useInventory } from "./inventory-context";
import { money, today } from "@/lib/domain";
import type { Business } from "@/lib/business";
import { daysBetween, expenseRange, expenseTotal } from "@/lib/business-expenses";

export default function ExpensePeriods({ data, busy, loaded, save }: { data: Business; busy: boolean; loaded: boolean; save: (action: unknown) => Promise<boolean> }) {
  const { account, data: inventory } = useInventory();
  const accountId = account || (inventory?.accounts.length === 1 ? inventory.accounts[0].id : "");
  const [month, setMonth] = useState(today().slice(0, 7));
  const cycle = data.expenseCycles?.[accountId];
  const periods = (data.expensePeriods ?? []).filter((p) => p.accountId === accountId).sort((a, b) => b.from.localeCompare(a.from));
  const existing = periods.find((p) => p.month === month);
  const range = existing ?? expenseRange(month, cycle ?? { startDay: 12, endDay: 12, startMonth: month });
  const unavailable = busy || !loaded || !accountId;
  return <section className="panel expense-periods">
    <div className="panel-title"><h2>Gastos del negocio por período</h2></div>
    <p>Ingresá los importes adicionales que todavía no se descontaron de las ventas. Se restan proporcionalmente en Ganancias, según los días consultados.</p>
    {!accountId && <p className="notice">Seleccioná una cuenta de Mercado Libre para cargar sus gastos.</p>}
    <form className="toolbar" key={accountId + JSON.stringify(cycle)} onSubmit={(event) => {
      event.preventDefault(); const form = new FormData(event.currentTarget);
      void save({ type: "expenseCycle", startDay: Number(form.get("startDay")), endDay: Number(form.get("endDay")), startMonth: form.get("startMonth") });
    }}>
      <label>Día de inicio<input name="startDay" type="number" min="1" max="31" required defaultValue={cycle?.startDay ?? 12} disabled={unavailable} /></label>
      <label>Día de cierre<input name="endDay" type="number" min="1" max="31" required defaultValue={cycle?.endDay ?? 12} disabled={unavailable} /></label>
      <label>Empezar desde el mes<input name="startMonth" type="month" required defaultValue={cycle?.startMonth ?? month} disabled={unavailable} /></label>
      <button disabled={unavailable}>Guardar ciclo mensual</button>
    </form>
    <p className="table-note">Ambas fechas están incluidas. Un ciclo 10–10 va del 10 de un mes al 10 del siguiente; ese día recibe la parte proporcional de ambos períodos si los dos están cargados. Si el mes no tiene el día elegido, se usa su último día. El ciclo se repite; los importes se cargan para cada período. Cambiar el ciclo no modifica períodos ya guardados.</p>
    <label>Mes de inicio del período<input type="month" value={month} required onChange={(event) => { if (event.target.value) setMonth(event.target.value); }} disabled={busy} /></label>
    <form className="shipping-defaults" key={accountId + month + JSON.stringify(cycle) + existing?.updatedAt} onSubmit={async (event) => {
      event.preventDefault(); const form = new FormData(event.currentTarget);
      const amount = (key: string) => Math.round(Number(form.get(key)) * 100);
      await save({ type: "expensePeriod", month, from: form.get("from"), to: form.get("to"), mlCents: amount("ml"), monotributoCents: amount("monotributo"), iibbCents: amount("iibb"), otherCents: amount("other"), note: form.get("note") });
    }}>
      <label>Desde (incluido)<input name="from" type="date" required defaultValue={range.from} disabled={unavailable || !cycle} /></label>
      <label>Hasta (incluido)<input name="to" type="date" required defaultValue={range.to} disabled={unavailable || !cycle} /></label>
      {([
        ["ml", "Factura de Mercado Libre / publicidad adicional ($)", existing?.mlCents],
        ["monotributo", "Monotributo ($)", existing?.monotributoCents],
        ["iibb", "Ingresos Brutos ($)", existing?.iibbCents],
        ["other", "Otros gastos adicionales ($)", existing?.otherCents],
      ] as const).map(([key, label, cents]) => <label key={key}>{label}<input name={key} type="number" min="0" max="1000000000" step="0.01" required defaultValue={cents === undefined ? "" : cents / 100} placeholder="Ingresá 0 si no corresponde" disabled={unavailable || !cycle} /></label>)}
      <label>Detalle (opcional)<input name="note" maxLength={500} defaultValue={existing?.note ?? ""} placeholder="Por ejemplo: publicidad y servicios" disabled={unavailable || !cycle} /></label>
      <button disabled={unavailable || !cycle}>{busy ? "Guardando…" : existing ? "Actualizar importes del período" : "Guardar importes del período"}</button>
    </form>
    {!cycle && <p className="notice">Primero guardá el ciclo mensual.</p>}
    <p className="table-note">No vuelvas a incluir comisiones, retenciones ni publicidad que ya estén descontadas del recibido o incluidas en otro importe de este formulario. No hace falta adjuntar facturas. Un 0 guardado confirma que no hubo gasto; un período sin cargar se informa como pendiente.</p>
    {!!periods.length && <div className="table-wrap"><table><thead><tr><th>Período</th><th>Mercado Libre</th><th>Monotributo</th><th>Ingresos Brutos</th><th>Otros</th><th>Total</th><th>Acciones</th></tr></thead><tbody>{periods.map((p) => <tr key={p.month}>
      <td>{p.from} al {p.to}<small>{daysBetween(p.from, p.to)} días{p.note ? ` · ${p.note}` : ""}</small></td><td>{money(p.mlCents)}</td><td>{money(p.monotributoCents)}</td><td>{money(p.iibbCents)}</td><td>{money(p.otherCents)}</td><td>{money(expenseTotal(p))}</td>
      <td><button disabled={busy} onClick={() => setMonth(p.month)}>Editar</button> <button disabled={busy} onClick={() => { if (window.confirm(`¿Eliminar los gastos del ${p.from} al ${p.to}?`)) void save({ type: "expenseDelete", month: p.month }); }}>Eliminar</button></td>
    </tr>)}</tbody></table></div>}
  </section>;
}
