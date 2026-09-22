import test from "node:test";
import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import { randomUUID } from "node:crypto";
import { PGlite } from "@electric-sql/pglite";
import { verifiedSale } from "../lib/sale-stock";

test("descuento compartido: dos vendedores, duplicados, packs, reintentos, permisos y faltantes", async () => {
  const db = new PGlite();
  try {
    await db.exec("create schema auth; create table auth.users(id uuid primary key,email text); create role anon; create role authenticated; create role service_role bypassrls;");
    for (const file of ["001_initial.sql", "002_inventory.sql", "003_require_supplier_sku.sql", "004_simplify_stock.sql",
      "20260922120816_supplier_owned_single_stock.sql", "20260922124743_listing_stock_sync.sql"])
      await db.exec(await readFile(`supabase/migrations/${file}`, "utf8"));
    const supplier = randomUUID(), seller1 = randomUUID(), seller2 = randomUUID(), outsider = randomUUID();
    for (const user of [supplier, seller1, seller2, outsider]) await db.query("insert into auth.users values($1,'test@example.com')", [user]);
    await db.query("update app_profiles set role='SUPPLIER' where id=$1", [supplier]);
    await db.query("insert into supplier_sellers values($1,$2,true),($1,$3,true)", [supplier, seller1, seller2]);
    const command = (actor: string, action: object) => db.query("select inventory_command($1,$2::jsonb)", [actor, JSON.stringify(action)]);
    await command(supplier, { type: "product", supplierId: supplier, name: "Pastillas", sku: "PAS-01", cents: 350000, date: "2026-01-01", stock: 30 });
    const variant = (await db.query<{ id: string }>("select id from supplier_variants")).rows[0].id;
    const accounts: string[] = [];
    for (const [index, user] of [seller1, seller2].entries()) {
      const seller = String(index + 41), item = `MLA${index + 1}`;
      const account = (await db.query<{ id: string }>("select save_meli_account($1,$2,'encrypted','Cuenta') id", [user, seller])).rows[0].id;
      accounts.push(account);
      await db.query("select save_meli_catalog($1,$2,0,$3::jsonb)", [user, account, JSON.stringify([{ id: item, seller_id: Number(seller), title: item, variations: [], available_quantity: 30 }])]);
      await command(user, { type: "mapping", accountId: account, keys: [`${item}:0`], variantId: variant, units: index + 1, mode: "REAL", fixed: null });
    }
    await db.exec(await readFile("supabase/migrations/20260922202559_sales_shared_stock.sql", "utf8"));
    type Job = { accountId: string; orderId: string; sellerId: string; lease: string; revision: number };
    const claim = async () => (await db.query<{ j: Job | null }>("select claim_sale_stock() j")).rows[0].j;
    const enqueue = (seller: string, order: string) => db.query("select enqueue_sale_stock($1,$2)", [seller, order]);
    const stock = async () => (await db.query<{ stock: number }>("select stock from supplier_inventory")).rows[0].stock;
    const apply = (j: Job, extra: object = {}) => db.query("select apply_sale_stock($1,$2,$3,$4,$5::jsonb)", [j.accountId, j.orderId, j.lease, j.revision, JSON.stringify({
      id: j.orderId, sellerId: j.sellerId, status: "paid", confirmedAt: new Date().toISOString(),
      lines: [{ itemId: j.sellerId === "41" ? "MLA1" : "MLA2", variationId: "0", quantity: 1 }], ...extra,
    })]);
    // Existing stock and product survive this additive migration; a lease excludes a second claimant.
    assert.equal(await stock(), 30);
    await enqueue("41", "100");
    const first = (await claim())!;
    assert.equal(await claim(), null);
    await assert.rejects(apply(first, { sellerId: "99" }), /Orden ajena/);
    assert.equal(await stock(), 30);
    // Notification arriving during processing preserves the lease and queues another verification.
    await enqueue("41", "100");
    await apply(first);
    assert.equal(await stock(), 29);
    await apply((await claim())!);
    assert.equal(await stock(), 29);
    assert.equal(await claim(), null);
    await enqueue("42", "101");
    await apply((await claim())!); // two physical units per pack
    assert.equal(await stock(), 27);
    const stockJobs = (await db.query<{ j: { targets: { stock: number }[]; accountId: string; itemId: string; lease: string; revision: number } }>("select claim_stock_sync(null) j")).rows[0].j;
    assert.equal(stockJobs.targets[0].stock, 27);
    const fanout = (await db.query<{ account_id: string }>("select account_id from listing_stock_jobs where status in ('pending','running')")).rows;
    assert.deepEqual(new Set(fanout.map((r) => r.account_id)), new Set(accounts));
    // A PUT based on an older stock snapshot cannot mark a newer revision complete.
    await enqueue("41", "102"); await apply((await claim())!);
    await db.query("select finish_stock_sync($1,$2,$3,$4,null,$5::jsonb)", [stockJobs.accountId, stockJobs.itemId, stockJobs.lease, stockJobs.revision, JSON.stringify(stockJobs.targets)]);
    assert.equal((await db.query<{ status: string }>("select status from listing_stock_jobs where account_id=$1", [stockJobs.accountId])).rows[0].status, "pending");
    assert.equal(await stock(), 26);
    await enqueue("41", "100"); await apply((await claim())!, { status: "cancelled" });
    assert.equal(await stock(), 26);
    assert.match((await db.query<{ warning: string }>("select warning from sales_stock_jobs where order_id='100'")).rows[0].warning, /cancelada/);
    await enqueue("41", "103"); await apply((await claim())!, { confirmedAt: "2020-01-01T00:00:00Z" });
    assert.equal(await stock(), 26);
    await enqueue("41", "104"); await apply((await claim())!, { status: "payment_required", confirmedAt: null });
    assert.equal(await stock(), 26);
    await enqueue("41", "104"); await apply((await claim())!);
    assert.equal(await stock(), 25);
    await enqueue("41", "105"); await apply((await claim())!, { lines: [{ itemId: "MLA999", variationId: "0", quantity: 1 }] });
    assert.equal(await stock(), 25);
    assert.match((await db.query<{ warning: string }>("select warning from sales_stock_jobs where order_id='105'")).rows[0].warning, /Sin asociación/);
    await enqueue("41", "106");
    const failed = (await claim())!;
    await db.query("select fail_sale_stock($1,$2,$3,'Reintentar')", [failed.accountId, failed.orderId, failed.lease]);
    assert.equal(await claim(), null);
    await db.exec("update sales_stock_jobs set next_attempt=now()-interval '1 second' where order_id='106'");
    const retry = (await claim())!;
    await apply(failed); // stale worker cannot consume after a new lease
    assert.equal(await stock(), 25);
    await apply(retry, { lines: [{ itemId: "MLA1", variationId: "0", quantity: 40 }] });
    assert.equal(await stock(), 0);
    const debit = (await db.query<{ units: number; deducted: number }>("select units,deducted from sales_stock_debits where order_id='106'")).rows[0];
    assert.deepEqual(debit, { units: 40, deducted: 25 });
    await enqueue("41", "106"); await apply((await claim())!);
    assert.equal(await stock(), 0);
    const status = async (actor: string) => (await db.query<{ s: { warning: string }[] }>("select sale_stock_status($1) s", [actor])).rows[0].s;
    assert.equal((await status(outsider)).length, 0);
    assert.ok((await status(supplier)).some((s) => /insuficiente/.test(s.warning)));
    assert.ok((await status(seller1)).some((s) => /Sin asociación/.test(s.warning)));
    await db.exec("update listing_stock_jobs set status='error',lease=null,lease_until=null,updated_at=now()");
    assert.equal((await db.query<{ j: unknown }>("select claim_stock_sync(null) j")).rows[0].j, null);
    await db.exec("update listing_stock_jobs set updated_at=now()-interval '6 minutes'");
    assert.ok((await db.query<{ j: unknown }>("select claim_stock_sync(null) j")).rows[0].j);
    await db.exec("set role authenticated");
    await assert.rejects(db.query("select claim_sale_stock()"), /permission denied/);
    await assert.rejects(db.query("select claim_stock_sync(null)"), /permission denied/);
    await assert.rejects(db.query("select worker_token from sales_stock_config"), /permission denied/);
    await assert.rejects(db.query("select * from sales_stock_debits"), /permission denied/);
    await db.exec("reset role");
  } finally { await db.close(); }
});

test("solo acepta una orden completa del vendedor consultado", () => {
  const raw = { id: 100, seller: { id: 42 }, status: "paid", date_closed: "2026-09-22T12:00:00.000-03:00",
    order_items: [{ item: { id: "MLA123", variation_id: null }, quantity: 2 }] };
  assert.deepEqual(verifiedSale(raw, "100", "42").lines, [{ itemId: "MLA123", variationId: "0", quantity: 2 }]);
  assert.equal(verifiedSale({ ...raw, order_items: [{ item: { id: "MLA123", variation_id: 0 }, quantity: 1 }] }, "100", "42").lines[0].variationId, "0");
  assert.throws(() => verifiedSale(raw, "200", "42"), /no pertenece/);
  assert.throws(() => verifiedSale(raw, "100", "43"), /no pertenece/);
  assert.throws(() => verifiedSale({ ...raw, date_closed: null }, "100", "42"), /fecha/);
  assert.throws(() => verifiedSale({ ...raw, order_items: [] }, "100", "42"));
  assert.throws(() => verifiedSale({ ...raw, id: Number.MAX_SAFE_INTEGER + 1 }, "100", "42"));
});
