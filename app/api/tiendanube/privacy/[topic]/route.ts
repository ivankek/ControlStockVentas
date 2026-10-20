import { z } from "zod";
import { admin, required } from "@/lib/server";
import { validNubeSignature } from "@/lib/tiendanube-auth";

const topics: Record<string, string> = {
  "store-redact": "app/store_redact",
  "customers-redact": "customers/redact",
  "customers-data-request": "customers/data_request",
};
export async function POST(request: Request, context: { params: Promise<{ topic: string }> }) {
  const { topic } = await context.params;
  if (!Object.hasOwn(topics, topic)) return new Response(null, { status: 404 });
  try {
    const body = await request.text();
    if (!validNubeSignature(body, request.headers.get("x-linkedstore-hmac-sha256"), required("TIENDANUBE_CLIENT_SECRET"))) {
      return new Response(null, { status: 401 });
    }
    const parsed = z.object({ store_id: z.union([z.number().int().positive(), z.string().regex(/^\d+$/)]).transform(String), event: z.string().optional() }).safeParse(JSON.parse(body));
    if (!parsed.success || (parsed.data.event && parsed.data.event !== topics[topic])) return new Response(null, { status: 400 });
    if (topic === "store-redact") {
      // Catalog, mappings and encrypted credentials are all contained in this row.
      const { error } = await admin().from("tiendanube_accounts").delete().eq("store_id", parsed.data.store_id);
      if (error) return new Response(null, { status: 503 });
    }
    // The catalog-only integration stores no customer or order data. Never persist
    // the incoming payload (which may itself contain personal information).
    return Response.json({ processed: true, ...(topic === "customers-data-request" ? { customer_data: [], orders: [], message: "Despachos no almacena datos de clientes ni pedidos de Tiendanube." } : {}) }, { headers: { "Cache-Control": "no-store" } });
  } catch { return new Response(null, { status: 503 }); }
}
