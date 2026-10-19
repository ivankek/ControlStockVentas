import { z } from "zod";
import { owner, fail } from "@/lib/server";
import { accountFor, requestedAccount } from "@/lib/inventory-server";
import { access } from "@/lib/meli";
import { readReturnResource } from "@/lib/meli-returns-read";
import { returnsPage } from "@/lib/dispatch-returns";

export const maxDuration = 300;
const schema = z.object({ from: z.iso.date(), to: z.iso.date(), offset: z.number().int().min(0).max(9960).default(0) });
export async function POST(request: Request) {
  try {
    const user = await owner(request);
    const account = await accountFor(user, requestedAccount(request));
    const { from, to, offset } = schema.parse(await request.json());
    if (from > to || Date.parse(to) - Date.parse(from) > 366 * 86400000) throw Error("Revisá el período de devoluciones.");
    const token = await access(user, account.id);
    return Response.json(await returnsPage((path) => readReturnResource(path, token.access_token), String(token.user_id), from, to, offset), { headers: { "Cache-Control": "no-store" } });
  } catch (error) { return fail(error); }
}
