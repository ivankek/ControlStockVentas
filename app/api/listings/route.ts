import { owner, readState, mutate, fail } from "@/lib/server";
import { fetchListings } from "@/lib/meli-listings";
import { mergeListings, sameListings } from "@/lib/listings";
export const maxDuration = 300;
const running = new Set<string>();

export async function GET(request: Request) {
  try {
    const { state } = await readState(await owner(request));
    return Response.json({ listings: state.listings ?? [] }, { headers: { "Cache-Control": "no-store" } });
  } catch (error) { return fail(error); }
}

export async function POST(request: Request) {
  let lock: string | undefined;
  try {
    const id = await owner(request);
    if (running.has(id)) throw Error("Ya hay una importación de publicaciones en curso.");
    running.add(id); lock = id;
    const { state: baseline } = await readState(id);
    const incoming = await fetchListings(id);
    let counts = { added: 0, updated: 0, unchanged: 0 };
    const state = await mutate(id, (current) => {
      // Do not overwrite a concurrent catalog import with an older API snapshot.
      if (!sameListings(current.listings ?? [], baseline.listings ?? []))
        throw Error("Otra importación modificó las publicaciones. Volvé a actualizar.");
      const result = mergeListings(current.listings ?? [], incoming);
      counts = { added: result.added, updated: result.updated, unchanged: result.unchanged };
      if (!result.added && !result.updated) return current;
      return { ...current, listings: result.listings };
    });
    return Response.json({ listings: state.listings ?? [], ...counts }, { headers: { "Cache-Control": "no-store" } });
  } catch (error) { return fail(error); }
  finally { if (lock) running.delete(lock); }
}
