import test from "node:test";
import assert from "node:assert/strict";
import { physicalReturn, returnsPage, returnsPeriod } from "../lib/dispatch-returns";

const raw = { id: 123, date_created: "2026-10-13T12:00:00.000-03:00", status: "shipped", refund_at: "shipped", orders: [{ order_id: 456, item_id: "MLA1", return_quantity: 1 }], shipments: [{ shipment_id: 789, status: "delivered", destination: { name: "warehouse" } }, { shipment_id: 790, status: "shipped", destination: { name: "seller_address" } }] };
test("semana de lunes a domingo, y rango explícito sin ampliar", () => {
  assert.deepEqual(returnsPeriod("2026-10-18", "2026-10-18"), { from: "2026-10-12", to: "2026-10-18" });
  assert.deepEqual(returnsPeriod("2026-10-12", "2026-10-17"), { from: "2026-10-12", to: "2026-10-17" });
});
test("solo devoluciones físicas por fecha argentina, conserva cada tramo y destino", () => {
  const value = physicalReturn(raw, "2026-10-12", "2026-10-17")!;
  assert.equal(value.shipments[0].status, "delivered");
  assert.equal(value.shipments[1].status, "shipped");
  assert.equal(value.orders[0].order_id, "456");
  assert.equal(physicalReturn({ ...raw, refund_at: "n/a" }, "2026-10-12", "2026-10-17"), null);
  assert.equal(physicalReturn({ ...raw, shipments: [] }, "2026-10-12", "2026-10-17"), null);
  assert.equal(physicalReturn(raw, "2026-10-14", "2026-10-17"), null);
  assert.ok(physicalReturn({ ...raw, date_created: "2026-10-14T01:00:00.000Z" }, "2026-10-13", "2026-10-13"));
});
test("busca por vendedor y última actualización, pagina y no confunde cancelaciones con devoluciones", async () => {
  const paths: string[] = [];
  const page = await returnsPage(async (path) => {
    paths.push(path);
    if (path.includes("/search?")) {
      const q = new URL(`https://test${path}`).searchParams;
      assert.equal(q.get("players.user_id"), "111");
      assert.equal(q.get("players.role"), "respondent");
      assert.equal(q.get("range"), "last_updated:after:2026-10-12T00:00:00.000-03:00");
      return { paging: { total: 3 }, data: [{ id: 1 }, { id: 2, related_entities: [] }] };
    }
    if (path.endsWith("/claims/1")) return { id: 1, related_entities: ["return"] };
    if (path.endsWith("/1/returns")) return raw;
    throw Error("unexpected path");
  }, "111", "2026-10-12", "2026-10-17", 0);
  assert.equal(page.next, 2);
  assert.equal(page.returns.length, 1);
  assert.deepEqual(page.warnings, []);
  assert.equal(paths.length, 3);
});
test("errores no se presentan como ausencia de devoluciones", async () => {
  const page = await returnsPage(async (path) => {
    if (path.includes("search?")) return { paging: { total: 1 }, data: [{ id: 1, related_entities: ["return"] }] };
    throw Error("403");
  }, "111", "2026-10-12", "2026-10-17", 0);
  assert.equal(page.warnings.length, 1);
  assert.equal(page.next, null);
});
