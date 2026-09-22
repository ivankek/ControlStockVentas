import { admin } from "@/lib/server";
import { runStockWorker } from "@/lib/sale-stock";

export const runtime = "nodejs";
export const maxDuration = 180;
export async function POST(request: Request) {
  const token = /^Bearer ([a-f0-9-]{72})$/.exec(request.headers.get("authorization") ?? "")?.[1];
  if (!token) return Response.json({ error: "unauthorized" }, { status: 401 });
  try {
    const auth = await admin().rpc("authorize_stock_worker", { p_token: token });
    if (auth.error) throw Error("worker_unavailable");
    if (auth.data !== true) return Response.json({ error: "unauthorized" }, { status: 401 });
    return Response.json(await runStockWorker(), { headers: { "Cache-Control": "no-store" } });
  } catch { return Response.json({ error: "worker_unavailable" }, { status: 503 }); }
}
