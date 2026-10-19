import { after } from "next/server";
import { owner, fail, readState } from "@/lib/server";
import { today } from "@/lib/domain";
import { dateSchema } from "@/lib/commands";
import { accountFor, requestedAccount, scopedBusiness } from "@/lib/inventory-server";
import { applyDispatchNotes } from "@/lib/dispatch-query";
import { runDispatchQuery } from "@/lib/run-dispatch-query";
import { executeDispatchJob, readDispatchJob, startDispatchJob } from "@/lib/dispatch-jobs";
export const maxDuration = 300;
export async function GET(request: Request) {
  try {
    const id = await owner(request);
    const account = await accountFor(id, requestedAccount(request));
    let job = await readDispatchJob(id, account.id);
    if (job?.status === "done" && job.result) {
      // Results created before per-order totals cannot be safely recalculated.
      if (job.result.days?.some((day) => day.supplier.orders.some((order) => !order.rows))) job = null;
      else {
        const business = await scopedBusiness(id, account, (await readState(id)).state.business);
        job = { ...job, result: applyDispatchNotes(job.result, business.notes) };
      }
    }
    return Response.json({ job }, { headers: { "Cache-Control": "no-store" } });
  } catch (error) { return fail(error); }
}
export async function POST(request: Request) {
  try {
    const id = await owner(request);
    const { date, from, background } = await request.json();
    const selected = dateSchema.parse(date);
    const start = dateSchema.parse(from ?? date);
    if (start > selected) throw Error("La fecha desde debe ser anterior o igual a la fecha hasta.");
    if (selected > today()) throw Error("Elegí una fecha hasta hoy.");
    const account = await accountFor(id, requestedAccount(request));
    if (background === true) {
      const { job, started } = await startDispatchJob(id, account.id, start, selected);
      if (started) after(() => executeDispatchJob(id, account, job));
      return Response.json({ job }, { status: 202, headers: { "Cache-Control": "no-store" } });
    }
    // Compatibility for existing clients. New UI uses the recoverable job.
    return Response.json(await runDispatchQuery(id, account, selected, start), { headers: { "Cache-Control": "no-store" } });
  } catch (e) { return fail(e); }
}
