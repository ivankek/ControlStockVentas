import test from "node:test";
import assert from "node:assert/strict";
import {
  sampleState,
  summary,
  today,
  settle,
  confirmDispatch,
  flexDate,
  costAt,
} from "../lib/domain";
import { applyCommand } from "../lib/commands";
import { dispatchEvidence } from "../lib/shipping";

test("el ejemplo suma $540.000 y 21 unidades", () => {
  const s = summary(sampleState(), today());
  assert.equal(s.total, 54000000);
  assert.equal(
    s.rows.reduce((n, r) => n + r.quantity, 0),
    21,
  );
});
test("Flex: viernes tarde, sábado antes y después del corte, domingo", () => {
  assert.equal(flexDate("2026-09-11T13:00:00-03:00"), "2026-09-12");
  assert.equal(flexDate("2026-09-12T12:59:59-03:00"), "2026-09-12");
  assert.equal(flexDate("2026-09-12T13:00:00-03:00"), "2026-09-14");
  assert.equal(flexDate("2026-09-13T09:00:00-03:00"), "2026-09-14");
  assert.equal(flexDate("2026-09-12T15:59:59Z"), "2026-09-12");
});
test("pagar dos veces se rechaza y el historial conserva el costo original", () => {
  const state = sampleState();
  const paid = settle(state, today());
  assert.equal(paid.total, 54000000);
  assert.equal(summary(state, today()).total, 0);
  assert.throws(() => settle(state, today()), /No hay/);
  const changed = applyCommand(state, {
    type: "cost",
    id: "DEMO-1",
    date: today(),
    cents: 1,
  });
  assert.equal(changed.settlements[0].total, 54000000);
});
test("despacho manual se agrega una sola vez", () => {
  const state = sampleState();
  confirmDispatch(state, "EJEMPLO-1046", today());
  assert.equal(summary(state, today()).total, 56000000);
  assert.throws(
    () => confirmDispatch(state, "EJEMPLO-1046", today()),
    /ya tiene/,
  );
});
test("sin costo no puede cerrarse la liquidación", () => {
  const state = sampleState();
  state.products[0].costs = [];
  assert.deepEqual(summary(state, today()).missing, ["Cepillos limpieza"]);
  assert.throws(() => settle(state, today()), /costos/);
});
test("precios con vigencia y fechas inválidas", () => {
  const p = sampleState().products[0];
  p.costs.push({ from: "2026-12-01", cents: 99 });
  assert.equal(costAt(p, "2026-11-30"), 3250000);
  assert.equal(costAt(p, "2026-12-01"), 99);
  assert.throws(() =>
    applyCommand(sampleState(), {
      type: "cost",
      id: p.id,
      date: "2026-02-30",
      cents: 10,
    }),
  );
  assert.throws(() =>
    applyCommand(sampleState(), {
      type: "cost",
      id: p.id,
      date: today(),
      cents: -10,
    }),
  );
});
test("crear etiqueta o entregar no inventan fecha de despacho", () => {
  assert.equal(
    dispatchEvidence({ id: 1, status: "ready_to_ship" }, [
      {
        status: "ready_to_ship",
        substatus: "printed",
        date: "2026-09-12T10:00:00-03:00",
      },
    ]),
    undefined,
  );
  assert.equal(
    dispatchEvidence({ id: 1, status: "delivered" }, [
      { status: "delivered", date: "2026-09-12T18:00:00-03:00" },
    ]),
    undefined,
  );
});
test("historial usa primer despacho, no último tránsito, en horario argentino", () => {
  const result = dispatchEvidence({ id: 1, status: "delivered" }, [
    { status: "shipped", date: "2026-09-13T18:00:00Z" },
    {
      status: "ready_to_ship",
      substatus: "picked_up",
      date: "2026-09-13T01:00:00Z",
    },
  ]);
  assert.equal(result?.date, "2026-09-12");
});
test("cancelación posterior al despacho bloquea cierre", () => {
  const state = sampleState();
  state.orders[0].cancelled = true;
  state.orders[0].review = "Cancelación";
  assert.throws(() => settle(state, today()), /incidencias/);
});
test("despacho informado después del pago queda como ajuste pendiente sin repetir el resto", () => {
  const state = sampleState();
  settle(state, today());
  confirmDispatch(state, "EJEMPLO-1046", today());
  const s = summary(state, today());
  assert.equal(s.orders.length, 1);
  assert.equal(s.total, 2000000);
});
test("confirmar un despacho no elimina una incidencia de reembolso", () => {
  const state = sampleState();
  state.orders.at(-1)!.review = "Reembolso parcial: revisar con el proveedor";
  confirmDispatch(state, "EJEMPLO-1046", today());
  assert.throws(() => settle(state, today()), /incidencias/);
});
