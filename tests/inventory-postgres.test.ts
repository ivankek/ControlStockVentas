import test from "node:test";
import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import { randomUUID } from "node:crypto";
import pg from "pg";
import { supplierReport } from "../lib/supplier";
import { emptyState } from "../lib/domain";
import { profitRows } from "../lib/profit";

// Only an explicitly named, EMPTY disposable database is accepted; never use Supabase here.
test("PostgreSQL real: migración, aislamiento, roles y transacciones concurrentes", { skip: !process.env.INVENTORY_TEST_DATABASE_URL }, async (t) => {
  const url = process.env.INVENTORY_TEST_DATABASE_URL!;
  const parsed = new URL(url);
  assert.ok(["localhost", "127.0.0.1"].includes(parsed.hostname));
  assert.equal(parsed.pathname, "/despachos_inventory_test");
  const db = new pg.Client({ connectionString: url }); await db.connect(); t.after(() => db.end());
  assert.equal((await db.query("select count(*)::int n from information_schema.tables where table_schema in ('public','auth')")).rows[0].n, 0, "La base de pruebas debe estar vacía");
  await db.query("create schema auth; create table auth.users(id uuid primary key,email text); do $$ begin if not exists(select from pg_roles where rolname='anon') then create role anon; create role authenticated; create role service_role bypassrls; end if; end $$;");
  const admin = randomUUID(), user = randomUUID(), supplier = randomUUID(), other = randomUUID(), supplier2 = randomUUID();
  for (const [id, name] of [[admin, "admin"], [user, "user"], [supplier, "supplier"], [other, "other"], [supplier2, "supplier2"]]) await db.query("insert into auth.users values($1,$2)", [id, `${name}@test.local`]);
  await db.query(await readFile("supabase/migrations/001_initial.sql", "utf8"));
  const listing = { id: "MLA1", seller_id: 42, user_product_id: "UP1", title: "Cepillo", price: 100, currency_id: "ARS", available_quantity: 999, status: "active", variations: [] };
  const legacy = { ...emptyState(), listings: [listing], supplierProducts: [{ id: "legacy-1", name: "Cepillo", costs: [{ from: "2026-01-01", cents: 100 }, { from: "2026-09-01", cents: 200 }] }], supplierLinks: { "up:UP1": { supplierId: "legacy-1", units: 3 } } };
  await db.query("insert into account_states(owner_id,state) values($1,$2)", [admin, legacy]);
  await db.query("insert into meli_connections(owner_id,seller_id,encrypted_tokens) values($1,'42','encrypted-original')", [admin]);
  await db.query(await readFile("supabase/migrations/002_inventory.sql", "utf8"));
  await db.query("update app_profiles set role='ADMIN' where id=$1", [admin]);
  const command = (actor: string, action: unknown, client = db) => client.query("select inventory_command($1,$2)", [actor, action]);
  const snap = async (actor: string) => (await db.query("select inventory_snapshot($1) s", [actor])).rows[0].s;
  const saveAccount = async (actor: string, seller: string) => (await db.query("select save_meli_account($1,$2,'encrypted-new','Cuenta') id", [actor, seller])).rows[0].id as string;
  await command(admin, { type: "role", userId: supplier, role: "SUPPLIER" });
  await command(admin, { type: "role", userId: supplier2, role: "SUPPLIER" });
  const originalAccount = (await db.query("select * from meli_accounts where seller_id='42'")).rows[0];
  await t.test("conexión anterior preservada; cuentas múltiples y seller único", async () => {
    assert.equal(originalAccount.owner_id, admin); assert.equal(originalAccount.encrypted_tokens, "encrypted-original");
    assert.equal(await saveAccount(admin, "42"), originalAccount.id);
    await saveAccount(admin, "43"); await saveAccount(user, "44"); await saveAccount(user, "45"); await saveAccount(other, "46");
    await assert.rejects(saveAccount(user, "42"), /otro usuario/);
    await assert.rejects(saveAccount(supplier, "47"), /no puede conectar/);
    assert.equal((await snap(user)).accounts.length, 2);
    assert.equal((await snap(supplier)).accounts.length, 0);
    assert.equal((await db.query("select count(*)::int n from meli_accounts where seller_id='42'")).rows[0].n, 1);
  });
  let variant: string;
  await t.test("asignación explícita atómica conserva catálogo, UP, packs, costos y original", async () => {
    assert.equal((await snap(admin)).variants.length, 0);
    await assert.rejects(command(user, { type: "assignLegacy", ownerId: admin, supplierId: supplier }), /ADMIN/);
    await command(admin, { type: "assignLegacy", ownerId: admin, supplierId: supplier });
    const s = await snap(supplier); variant = s.variants[0].id;
    assert.equal(s.variants[0].supplier_id, supplier); assert.equal(s.variants[0].costs.length, 2);
    assert.equal(s.mappings[0].units_per_sale, 3); assert.equal(s.mappings[0].item_id, "MLA1");
    assert.deepEqual((await db.query("select state from account_states where owner_id=$1", [admin])).rows[0].state, legacy);
    await assert.rejects(command(admin, { type: "assignLegacy", ownerId: admin, supplierId: supplier2 }), /ya fue asignado/);
    // Same resolver and same cost-at-date, including pack quantity, as the previous model.
    const state = { ...emptyState(), listings: [listing], supplierProducts: [{ id: variant, name: "Cepillo", costs: s.variants[0].costs }], supplierLinks: { "MLA1:0": { supplierId: variant, units: 3 } } };
    const order = { id: "1", mode: "correo" as const, createdAt: "2026-09-10T12:00:00Z", cancelled: false, orderStatus: "paid", lines: [{ productId: "MLA1:0", quantity: 2 }] };
    assert.equal(supplierReport(state, [order], "2026-09-10").totalCents, 1200);
    assert.equal(supplierReport(state, [order], "2026-08-10").totalCents, 600);
    assert.equal(profitRows(state, [{ ...order, grossCents: 3000, receivedCents: 2500, paymentIds: [], issues: [] }])[0].net, 1300);
  });
  await t.test("permisos reales: roles, relaciones, recursos ajenos y RLS", async () => {
    await assert.rejects(command(user, { type: "role", userId: user, role: "SUPPLIER" }), /ADMIN/);
    await assert.rejects(command(admin, { type: "role", userId: user, role: "ADMIN" }), /no permitido/);
    await assert.rejects(command(user, { type: "relationship", supplierId: supplier, sellerId: user, active: true }), /ADMIN/);
    const product = { type: "product", supplierId: supplier, name: "Otro", variantName: "Única", sku: "", date: "2026-09-01", cents: 50 };
    await assert.rejects(command(user, product), /administrar/);
    await assert.rejects(command(supplier2, product), /administrar/);
    await command(supplier, product);
    assert.equal((await snap(user)).variants.length, 0);
    await command(admin, { type: "relationship", supplierId: supplier, sellerId: user, active: true });
    assert.equal((await snap(user)).variants.length, 2);
    await db.query("set role authenticated");
    try {
      await assert.rejects(db.query("select * from meli_accounts"), /permission denied/);
      await assert.rejects(command(admin, product), /permission denied/);
    } finally { await db.query("reset role"); }
  });
  await t.test("varias cuentas apuntan al mismo stock sin mezcla ni datos privados", async () => {
    const accounts = (await snap(user)).accounts;
    for (const [index, a] of accounts.entries()) {
      const payload = { ...listing, id: `MLA${index + 2}`, seller_id: Number(a.seller_id) };
      await db.query("select save_meli_catalog($1,$2,0,$3)", [user, a.id, JSON.stringify([payload])]);
      await command(user, { type: "mapping", accountId: a.id, keys: [`${payload.id}:0`], variantId: variant, units: 3, mode: "FIXED", fixed: 999 });
    }
    await assert.rejects(command(other, { type: "mapping", accountId: accounts[0].id, keys: ["MLA2:0"], variantId: variant, units: 1, mode: "REAL", fixed: null }), /Cuenta ajena/);
    await assert.rejects(db.query("select save_meli_catalog($1,$2,1,$3)", [other, accounts[0].id, JSON.stringify([listing])]), /no rows/);
    await assert.rejects(db.query("select save_meli_catalog($1,$2,1,$3)", [user, accounts[0].id, JSON.stringify([listing])]), /otra cuenta/);
    await assert.rejects(command(user, { type: "mapping", accountId: accounts[0].id, keys: ["MLA2:99"], variantId: variant, units: 1, mode: "REAL", fixed: null }), /variante inválida/);
    assert.equal((await snap(user)).mappings.length, 2);
    assert.equal((await snap(user)).movements.length, 0);
    assert.ok(!(JSON.stringify(await snap(user))).includes("encrypted"));
    assert.equal((await snap(supplier)).mappings.length, 3);
    assert.equal((await snap(supplier2)).mappings.length, 0);
    await command(admin, { type: "relationship", supplierId: supplier, sellerId: user, active: false });
    await assert.rejects(command(user, { type: "mapping", accountId: accounts[0].id, keys: ["MLA2:0"], variantId: variant, units: 1, mode: "REAL", fixed: null }), /relación activa/);
    assert.equal((await snap(user)).variants.length, 0);
    await command(admin, { type: "relationship", supplierId: supplier, sellerId: user, active: true });
  });
  const adjustment = (delta: number, expectedVersion: number) => ({ type: "adjust", variantId: variant, delta, reserved: 0, safety: 0, expectedVersion, movementType: "MANUAL_ADJUSTMENT", note: "Prueba manual", requestId: randomUUID() });
  await t.test("ajustes autorizados, invariantes, idempotencia, rollback y movimiento", async () => {
    await assert.rejects(command(user, adjustment(2, 0)), /ajustar/);
    await assert.rejects(command(supplier2, adjustment(2, 0)), /ajustar/);
    const action = adjustment(2, 0); await command(supplier, action); await command(supplier, action);
    let row = (await snap(supplier)).movements[0];
    assert.equal(row.actor_id, supplier); assert.equal(row.stock_before, 0); assert.equal(row.stock_after, 2);
    assert.equal((await snap(supplier)).movements.length, 1);
    await assert.rejects(command(supplier, { ...action, delta: 5 }), /reutilizado/);
    await assert.rejects(command(supplier, adjustment(-3, 1)), /check constraint/);
    await assert.rejects(command(supplier, { ...adjustment(0, 1), reserved: 3 }), /check constraint/);
    await assert.rejects(command(supplier, { ...adjustment(1, 1), safety: -1 }), /check constraint/);
    await assert.rejects(command(supplier, { ...adjustment(1, 1), movementType: "SALE" }), /manuales/);
    assert.equal((await snap(supplier)).movements.length, 1);
    assert.equal((await snap(supplier)).variants.find((v: { id: string }) => v.id === variant).physical_stock, 2);
    // An insertion failure after the stock UPDATE must roll back that UPDATE too.
    await db.query("create function reject_test_movement() returns trigger language plpgsql as $$ begin raise exception 'test rollback'; end $$; create trigger reject_test_movement before insert on inventory_movements for each row execute function reject_test_movement();");
    await assert.rejects(command(supplier, adjustment(1, 1)), /test rollback/);
    await db.query("drop trigger reject_test_movement on inventory_movements; drop function reject_test_movement();");
    assert.equal((await snap(supplier)).variants.find((v: { id: string }) => v.id === variant).physical_stock, 2);
  });
  await t.test("dos conexiones concurrentes serializan 2→1→0 con movimientos correctos", async () => {
    const a = new pg.Client({ connectionString: url }), b = new pg.Client({ connectionString: url }); await a.connect(); await b.connect();
    try {
      await a.query("begin"); await command(supplier, adjustment(-1, 1), a);
      let done = false;
      const pending = command(supplier, adjustment(-1, 2), b).finally(() => { done = true; });
      await new Promise((resolve) => setTimeout(resolve, 100)); assert.equal(done, false, "La segunda conexión debe esperar el bloqueo de fila");
      await a.query("commit"); await pending;
      const history = (await db.query("select stock_before,stock_after from inventory_movements where variant_id=$1 order by created_at", [variant])).rows;
      assert.deepEqual(history.map((m) => [Number(m.stock_before), Number(m.stock_after)]), [[0, 2], [2, 1], [1, 0]]);
      await assert.rejects(command(supplier, adjustment(1, 1)), /stock cambió/);
    } finally { await a.end(); await b.end(); }
  });
  await t.test("fallo de migración conserva catálogo y revierte inserciones parciales", async () => {
    const broken = { ...legacy, supplierLinks: { "MLA999:0": { supplierId: "legacy-1", units: 3 } } };
    await db.query("insert into account_states(owner_id,state) values($1,$2)", [other, broken]);
    await assert.rejects(command(admin, { type: "assignLegacy", ownerId: other, supplierId: supplier }), /sin publicación/);
    assert.equal((await db.query("select count(*)::int n from supplier_products where legacy_owner=$1", [other])).rows[0].n, 0);
    assert.equal((await db.query("select count(*)::int n from legacy_catalog_assignments where owner_id=$1", [other])).rows[0].n, 0);
  });
});
