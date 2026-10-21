import { admin } from "./server";
import { profile, snapshot, accountListings } from "./inventory-server";
import { accessLinkedSupplier, get, type RawOrder } from "./meli";
import { normalizeShipment, type Shipment } from "./shipping";
import { localDate, today } from "./domain";
import { unseal } from "./crypto";
import { nubeGet } from "./tiendanube";
import type { NubeProduct } from "./tiendanube-catalog";
import { dispatchGroup, dispatchMode, pendingShipment, type HomeAccount, type HomeSale, type HomeSales } from "./supplier-home";

export async function supplierAccounts(user: string) {
  if ((await profile(user)).role !== "SUPPLIER") throw Object.assign(Error("Este inicio es exclusivo del proveedor."), { status: 403 });
  const db = admin();
  const relations = await db.from("supplier_sellers").select("seller_user_id").eq("supplier_id", user).eq("active", true);
  if (relations.error) throw Error("No se pudieron consultar las cuentas vinculadas.");
  const owners = relations.data.map((r) => r.seller_user_id);
  if (!owners.length) return [];
  const [meli, nube] = await Promise.all([
    db.from("meli_accounts").select("id,owner_id,seller_id,nickname").in("owner_id", owners),
    db.from("tiendanube_accounts").select("id,owner_id,store_id,name").in("owner_id", owners),
  ]);
  if (meli.error || nube.error) throw Error("No se pudieron consultar las cuentas vinculadas.");
  return [...meli.data.map((a) => ({ id: a.id as string, owner: a.owner_id as string, external: a.seller_id as string, name: a.nickname || a.seller_id, platform: "meli" as const })),
    ...nube.data.map((a) => ({ id: a.id as string, owner: a.owner_id as string, external: a.store_id as string, name: a.name, platform: "nube" as const }))];
}
type Account = Awaited<ReturnType<typeof supplierAccounts>>[number];
export async function supplierCatalog(user: string, a: Account): Promise<HomeAccount> {
  const variants = (await snapshot(user)).variants;
  const names = new Map(variants.map((v) => [v.id, `${v.product_name}${v.name === "Única" ? "" : ` · ${v.name}`}`]));
  if (a.platform === "meli") {
    const items = await accountListings(a.id);
    const mappings: { item_id: string; variation_id: string; variant_id: string; units_per_sale: number }[] = [];
    for (let offset = 0; ; offset += 1000) {
      const { data, error } = await admin().from("listing_mappings").select("item_id,variation_id,variant_id,units_per_sale").eq("account_id", a.id).order("item_id").order("variation_id").range(offset, offset + 999);
      if (error) throw Error("No se pudieron leer las asociaciones.");
      mappings.push(...data); if (data.length < 1000) break;
    }
    const links = new Map(mappings.map((m) => [`${m.item_id}:${m.variation_id}`, m]));
    const listings = items.flatMap((p) => (p.variations.length ? p.variations : [{ id: "0", attribute_combinations: [], attributes: p.attributes, seller_custom_field: p.seller_custom_field }]).map((v) => {
      const key = `${p.id}:${v.id}`, m = links.get(key);
      return { key, title: p.title, variant: v.attribute_combinations.map((x) => x.value_name).filter(Boolean).join(" / "), sku: v.attributes?.find((x) => x.id === "SELLER_SKU")?.value_name || v.seller_custom_field,
        linked: !!m, supplierName: m ? names.get(m.variant_id) : undefined, units: m?.units_per_sale ?? 1 };
    }));
    return { id: a.id, name: a.name, platform: a.platform, listings };
  }
  const { data, error } = await admin().from("tiendanube_accounts").select("products,links").eq("id", a.id).single();
  if (error) throw Error("No se pudo leer el catálogo de Tiendanube.");
  return { id: a.id, name: a.name, platform: a.platform, listings: (data.products as NubeProduct[]).flatMap((p) => p.variants.map((v) => {
    const key = `${p.id}:${v.id}`, link = data.links[key];
    return { key, title: p.title, variant: v.title, sku: v.sku, linked: !!link, supplierName: link ? names.get(link) : undefined, units: 1 };
  })) };
}
export async function supplierSales(user: string, a: Account): Promise<HomeSales> {
  const date = today(), warnings: string[] = [], orders: HomeSale[] = [];
  const catalog = await supplierCatalog(user, a), links = new Map(catalog.listings.map((l) => [l.key, l]));
  const line = (key: string, title: string, quantity: number) => {
    const l = links.get(key);
    if (l?.linked && !l.supplierName) return [];
    return [{ title, quantity, supplierName: l?.supplierName, units: l?.units ?? 1 }];
  };
  if (a.platform === "nube") {
    const { data, error } = await admin().from("tiendanube_accounts").select("encrypted_token").eq("id", a.id).single();
    if (error) throw Error("No se pudo consultar Tiendanube.");
    const { token } = unseal<{token:string}>(data.encrypted_token);
    for (let page = 1; page <= 10; page++) {
      const raw = await nubeGet(a.external, token, `/orders?status=open&payment_status=paid&shipping_status=unfulfilled&page=${page}&per_page=50`).catch((e) => {
        if (/rechazó el acceso|consulta.*\(403\)|consulta.*\(404\)/i.test(e.message)) throw Error("Tiendanube respondió que no se pudo acceder a los pedidos. Revisá el permiso de lectura de pedidos y el ID de tienda. Si acabás de cambiar permisos, reconectá la tienda para renovar la autorización.");
        throw e;
      });
      if (!Array.isArray(raw)) throw Error("Tiendanube devolvió una lista inválida.");
      for (const o of raw) {
        if (o.status !== "open" || o.payment_status !== "paid" || !["unpacked", "unfulfilled"].includes(o.shipping_status)) continue;
        const lines = (o.products ?? []).flatMap((p: {product_id: number; variant_id: number; name: string; quantity: number}) => line(`${p.product_id}:${p.variant_id}`, p.name, p.quantity));
        if (lines.length) orders.push({ id: String(o.id), mode: o.shipping_option || "Tiendanube", group: "review", lines, note: "Pendiente de envío; Tiendanube no informa aquí un plazo de despacho verificable." });
      }
      if (raw.length < 50) break;
      if (page === 10) warnings.push("Tiendanube superó 500 pedidos abiertos. La consulta es parcial.");
    }
  } else {
    const tokens = await accessLinkedSupplier(user, a.owner, a.id), raw = new Map<string, RawOrder>();
    const deadline = Date.now() + 210000;
    for (const status of ["ready_to_ship", "handling", "pending", "to_be_agreed"]) {
      for (let offset = 0; offset < 500; offset += 50) {
        if (Date.now() > deadline) { warnings.push("La consulta alcanzó el tiempo máximo. Actualizá para volver a consultar."); break; }
        const page = await get<{ results: RawOrder[]; paging: {total:number} }>(`/orders/search?seller=${a.external}&order.status=paid&shipping.status=${status}&sort=date_desc&limit=50&offset=${offset}`, tokens.access_token).catch(() => null);
        if (!page) { warnings.push(`No se pudieron consultar los pedidos en estado ${status}. La consulta es parcial.`); break; }
        if (!Array.isArray(page.results) || typeof page.paging?.total !== "number") throw Error("Mercado Libre devolvió una búsqueda incompleta.");
        for (const o of page.results) if (o.status === "paid" && String(o.seller?.id) === a.external) raw.set(String(o.id), o);
        if (offset + 50 >= page.paging.total) break;
        if (offset === 450) warnings.push(`Hay más de 500 pedidos en estado ${status}. La consulta es parcial.`);
      }
    }
    const shipments = new Map<string, Promise<{shipment:Shipment; expected?: string}>>();
    async function shipping(id: string) {
      const shipment = normalizeShipment(await get<Shipment>(`/shipments/${id}`, tokens.access_token));
      if (!pendingShipment(shipment.status, shipment.substatus, shipment.logistic_type)) return { shipment };
      try { const sla = await get<{expected_date?:string}>(`/shipments/${id}/sla`, tokens.access_token); return { shipment, expected: sla.expected_date }; }
      catch { return { shipment }; }
    }
    const pending = [...raw.values()];
    for (let i = 0; i < pending.length; i += 5) {
      if (Date.now() > deadline) { warnings.push("Faltan envíos por consultar; el resultado es parcial."); break; }
      await Promise.all(pending.slice(i, i+5).map(async (o) => {
        const lines = o.order_items.flatMap((p) => line(`${p.item.id}:${p.item.variation_id ?? "0"}`, `${p.item.title}${p.item.variation_attributes?.length ? ` · ${p.item.variation_attributes.map((v) => v.value_name).join(" / ")}` : ""}`, p.quantity));
        if (!lines.length) return;
        const shipmentId = o.shipping?.id ? String(o.shipping.id) : undefined;
        if (!shipmentId) { orders.push({ id: String(o.id), mode: "Acordar / retiro", group: "review", lines, note: "Sin envío ni fecha de despacho informada." }); return; }
        try {
          if (!shipments.has(shipmentId)) shipments.set(shipmentId, shipping(shipmentId));
          const { shipment, expected } = await shipments.get(shipmentId)!;
          if (!pendingShipment(shipment.status, shipment.substatus, shipment.logistic_type)) return;
          const group = dispatchGroup(expected, date); if (group === "future") return;
          orders.push({ id: String(o.id), shipment: shipmentId, lines, group,
            due: expected && Number.isFinite(Date.parse(expected)) ? localDate(expected) : undefined,
            mode: dispatchMode(shipment),
            ...(group === "review" ? { note: "Sin plazo de despacho verificable en Mercado Libre." } : {}) });
        } catch { orders.push({ id: String(o.id), shipment: shipmentId, mode: "Sin verificar", group: "review", lines, note: "No se pudo consultar el estado del envío." }); }
      }));
    }
  }
  // Recheck the active relationship before returning data obtained from a seller's API.
  if (!(await supplierAccounts(user)).some((account) => account.id === a.id && account.platform === a.platform)) throw Object.assign(Error("La cuenta ya no está vinculada al proveedor."), {status:403});
  const rank = { late: 0, today: 1, review: 2 };
  orders.sort((x,y) => rank[x.group]-rank[y.group] || (x.due ?? "").localeCompare(y.due ?? "") || x.id.localeCompare(y.id));
  return { date, orders, warnings: [...new Set(warnings)], updatedAt: new Date().toISOString() };
}
