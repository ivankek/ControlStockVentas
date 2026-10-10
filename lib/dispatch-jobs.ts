import { admin } from "./server";
import { runDispatchQuery } from "./run-dispatch-query";
import type { accountFor } from "./inventory-server";
import type { DispatchQueryResult } from "./dispatch-query";
export type DispatchJob = { id: string; date_from: string; date_to: string; status: "running" | "done" | "failed"; expires_at: string; progress: { stage?: string; done?: number; total?: number }; result?: DispatchQueryResult | null; error?: string | null };
export function visibleJob(job: DispatchJob | null): DispatchJob | null {
  if (!job || Date.parse(job.expires_at) > Date.now()) return job;
  return job.status === "running" ? { ...job, status: "failed", result: null, error: "La consulta excedió el tiempo disponible. Volvé a consultar." } : null;
}
export async function readDispatchJob(owner: string, account: string) {
  const { data, error } = await admin().from("dispatch_query_jobs").select("id,date_from,date_to,status,expires_at,progress,result,error").eq("owner_id", owner).eq("account_id", account).maybeSingle();
  if (error) throw Error("No se pudo recuperar la consulta de despachos.");
  return visibleJob(data);
}
export async function startDispatchJob(owner: string, account: string, from: string, to: string) {
  const { data, error } = await admin().rpc("start_dispatch_query", { p_owner: owner, p_account: account, p_from: from, p_to: to });
  if (error) throw Error("No se pudo iniciar la consulta de despachos.");
  return data as { started: boolean; job: DispatchJob };
}
export async function executeDispatchJob(owner: string, account: Awaited<ReturnType<typeof accountFor>>, job: DispatchJob) {
  const save = async (patch: object) => {
    const { data, error } = await admin().from("dispatch_query_jobs").update(patch).eq("owner_id", owner).eq("account_id", account.id).eq("id", job.id).eq("status", "running").select("id");
    if (error || !data?.length) throw Error("La consulta ya no está activa o no se pudo guardar su avance.");
  };
  try {
    const result = await runDispatchQuery(owner, account, job.date_to, job.date_from, async (stage, done, total) => {
      if (Date.now() >= Date.parse(job.expires_at) - 45000) throw Error("La consulta excedió el tiempo disponible. Probá con un período más corto.");
      await save({ progress: { stage, done, total } });
    });
    await save({ status: "done", result, expires_at: new Date(Date.now() + 15 * 60000).toISOString() });
  } catch (error) {
    await save({ status: "failed", result: null, error: error instanceof Error ? error.message : "No se pudo completar la consulta.", expires_at: new Date(Date.now() + 15 * 60000).toISOString() }).catch(() => {});
  }
}
