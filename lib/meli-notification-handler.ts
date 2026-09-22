import {
  NotificationBodyError, notificationSchema, readNotification, topicForLog,
} from "./meli-webhook";

function reject(status: number, reason: string) {
  console.warn(JSON.stringify({ event: "meli_webhook_rejected", reason }));
  return Response.json({ error: reason }, { status });
}

export async function receiveNotification(request: Request, deps: {
  enqueue: (sellerId: string, orderId: string) => Promise<boolean>;
  schedule: () => void;
}) {
  const applicationId = process.env.MELI_CLIENT_ID?.trim();
  if (!applicationId || !/^[1-9]\d*$/.test(applicationId))
    return reject(503, "webhook_not_configured");

  let payload: unknown;
  try {
    payload = await readNotification(request);
  } catch (error) {
    if (error instanceof NotificationBodyError)
      return reject(error.status, error.reason);
    return reject(400, "invalid_body");
  }
  const parsed = notificationSchema.safeParse(payload);
  if (!parsed.success) return reject(400, "invalid_notification");
  const notification = parsed.data;
  // This checks the destination application, NOT authenticity. No signature
  // protocol is specified in the Mercado Libre notifications guide consulted.
  if (notification.application_id !== applicationId)
    return reject(403, "application_mismatch");

  let queued = false;
  const orderId = /^\/orders\/([1-9]\d{0,31})$/.exec(notification.resource)?.[1];
  if (notification.topic === "orders_v2" && orderId) {
    try { queued = await deps.enqueue(notification.user_id, orderId); }
    catch { return reject(503, "queue_unavailable"); }
  }
  if (queued) {
    // Durable before acknowledgment; cron recovers a failed background dispatch.
    try { deps.schedule(); } catch { /* Already persisted. */ }
  }
  console.info(JSON.stringify({
    event: "meli_webhook_received",
    topic: topicForLog(notification.topic),
    disposition: queued ? "queued" : "ignored",
  }));
  return Response.json({ received: true });
}
