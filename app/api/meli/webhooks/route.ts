import {
  NotificationBodyError, notificationSchema, readNotification, topicForLog,
} from "@/lib/meli-webhook";

export const runtime = "nodejs";

function reject(status: number, reason: string) {
  console.warn(JSON.stringify({ event: "meli_webhook_rejected", reason }));
  return Response.json({ error: reason }, { status });
}

export async function POST(request: Request) {
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

  console.info(JSON.stringify({
    event: "meli_webhook_received",
    topic: topicForLog(notification.topic),
    disposition: "acknowledged_only",
  }));
  // Intentionally no persistence, deduplication, API requests or business effects.
  // Before adding effects, verify resources using the connected seller's token
  // and durably enqueue work before acknowledging delivery.
  return Response.json({ received: true });
}
