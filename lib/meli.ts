import { admin, required } from "./server";
import { randomUUID } from "node:crypto";
import { accountFor, sellerProfile } from "./inventory-server";
import { seal, unseal } from "./crypto";
import { flexDate, localDate, Order, Product, State } from "./domain";
import { shipmentDestination, dispatchEvidence, normalizeShipment, History, Shipment } from "./shipping";
type Tokens = {
  access_token: string;
  refresh_token: string;
  expires_at: number;
  user_id: number;
};
export async function exchange(
  params: Record<string, string>,
): Promise<Tokens> {
  const response = await fetch("https://api.mercadolibre.com/oauth/token", {
    method: "POST",
    headers: { "Content-Type": "application/x-www-form-urlencoded" },
    body: new URLSearchParams({
      ...params,
      client_id: required("MELI_CLIENT_ID"),
      client_secret: required("MELI_CLIENT_SECRET"),
    }),
    signal: AbortSignal.timeout(30000),
  });
  if (!response.ok)
    throw Error(
      "Mercado Libre no pudo autorizar la conexión. Revisá la aplicación y volvé a conectar.",
    );
  const raw = await response.json();
  if (
    !raw.access_token ||
    !raw.refresh_token ||
    !raw.user_id ||
    !raw.expires_in
  )
    throw Error("Respuesta de autorización incompleta.");
  return { ...raw, expires_at: Date.now() + Number(raw.expires_in) * 1000 };
}
export async function saveTokens(id: string, tokens: Tokens) {
  await sellerProfile(id);
  let nickname: string | null = null;
  try { nickname = (await get<{ nickname?: string }>(`/users/${tokens.user_id}`, tokens.access_token)).nickname ?? null; } catch { /* Nickname is optional; OAuth identity is authoritative. */ }
  const { error } = await admin().rpc("save_meli_account", { p_actor: id, p_seller: String(tokens.user_id), p_tokens: seal(tokens), p_nickname: nickname });
  if (error) throw Error(error.code === "P0001" ? error.message : "No se pudo guardar la conexión de Mercado Libre.");
}
export async function access(id: string, accountId?: string) {
  const account = await accountFor(id, accountId);
  for (let attempt = 0; attempt < 40; attempt++) {
    const { data, error } = await admin().from("meli_accounts").select("encrypted_tokens").eq("id", account.id).eq("owner_id", id).single();
    if (error || !data) throw Error("No se pudo leer la cuenta conectada.");
    const tokens = unseal<Tokens>(data.encrypted_tokens);
    if (String(tokens.user_id) !== account.seller_id) throw Error("La identidad de la cuenta no coincide.");
    if (tokens.expires_at >= Date.now() + 120000) return tokens;
    const lease = randomUUID();
    const locked = await admin().rpc("lease_meli_refresh", { p_actor: id, p_account: account.id, p_lease: lease, p_expected: data.encrypted_tokens });
    if (locked.error) throw Error("No se pudo renovar la conexión.");
    if (!locked.data) { await new Promise((resolve) => setTimeout(resolve, 1000)); continue; }
    try {
      const refreshed = await exchange({ grant_type: "refresh_token", refresh_token: tokens.refresh_token });
      if (String(refreshed.user_id) !== account.seller_id) throw Error("Identidad inválida al renovar.");
      const saved = await admin().rpc("finish_meli_refresh", { p_actor: id, p_account: account.id, p_lease: lease, p_tokens: seal(refreshed) });
      if (saved.error || !saved.data) throw Error("No se guardó la renovación. Volvé a conectar la cuenta.");
      return refreshed;
    } catch (e) {
      await admin().rpc("finish_meli_refresh", { p_actor: id, p_account: account.id, p_lease: lease, p_tokens: null });
      throw e;
    }
  }
  throw Error("Hay otra renovación en curso. Volvé a intentar.");
}
export async function get<T>(path: string, token: string): Promise<T> {
  for (let attempt = 0; attempt < 3; attempt++) {
    const response = await fetch(`https://api.mercadolibre.com${path}`, {
      headers: { Authorization: `Bearer ${token}`, "x-format-new": "true" },
      cache: "no-store",
      signal: AbortSignal.timeout(30000),
    });
    if (response.ok) return response.json();
    if ([429, 500, 502, 503, 504].includes(response.status) && attempt < 2) {
      await new Promise((r) => setTimeout(r, 500 * (attempt + 1)));
      continue;
    }
    if (response.status === 401)
      throw Error(
        "La autorización de Mercado Libre venció. Volvé a conectar tu cuenta.",
      );
    throw Error(
      `Mercado Libre no pudo completar la consulta (${response.status}). No se guardó una sincronización parcial.`,
    );
  }
  throw Error("No se pudo consultar Mercado Libre.");
}
export type RawOrder = {
  id: number;
  date_created: string;
  status: string;
  total_amount?: number;
  currency_id?: string;
  payments?: { id: number; status: string }[];
  buyer?: { first_name?: string; last_name?: string; nickname?: string };
  seller?: { id: number };
  shipping?: { id: number | null };
  order_items: {
    item: {
      id: string;
      title: string;
      variation_id?: number;
      variation_attributes?: { name: string; value_name: string }[];
    };
    quantity: number;
  }[];
};

export async function verifiedOrder(user: string, id: string, accountId?: string): Promise<Order> {
  const tokens = await access(user, accountId);
  const raw = await get<RawOrder>(`/orders/${encodeURIComponent(id)}`, tokens.access_token);
  if (String(raw.id) !== id || raw.seller?.id !== tokens.user_id) throw Error("La venta no pertenece a la cuenta conectada.");
  let mode: Order["mode"] = "acordar";
  if (raw.shipping?.id) {
    const shipment = normalizeShipment(await get<Shipment>(`/shipments/${raw.shipping.id}`, tokens.access_token));
    mode = shipment.logistic_type === "self_service" ? "flex" : shipment.mode === "me2" ? "correo" : "acordar";
  }
  return { id, mode, createdAt: raw.date_created, cancelled: raw.status === "cancelled", lines: [] };
}
type Search = { results: RawOrder[]; paging: { total: number } };
// Only one sync per account in this Node process. Database writes are separately atomic.
const running = new Set<string>();
export async function importOrders(user: string, previous: State, queryDate?: string, accountId?: string, queryFrom?: string) {
  if (running.has(user)) throw Error("Ya hay una actualización en curso.");
  running.add(user);
  try {
    const tokens = await access(user, accountId);
    const raw = new Map<string, RawOrder>();
    const from = new Date((queryDate ? Date.parse(`${queryFrom ?? queryDate}T00:00:00-03:00`) : Date.now()) - 90 * 86400000).toISOString();
    const until = queryDate ? `&order.date_created.to=${encodeURIComponent(`${queryDate}T23:59:59.999-03:00`)}` : "";
    let total = Infinity;
    for (let offset = 0; offset < total; offset += 50) {
      if (offset >= 10000)
        throw Error(
          "La consulta supera 10.000 ventas. Es necesario dividir la importación por períodos antes de continuar.",
        );
      const page = await get<Search>(
        `/orders/search?seller=${tokens.user_id}&order.date_created.from=${encodeURIComponent(from)}${until}&sort=date_desc&limit=50&offset=${offset}`,
        tokens.access_token,
      );
      if (
        !Array.isArray(page.results) ||
        typeof page.paging?.total !== "number"
      )
        throw Error("Mercado Libre devolvió una lista de ventas inesperada.");
      total = page.paging.total;
      for (const o of page.results) raw.set(String(o.id), o);
      if (!page.results.length && offset < total)
        throw Error("La lista de ventas quedó incompleta. Volvé a intentar.");
    }
    // Retain older tracked orders, including settled ones, to detect later cancellations.
    for (const o of previous.orders)
      if (!raw.has(o.id))
        raw.set(
          o.id,
          await get<RawOrder>(
            `/orders/${encodeURIComponent(o.id)}`,
            tokens.access_token,
          ),
        );
    const orders: Order[] = [];
    const products = new Map<string, Product>();
    const shipments = new Map<
      string,
      { shipment: Shipment; history: History }
    >();
    for (const o of raw.values()) {
      if (o.seller?.id && o.seller.id !== tokens.user_id)
        throw Error("Se recibió una venta de otra cuenta.");
      if (!o.date_created || !Array.isArray(o.order_items))
        throw Error("Se recibió un pedido incompleto.");
      const id = String(o.id);
      const old = previous.orders.find((p) => p.id === id);
      if (o.status !== "paid" && o.status !== "partially_refunded" && !old && !queryDate)
        continue;
      const lines = o.order_items.map((line) => {
        if (!Number.isInteger(line.quantity) || line.quantity <= 0)
          throw Error("Una venta tiene cantidades no válidas.");
        const productId = `${line.item.id}:${line.item.variation_id ?? 0}`;
        const variant = line.item.variation_attributes
          ?.map((v) => v.value_name)
          .join(" / ");
        products.set(productId, {
          id: productId,
          name: line.item.title + (variant ? ` · ${variant}` : ""),
          costs: [],
        });
        return { productId, quantity: line.quantity };
      });
      const order: Order = {
        id,
        orderStatus: o.status,
        buyerName: [o.buyer?.first_name, o.buyer?.last_name].filter(Boolean).join(" ").trim() || o.buyer?.nickname || undefined,
        createdAt: o.date_created,
        mode: "acordar",
        cancelled: o.status === "cancelled",
        lines,
      };
      if (o.shipping?.id) {
        const sid = String(o.shipping.id);
        let info = shipments.get(sid);
        if (!info) {
          const shipment = normalizeShipment(await get<Shipment>(
            `/shipments/${sid}`,
            tokens.access_token,
          ));
          const history =
            shipment.mode === "me2"
              ? await get<History>(
                  `/shipments/${sid}/history`,
                  tokens.access_token,
                )
              : [];
          if (!Array.isArray(history))
            throw Error(
              "El historial de un envío no tiene el formato esperado.",
            );
          info = { shipment, history };
          shipments.set(sid, info);
        }
        const s = info.shipment;
        order.receiverName = s.destination?.receiver_name ?? s.receiver_address?.receiver_name;
        Object.assign(order, shipmentDestination(s));
        order.shippingStatus = s.status;
        order.shipmentId = sid;
        order.mode =
          s.logistic_type === "self_service"
            ? "flex"
            : s.mode === "me2"
              ? "correo"
              : "acordar";
        const expected = s.shipping_option?.estimated_delivery_time?.date;
        order.expectedDate = expected
          ? localDate(expected)
          : order.mode === "flex"
            ? flexDate(o.date_created)
            : undefined;
        const event = dispatchEvidence(s, queryDate ? info.history.filter((e) => e.status === "shipped") : info.history);
        if (event && order.mode !== "acordar") {
          if (queryDate || process.env.MELI_DISPATCH_RULES_VERIFIED === "true") {
            order.dispatchedDate = event.date;
            order.evidence = event.evidence;
          } else {
            order.suggestedDate = event.date;
            order.review = "Validar la fecha de despacho con un pedido real";
            order.evidence = event.evidence;
          }
        }
        if (["not_delivered", "cancelled"].includes(s.status))
          order.review =
            "Envío cancelado o no entregado: revisar con el proveedor";
        if (s.logistic_type === "fulfillment")
          order.review = "Logística Full fuera del alcance inicial";
        if (!event && s.status === "delivered")
          order.review = "Entregado sin fecha de despacho verificable";
      }
      if (o.status === "partially_refunded")
        order.review = "Reembolso parcial: revisar con el proveedor";
      if (order.cancelled && old?.dispatchedDate)
        order.review = "Cancelación posterior al despacho: revisar ajuste";
      orders.push(order);
    }
    return {
      orders,
      products: [...products.values()],
      syncedAt: new Date().toISOString(),
      syncWarning: `Importación de ventas de los últimos 90 días y pedidos ya registrados. Ventas anteriores no importadas requieren revisión.${process.env.MELI_DISPATCH_RULES_VERIFIED !== "true" ? " Detección automática pendiente de validación con tus envíos reales." : ""}`,
    };
  } finally {
    running.delete(user);
  }
}
export function mergeImport(
  state: State,
  result: Awaited<ReturnType<typeof importOrders>>,
): State {
  const next = structuredClone(state);
  for (const product of result.products) {
    const existing = next.products.find((p) => p.id === product.id);
    if (existing) existing.name = product.name;
    else next.products.push(product);
  }
  for (const order of result.orders) {
    const index = next.orders.findIndex((o) => o.id === order.id);
    const old = next.orders[index];
    if (old?.dispatchedDate) {
      order.dispatchedDate = old.dispatchedDate;
      order.evidence = old.evidence;
      if (
        old.evidence === "Confirmado manualmente" &&
        order.review === "Validar la fecha de despacho con un pedido real"
      )
        delete order.review;
    }
    if (index < 0) next.orders.push(order);
    else next.orders[index] = order;
  }
  next.syncedAt = result.syncedAt;
  next.syncWarning = result.syncWarning;
  return next;
}
