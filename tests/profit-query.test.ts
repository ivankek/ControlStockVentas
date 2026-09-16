import test from "node:test";
import assert from "node:assert/strict";
import { queryProfitSales } from "../lib/profit-query";
import type { Sale } from "../lib/profit";
const sale = (id: string) => ({ id } as Sale);
test("consulta el período completo por páginas, sin recorrer semanas vacías", async () => {
  const calls: unknown[] = [];
  const range = { from: "2026-01-01", to: "2026-09-16" };
  const result = await queryProfitSales(range, async (query) => {
    calls.push(query); return { sales: [sale(String(query.offset))], total: 2, nextOffset: query.offset === 0 ? 1 : null };
  }, () => {});
  assert.deepEqual(calls, [{ ...range, offset: 0 }, { ...range, offset: 1 }]);
  assert.equal(result.length, 2);
});
test("solo divide períodos que exceden el límite y no pierde días", async () => {
  const calls: { from: string; to: string }[] = [];
  const result = await queryProfitSales({ from: "2026-09-01", to: "2026-09-04" }, async (query) => {
    calls.push(query);
    return calls.length === 1 ? { sales: [], total: 10001, nextOffset: null, splitRequired: true } : { sales: [sale(query.from)], total: 1, nextOffset: null };
  }, () => {});
  assert.deepEqual(calls.map(({ from, to }) => [from, to]), [["2026-09-01", "2026-09-04"], ["2026-09-01", "2026-09-02"], ["2026-09-03", "2026-09-04"]]);
  assert.equal(result.length, 2);
  await assert.rejects(queryProfitSales({ from: "2026-09-01", to: "2026-09-01" }, async () => ({ sales: [], total: 10001, nextOffset: null, splitRequired: true }), () => {}));
});
