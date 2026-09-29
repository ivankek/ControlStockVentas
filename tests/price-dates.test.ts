import test from "node:test";
import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import { randomUUID } from "node:crypto";
import { PGlite } from "@electric-sql/pglite";
import { pricePeriodAt } from "../lib/domain";

test("precios: solo corrige fechas, preserva historial y rechaza superposiciones", async () => {
  const db = new PGlite();
  try {
    await db.exec("create schema auth; create table auth.users(id uuid primary key,email text); create role anon; create role authenticated; create role service_role bypassrls;");
    for (const file of ["001_initial.sql", "002_inventory.sql", "003_require_supplier_sku.sql", "004_simplify_stock.sql", "20260922120816_supplier_owned_single_stock.sql"]) await db.exec(await readFile(`supabase/migrations/${file}`, "utf8"));
    const supplier = randomUUID(), outsider = randomUUID();
    await db.query("insert into auth.users values($1,'supplier@test'),($2,'other@test')", [supplier, outsider]);
    await db.query("update app_profiles set role='SUPPLIER' where id=$1", [supplier]);
    const command = (actor: string, data: object) => db.query("select inventory_command($1,$2::jsonb)", [actor, JSON.stringify(data)]);
    const base = { type: "product", supplierId: supplier, name: "Cepillo", sku: "CEP-1", stock: 30, date: "2026-09-29", cents: 350000 };
    await command(supplier, base);
    const snap = async () => (await db.query<{ s: { variants: { id: string; product_id: string; stock: number; version: number; costs: { from: string; cents: number }[] }[] } }>("select inventory_snapshot($1) s", [supplier])).rows[0].s.variants[0];
    let v = await snap();
    await db.query("insert into supplier_costs values($1,'2026-08-01',200000),($1,'2026-09-10',300000),($1,'2026-10-01',400000)", [v.id]);
    const migration = await readFile("supabase/migrations/20260929034937_correct_supplier_price_dates.sql", "utf8");
    const before = await snap();
    await assert.rejects(db.exec(migration), /otro precio/);
    await db.exec("rollback");
    assert.deepEqual(await snap(), before, "una superposición no modifica ningún dato");
    // Remove only the conflicting test fixture to exercise the normal one-price case.
    await db.query("delete from supplier_costs where variant_id=$1 and valid_from='2026-09-10'", [v.id]);
    await db.query("insert into supplier_costs values($1,'2026-09-22',350000)", [v.id]);
    await db.exec(migration);
    v = await snap();
    assert.equal(v.stock, 30);
    assert.deepEqual(v.costs, [{ from: "2026-08-01", cents: 200000 }, { from: "2026-09-01", cents: 350000 }, { from: "2026-09-29", cents: 350000 }, { from: "2026-10-01", cents: 400000 }]);
    assert.equal(pricePeriodAt(v, "2026-09-29")?.from, "2026-09-01");
    assert.equal(v.version, before.version, "la corrección de datos no modifica el inventario");
    await db.exec(migration);
    assert.deepEqual(await snap(), v, "repetir la corrección no crea ni borra precios");
    const edit = { ...base, productId: v.product_id, variantId: v.id, expectedVersion: v.version, originalCostDate: "2026-09-01", date: "2026-08-25" };
    await assert.rejects(command(outsider, edit), /administrar/);
    await command(supplier, edit);
    assert.deepEqual((await snap()).costs.map((c) => c.from), ["2026-08-01", "2026-08-25", "2026-09-29", "2026-10-01"]);
    await assert.rejects(command(supplier, edit), /producto cambió/);
    v = await snap();
    await assert.rejects(command(supplier, { ...edit, expectedVersion: v.version, originalCostDate: "2026-08-25", date: "2026-07-01" }), /otro precio/);
    assert.equal((await snap()).version, v.version);
    await db.exec("set role authenticated");
    await assert.rejects(command(supplier, edit), /permission denied/);
  } finally { await db.close(); }
});

test("vigencia efectiva: no mezcla tramos separados ni precios futuros", () => {
  const product = { costs: [{ from: "2026-08-01", cents: 100 }, { from: "2026-09-05", cents: 200 }, { from: "2026-09-22", cents: 100 }, { from: "2026-09-23", cents: 100 }, { from: "2026-10-01", cents: 300 }] };
  assert.equal(pricePeriodAt(product, "2026-09-29")?.from, "2026-09-22");
  assert.equal(pricePeriodAt(product, "2026-10-01")?.from, "2026-10-01");
  assert.equal(pricePeriodAt(product, "2026-07-01"), undefined);
});
