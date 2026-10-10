import { after } from "next/server";
import { owner, fail } from "@/lib/server";
import { today } from "@/lib/domain";
import { dateSchema } from "@/lib/commands";
import { accountFor, requestedAccount } from "@/lib/inventory-server";
import { runDispatchQuery } from "@/lib/run-dispatch-query";
import { executeDispatchJob, readDispatchJob, startDispatchJob } from "@/lib/dispatch-jobs";
export const maxDuration = 300;
export async function GET(request: Request) {
  try {
    const id = await owner(request);
    const account = await accountFor(id, requestedAccount(request));
    return Response.json({ job: await readDispatchJob(id, account.id) }, { headers: { "Cache-Control": "no-store" } });
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
