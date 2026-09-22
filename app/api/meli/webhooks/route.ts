import { after } from "next/server";
import { receiveNotification } from "@/lib/meli-notification-handler";
import { enqueueSale, runStockWorker } from "@/lib/sale-stock";

export const runtime = "nodejs";
export const maxDuration = 180;
export async function POST(request: Request) {
  return receiveNotification(request, { enqueue: enqueueSale, schedule: () => after(async () => {
    try { await runStockWorker(); }
    catch { console.warn(JSON.stringify({ event: "stock_worker_interrupted" })); }
  }) });
}
