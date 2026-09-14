import { z } from "zod";

// Validate only the common envelope; topic-specific fields may evolve independently.
const identifier = z.union([
  z.number().int().positive().max(Number.MAX_SAFE_INTEGER).transform(String),
  z.string().regex(/^[1-9]\d*$/).max(32),
]);
export const notificationSchema = z.object({
  topic: z.string().trim().min(1).max(256),
  resource: z.string().trim().min(1).max(4096),
  user_id: identifier,
  application_id: identifier,
});

const knownTopics = new Set([
  "orders_v2", "items", "shipments", "stock-location", "stock_locations",
  "user_products", "user_products_families", "user-products-families",
]);

// Never log arbitrary payload text, resource URLs, headers or account identifiers.
export function topicForLog(topic: string) {
  return knownTopics.has(topic) ? topic : "unknown";
}

export const MAX_NOTIFICATION_BYTES = 64 * 1024;
export class NotificationBodyError extends Error {
  constructor(public readonly status: number, public readonly reason: string) {
    super(reason);
  }
}

export async function readNotification(request: Request): Promise<unknown> {
  const reader = request.body?.getReader();
  if (!reader) throw new NotificationBodyError(400, "invalid_json");
  let size = 0;
  const chunks: Uint8Array[] = [];
  try {
    while (true) {
      const { done, value } = await reader.read();
      if (done) break;
      size += value.byteLength;
      if (size > MAX_NOTIFICATION_BYTES) {
        void reader.cancel().catch(() => {});
        throw new NotificationBodyError(413, "payload_too_large");
      }
      chunks.push(value);
    }
    return JSON.parse(Buffer.concat(chunks).toString("utf8"));
  } catch (error) {
    if (error instanceof NotificationBodyError) throw error;
    throw new NotificationBodyError(400, "invalid_json");
  } finally {
    reader.releaseLock();
  }
}
