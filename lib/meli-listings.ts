import { access, get } from "./meli";
import { normalizeListing, type Listing } from "./listings";

export async function fetchListings(owner: string): Promise<Listing[]> {
  const tokens = await access(owner);
  const ids = new Set<string>();
  let scroll: string | undefined;
  // Complete discovery before fetching detail, so the scan cursor does not expire.
  while (true) {
    const page = await get<{ results: string[] | null; scroll_id?: string } | null>(
      `/users/${tokens.user_id}/items/search?search_type=scan&limit=100${scroll ? `&scroll_id=${encodeURIComponent(scroll)}` : ""}`,
      tokens.access_token,
    );
    if (page === null || page.results === null) break;
    if (!Array.isArray(page.results)) throw Error("La lista de publicaciones tiene un formato inesperado.");
    if (!page.results.length) break;
    const before = ids.size;
    for (const id of page.results) {
      if (typeof id !== "string" || !/^[A-Z]+\d+$/.test(id)) throw Error("Identificador de publicación inválido.");
      ids.add(id);
    }
    if (ids.size > 10000) throw Error("Esta importación supera 10.000 publicaciones. No se guardaron cambios.");
    if (before === ids.size || !page.scroll_id) throw Error("No se pudo completar la paginación. Volvé a intentar.");
    scroll = page.scroll_id;
  }
  const items: Listing[] = [];
  const list = [...ids];
  for (let offset = 0; offset < list.length; offset += 5) {
    // Wait for the whole batch, including failures, before releasing the import lock.
    const batch = await Promise.allSettled(list.slice(offset, offset + 5).map(async (id) => {
      const item = normalizeListing(await get(`/items/${id}`, tokens.access_token), tokens.user_id);
      if (item.id !== id) throw Error("La publicación recibida no coincide con la solicitada.");
      return item;
    }));
    for (const result of batch) {
      if (result.status === "rejected") throw result.reason;
      items.push(result.value);
    }
  }
  return items;
}
