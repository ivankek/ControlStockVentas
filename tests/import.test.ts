import test from "node:test";
import assert from "node:assert/strict";
import { mergeImport } from "../lib/meli";
import { sampleState, today, confirmDispatch } from "../lib/domain";
test("sincronizar preserva costos y confirmaciones manuales", () => {
  const s = sampleState();
  confirmDispatch(s, "EJEMPLO-1046", today());
  const order = { ...s.orders.at(-1)! };
  delete order.dispatchedDate;
  order.review = "Validar la fecha de despacho con un pedido real";
  const result = mergeImport(s, {
    orders: [order],
    products: [{ id: "DEMO-3", name: "Manteca squishy", costs: [] }],
    syncedAt: new Date().toISOString(),
    syncWarning: "90 días",
  });
  assert.equal(result.orders.at(-1)?.dispatchedDate, today());
  assert.equal(result.orders.at(-1)?.review, undefined);
  assert.equal(result.products[2].costs[0].cents, 2000000);
  assert.equal(result.orders.length, s.orders.length);
});
