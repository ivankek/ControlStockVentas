import { z } from "zod";
import { owner, fail } from "@/lib/server";
import { supplierAccounts, supplierCatalog, supplierSales } from "@/lib/supplier-home-server";
export const maxDuration = 300;
export async function GET(request: Request) {
  try {
    const user = await owner(request), accounts = await supplierAccounts(user);
    const data = await Promise.all(accounts.map(async (a) => {
      try { return await supplierCatalog(user, a); }
      catch { return { id:a.id, name:a.name, platform:a.platform, listings:[], error:"No se pudo consultar el catálogo guardado." }; }
    }));
    return Response.json({accounts:data}, {headers:{"Cache-Control":"no-store"}});
  } catch(e) { return fail(e); }
}
export async function POST(request: Request) {
  try {
    const user = await owner(request), id = z.uuid().parse(new URL(request.url).searchParams.get("account"));
    const account = (await supplierAccounts(user)).find((a) => a.id === id);
    if (!account) throw Object.assign(Error("Cuenta no vinculada al proveedor."), {status:403});
    return Response.json(await supplierSales(user, account), {headers:{"Cache-Control":"no-store"}});
  } catch(e) { return fail(e); }
}
