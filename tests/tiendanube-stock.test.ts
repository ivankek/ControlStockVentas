import test from "node:test";
import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import { randomUUID } from "node:crypto";
import { PGlite } from "@electric-sql/pglite";
import { nubeStockMatches } from "../lib/tiendanube-stock";

test("stock Tiendanube: cero, stock ilimitado e identidad de variante", () => {
  const item = { id: 2, product_id: 1, stock: 0, stock_management: true };
  assert.equal(nubeStockMatches(item, "1", "2", 0), true);
  assert.equal(nubeStockMatches({ ...item, stock: null, stock_management: false }, "1", "2", 0), false);
  assert.equal(nubeStockMatches(item, "1", "2", 4), false);
  assert.throws(() => nubeStockMatches(item, "3", "2", 0), /variante/);
});
test("cola durable: asociación, ajuste, permisos, exclusión mutua y una revisión nueva durante el envío", async () => {
  const db = new PGlite();
  try {
    await db.exec("create schema auth; create table auth.users(id uuid primary key,email text); create role anon; create role authenticated; create role service_role bypassrls;");
    for (const file of ["001_initial.sql", "002_inventory.sql", "003_require_supplier_sku.sql", "004_simplify_stock.sql", "20260922120816_supplier_owned_single_stock.sql", "20261020134220_tiendanube_catalog_sku.sql", "20261020211606_tiendanube_stock_sync.sql"]) await db.exec(await readFile(`supabase/migrations/${file}`, "utf8"));
    const actor = randomUUID(), other = randomUUID(), supplier = randomUUID();
    for (const id of [actor, other, supplier]) await db.query("insert into auth.users values($1,'test@example.com')", [id]);
    await db.query("update app_profiles set role='ADMIN' where id=$1", [actor]);
    await db.query("update app_profiles set role='SUPPLIER' where id=$1", [supplier]);
    await db.query("select inventory_command($1,$2::jsonb)", [supplier, JSON.stringify({ type: "product", supplierId: supplier, name: "P", sku: "SKU", date: "2026-10-01", cents: 100, stock: 5 })]);
    const variant = (await db.query<{id:string}>("select id from supplier_variants")).rows[0].id;
    const account = (await db.query<{id:string}>("select save_tiendanube_account($1,'123','Tienda','sealed') id", [actor])).rows[0].id;
    await db.query("select save_tiendanube_catalog($1,$2,0,$3::jsonb,$4::jsonb)", [actor, account, JSON.stringify([{ id: "1", title: "Original", variants: [{ id: "2", stock: 20 }] }]), JSON.stringify({ "1:2": variant })]);
    const claim = async (id: string | null) => (await db.query<{job: any}>("select claim_nube_stock($1) job", [id])).rows[0].job;
    assert.equal(await claim(other), null);
    const first = await claim(supplier);
    assert.equal(first.stock, 5); assert.equal(first.allowed, true);
    assert.equal(await claim(null), null);
    await db.query("update supplier_inventory set stock=0 where variant_id=$1", [variant]);
    assert.equal(await claim(null), null, "a new revision preserves the existing lease");
    const finish = async (job: any, error: string | null = null) => db.query("select finish_nube_stock($1,$2,$3,$4,$5,$6)", [account, job.key, job.lease, job.revision, error, job.stock]);
    await finish(first);
    const second = await claim(null); assert.equal(second.stock, 0);
    await finish(first); assert.equal(await claim(null), null, "an old finish cannot release the new lease");
    await finish(second, "permissions");
    assert.equal(await claim(null), null, "errors back off");
    await db.exec("update tiendanube_stock_jobs set updated_at=now()-interval '6 minutes'");
    const retry = await claim(null); assert.equal(retry.stock, 0);
    await finish(retry);
    const saved = (await db.query<{products:any[],version:number}>("select products,version from tiendanube_accounts")).rows[0];
    assert.equal(saved.products[0].variants[0].stock, 0); assert.equal(saved.products[0].title, "Original");
    assert.equal(await claim(null), null);
    for (const role of ["anon", "authenticated"]) {
      await db.exec(`set role ${role}`);
      await assert.rejects(claim(null), /permission denied/);
      await assert.rejects(db.query("select * from tiendanube_stock_jobs"), /permission denied/);
      await db.exec("reset role");
    }
  } finally { await db.close(); }
});
