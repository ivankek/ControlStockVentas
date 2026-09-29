import { z } from "zod";
import { owner, fail } from "@/lib/server";
import { accountFor, requestedAccount } from "@/lib/inventory-server";
import { access } from "@/lib/meli";
import { flexCredits } from "@/lib/flex-credits";
import { today } from "@/lib/domain";
export const maxDuration = 300;
export async function POST(request: Request) {
  try {
    const user = await owner(request);
    const { from } = z.object({ from: z.iso.date() }).parse(await request.json());
    if (from > today() || Date.parse(today()) - Date.parse(from) > 366 * 86400000) throw Error("Revisá el período de bonificaciones (hasta un año).");
    const account = await accountFor(user, requestedAccount(request));
    const tokens = await access(user, account.id);
    return Response.json({ credits: await flexCredits(tokens.access_token, from) }, { headers: { "Cache-Control": "no-store" } });
  } catch (error) { return fail(error); }
}
