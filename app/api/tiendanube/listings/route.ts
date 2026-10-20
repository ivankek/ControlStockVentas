import { z } from "zod";
import { admin, owner, fail } from "@/lib/server";
import { snapshot } from "@/lib/inventory-server";
import { nubeAccount, fetchNubeProducts } from "@/lib/tiendanube";
import { skuPlan } from "@/lib/sku";
import type { NubeProduct } from "@/lib/tiendanube-catalog";
export const maxDuration = 300;
export async function GET(request: Request) {
  try {
    const a = await nubeAccount(await owner(request), new URL(request.url).searchParams.get("account"));
    return Response.json({ products: a.products, links: a.links, version: a.version }, { headers: { "Cache-Control": "no-store" } });
  } catch (e) { return fail(e); }
}
export async function POST(request: Request) {
  try {
    const user = await owner(request);
    const a = await nubeAccount(user, new URL(request.url).searchParams.get("account"));
    const action = z.discriminatedUnion("action", [
      z.object({ action: z.enum(["refresh", "sku"]) }),
      z.object({ action: z.literal("associate"), key: z.string().regex(/^\d+:\d+$/), variantId: z.uuid(), version: z.number().int().nonnegative() }),
    ]).parse(await request.json());
    if (action.action === "associate") {
      if (action.version !== a.version) throw Error("El catálogo cambió. Actualizá las publicaciones y volvé a guardar.");
      const links = { [action.key]: action.variantId };
      const { error } = await admin().rpc("save_tiendanube_catalog", { p_actor: user, p_account: a.id, p_expected: action.version, p_products: a.products, p_links: links });
      if (error) throw Error(error.code === "P0001" ? error.message : "No se pudo guardar la asociación.");
      return Response.json({ products: a.products, links: { ...a.links, ...links }, version: a.version + 1 }, { headers: { "Cache-Control": "no-store" } });
    }
    const products: NubeProduct[] = await fetchNubeProducts(a);
    const plan = action.action === "sku" ? skuPlan(products.flatMap((p) => p.variants.map((v) => ({ key: `${p.id}:${v.id}`, sku: v.sku }))), (await snapshot(user)).variants) : null;
    const { error } = await admin().rpc("save_tiendanube_catalog", { p_actor: user, p_account: a.id, p_expected: a.version, p_products: products, p_links: plan?.matches ?? {} });
    if (error) throw Error(error.code === "P0001" ? error.message : "No se pudo guardar el catálogo.");
    return Response.json({ products, links: { ...a.links, ...plan?.matches }, version: a.version + 1, ...(plan ? { ...plan, matched: Object.keys(plan.matches).length } : {}) }, { headers: { "Cache-Control": "no-store" } });
  } catch (e) { return fail(e); }
}
