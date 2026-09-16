import { z } from "zod";
import { owner, fail } from "@/lib/server";
import { salesPage } from "@/lib/meli-profit";
import { today } from "@/lib/domain";
export const maxDuration = 300;
const schema = z.object({ from: z.iso.date(), to: z.iso.date(), offset: z.number().int().min(0).max(9950).default(0) });
export async function POST(request: Request) {
  try {
    const user = await owner(request);
    const { from, to, offset } = schema.parse(await request.json());
    if (from > to || to > today() || Date.parse(to) - Date.parse(from) > 366 * 86400000) throw Error("Revisá el período de consulta (hasta un año).");
    return Response.json(await salesPage(user, from, to, offset), { headers: { "Cache-Control": "no-store" } });
  } catch (error) { return fail(error); }
}
