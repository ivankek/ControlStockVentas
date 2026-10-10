import test from "node:test";
import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import { PGlite } from "@electric-sql/pglite";
import { visibleJob, type DispatchJob } from "../lib/dispatch-jobs";

test("consulta durable: exclusión, aislamiento, recuperación y reemplazo de un trabajo vencido", async () => {
 const db = new PGlite();
 try {
  await db.exec(`create role anon; create role authenticated; create role service_role bypassrls;
  create schema auth; create table auth.users(id uuid primary key);
  create table public.meli_accounts(id uuid primary key,owner_id uuid);
  insert into auth.users values('00000000-0000-4000-8000-000000000001');
  insert into meli_accounts values('00000000-0000-4000-8000-000000000002','00000000-0000-4000-8000-000000000001');
  grant select on meli_accounts to service_role;`);
  const sql = await readFile("supabase/migrations/20261010201753_dispatch_query_jobs.sql", "utf8");
  await db.exec(sql.split("-- Expired results")[0]);
  const start = () => db.query<{j:{started:boolean;job:DispatchJob}}>(`select start_dispatch_query('00000000-0000-4000-8000-000000000001','00000000-0000-4000-8000-000000000002','2026-10-01','2026-10-10') j`);
  await db.exec('set role service_role');
  const first=(await start()).rows[0].j;
  const again=(await start()).rows[0].j;
  assert.equal(first.started,true);assert.equal(again.started,false);assert.equal(first.job.id,again.job.id);
  await assert.rejects(db.query(`select start_dispatch_query('00000000-0000-4000-8000-000000000099','00000000-0000-4000-8000-000000000002','2026-10-01','2026-10-10')`), /account_not_owned/);
  await db.exec(`update dispatch_query_jobs set expires_at=now()-interval '1 minute'`);
  const replaced=(await start()).rows[0].j;
  assert.equal(replaced.started,true);assert.notEqual(replaced.job.id,first.job.id);
  const stale=await db.query('update dispatch_query_jobs set status=\'done\' where id=$1 returning id',[first.job.id]);assert.equal(stale.rows.length,0);
  await db.exec(`update dispatch_query_jobs set status='done', result='{"orders":[]}', expires_at=now()+interval '15 minutes'`);
  const recovered=await db.query<{result:unknown}>('select result from dispatch_query_jobs');assert.deepEqual(recovered.rows[0].result,{orders:[]});
  for(const role of ['anon','authenticated']) {
   await db.exec('reset role; set role '+role);
   await assert.rejects(db.query('select * from dispatch_query_jobs'),/permission denied/);
   await assert.rejects(start(),/permission denied/);
  }
 } finally { await db.close(); }
});

test("un trabajo expirado no deja el navegador esperando indefinidamente", () => {
 const job:DispatchJob={id:'1',date_from:'2026-10-01',date_to:'2026-10-10',status:'running',expires_at:'2020-01-01',progress:{}};
 assert.equal(visibleJob(job)?.status,'failed');
 assert.equal(visibleJob({...job,status:'done'}),null);
});
