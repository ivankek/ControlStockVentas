"use client";
import { useEffect, useRef, useState } from "react";
type Job = { account_id: string; item_id: string; title: string; status: string; error: string | null; updated_at: string };
type Sale = { order_id: string; status: string; error: string | null; warning: string | null; updated_at: string };
export default function StockSync({ token, revision, onUpdated }: { token?: string; revision: unknown; onUpdated: () => void }) {
  const updated = useRef(onUpdated);
  updated.current = onUpdated;
  const [jobs, setJobs] = useState<Job[]>([]), [error, setError] = useState("");
  const [sales, setSales] = useState<Sale[]>([]);
  const lastStatus = useRef("");
  const [retry, setRetry] = useState(0);
  const [dismissed, setDismissed] = useState("");
  const retryRequested = useRef(false);
  useEffect(() => {
    if (!token) { setJobs([]); setSales([]); setDismissed(""); lastStatus.current = ""; return; }
    let stopped = false;
    let timer: ReturnType<typeof setTimeout>;
    async function call(body?: object) {
      const response = await fetch("/api/inventory/sync", { method: body ? "POST" : "GET", headers: { Authorization: `Bearer ${token}`, "Content-Type": "application/json" }, body: body ? JSON.stringify(body) : undefined });
      const data = await response.json();
      if (!response.ok) throw Error(data.error || "No se pudo sincronizar el stock.");
      return data as { jobs: Job[]; sales: Sale[]; processed?: boolean };
    }
    async function tick() {
      try {
        let result = await call();
        if (stopped) return;
        const retryOne = retryRequested.current;
        retryRequested.current = false;
        if (retryOne || result.jobs.some((j) => ["pending", "running"].includes(j.status))) result = await call({ retry: retryOne });
        if (!stopped) {
          setJobs(result.jobs); setSales(result.sales); setError("");
          const fingerprint = JSON.stringify([result.jobs, result.sales]);
          const changed = lastStatus.current && lastStatus.current !== fingerprint;
          lastStatus.current = fingerprint;
          if (result.processed || changed) updated.current();
        }
      } catch (e) { if (!stopped) setError((e as Error).message); }
      finally { if (!stopped) timer = setTimeout(() => void tick(), 4000); }
    }
    void tick();
    return () => { stopped = true; clearTimeout(timer); };
  }, [token, revision, retry]);
  if (!token) return null;
  const pending = jobs.filter((j) => ["pending", "running"].includes(j.status));
  const failed = jobs.filter((j) => j.status === "error");
  const saleIssues = sales.filter((s) => s.error || s.warning);
  const salePending = sales.filter((s) => s.status !== "done");
  if (!jobs.length && !sales.length && !error) return null;
  const noticeKey = JSON.stringify([error, failed.map((j) => [j.account_id, j.item_id, j.error]).sort(), saleIssues.map((s) => [s.order_id, s.error, s.warning]).sort(), pending.map((j) => `${j.account_id}:${j.item_id}`).sort(), salePending.map((s) => s.order_id).sort()]);
  if (dismissed === noticeKey) return <button className="sync-show" onClick={() => setDismissed("")}>Mostrar estado de sincronización</button>;
  if (!pending.length && !failed.length && !sales.length && !error) return null;
  return <section className={failed.length || saleIssues.length || error ? "warning" : "notice"} aria-label="Sincronización de stock">
    <button type="button" className="sync-dismiss" aria-label="Ocultar aviso de sincronización" onClick={() => setDismissed(noticeKey)}>Cerrar aviso ×</button>
    <p role="status">{error || (pending.length ? `Stock guardado. ${pending.length} publicaciones pendientes de actualizar en Mercado Libre.` : failed.length ? "Hay publicaciones cuyo stock no se pudo actualizar." : jobs.length ? "Últimas actualizaciones de stock confirmadas por Mercado Libre." : "Control de stock por ventas.")}</p>
    {!!salePending.length && <p>{salePending.length} ventas pendientes de verificar. El procesamiento continúa en segundo plano.</p>}
    {!!saleIssues.length && <details><summary>Ventas para revisar ({saleIssues.length})</summary>{saleIssues.map((s) => <p key={s.order_id}><strong>Orden {s.order_id}</strong><br />{s.error || s.warning}</p>)}</details>}
    {!!failed.length && <details><summary>Ver errores ({failed.length})</summary>{failed.map((j) => <p key={`${j.account_id}:${j.item_id}`}><strong>{j.item_id} · {j.title}</strong><br />{j.error}</p>)}<button onClick={() => { retryRequested.current = true; setRetry((n) => n + 1); }}>Reintentar una actualización</button></details>}
  </section>;
}
