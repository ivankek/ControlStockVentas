import test from "node:test";
import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import { randomUUID } from "node:crypto";
import { PGlite } from "@electric-sql/pglite";

test("conexiones aisladas, catálogo atómico, preservación de asociaciones y credenciales privadas", async () => {
  const db = new PGlite();
  try {
    await db.exec("create schema auth; create table auth.users(id uuid primary key,email text); create role anon; create role authenticated; create role service_role bypassrls;");
    for (const file of ["001_initial.sql", "002_inventory.sql", "003_require_supplier_sku.sql", "004_simplify_stock.sql", "20260922120816_supplier_owned_single_stock.sql", "20261020134220_tiendanube_catalog_sku.sql"]) await db.exec(await readFile(`supabase/migrations/${file}`, "utf8"));
    const actor = randomUUID(), other = randomUUID(), supplier = randomUUID();
    for (const id of [actor, other, supplier]) await db.query("insert into auth.users values($1,'test@example.com')", [id]);
    await db.query("update app_profiles set role='ADMIN' where id=$1", [actor]);
    await db.query("update app_profiles set role='SUPPLIER' where id=$1", [supplier]);
    await db.query("select inventory_command($1,$2::jsonb)", [supplier, JSON.stringify({ type: "product", supplierId: supplier, name: "P", sku: "SKU", date: "2026-10-01", cents: 100, stock: 5 })]);
    const variant = (await db.query<{id:string}>("select id from supplier_variants")).rows[0].id;
    const account = (await db.query<{id:string}>("select save_tiendanube_account($1,'123','Tienda','sealed') id", [actor])).rows[0].id;
    const save = (user: string, version: number, links: object) => db.query("select save_tiendanube_catalog($1,$2,$3,$4::jsonb,$5::jsonb)", [user, account, version, JSON.stringify([{ id: "1", variants: [{ id: "2" }, { id: "3" }] }]), JSON.stringify(links)]);
    await save(actor, 0, { "1:2": variant });
    await save(actor, 1, {});
    assert.deepEqual((await db.query<{links:object}>("select links from tiendanube_accounts")).rows[0].links, { "1:2": variant });
    await assert.rejects(save(actor, 1, {}), /catálogo cambió/);
    await assert.rejects(save(other, 2, { "1:3": variant }), /ajena/);
    await assert.rejects(db.query("select save_tiendanube_account($1,'123','Takeover','bad')", [other]), /otro usuario/);
    await assert.rejects(save(actor, 2, { "1:3": randomUUID() }), /no permitido/);
    assert.equal((await db.query<{version:number}>("select version from tiendanube_accounts")).rows[0].version, 2);
    // Existing ML mappings survive an empty plan, and matching mappings preserve units.
    const meli = (await db.query<{id:string}>("select save_meli_account($1,'42','sealed','ML') id", [actor])).rows[0].id;
    const items = JSON.stringify([{ id: "MLA1", seller_id: 42, title: "P", variations: [] }, { id: "MLA2", seller_id: 42, title: "Q", variations: [] }]);
    await db.query("select sync_meli_sku($1,$2,0,$3::jsonb,$4::jsonb)", [actor, meli, items, JSON.stringify({ "MLA1:0": variant })]);
    await db.query("update listing_mappings set units_per_sale=3 where account_id=$1", [meli]);
    await db.query("select sync_meli_sku($1,$2,1,$3::jsonb,'{}')", [actor, meli, items]);
    assert.equal((await db.query<{units_per_sale:number}>("select units_per_sale from listing_mappings")).rows[0].units_per_sale, 3);
    await db.query("select sync_meli_sku($1,$2,2,$3::jsonb,$4::jsonb)", [actor, meli, items, JSON.stringify({ "MLA1:0": variant, "MLA2:0": variant })]);
    assert.equal((await db.query("select * from listing_mappings")).rows.length, 2);
    assert.equal((await db.query<{units_per_sale:number}>("select units_per_sale from listing_mappings where item_id='MLA1'")).rows[0].units_per_sale, 3);
    for (const role of ["anon", "authenticated"]) {
      await db.exec(`set role ${role}`);
      await assert.rejects(db.query("select encrypted_token from tiendanube_accounts"), /permission denied/);
      await assert.rejects(save(actor, 3, {}), /permission denied/);
      await db.exec("reset role");
    }
  } finally { await db.close(); }
});
