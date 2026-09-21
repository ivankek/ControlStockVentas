import test from "node:test";
import assert from "node:assert/strict";
import { detectFlexZone } from "../lib/flex-zones";
import { businessCommand, emptyBusiness, resolveFlex, resolveFlexShipments, updateBusiness } from "../lib/business";
import { emptyState, type Order } from "../lib/domain";
import { shipmentDestination } from "../lib/shipping";

test("ejemplos del proveedor, alias y normalización", () => {
  for (const province of ["CABA", "Capital Federal", "Ciudad Autónoma de Buenos Aires"])
    assert.equal(resolveFlex(undefined, { province, city: "La Paternal" }, "2026-09-21").cents, 320000);
  for (const city of ["Villa Luzuriaga", "villa luzuriaga", "  VILLA   LUZURIAGA  "])
    assert.equal(resolveFlex(undefined, { province: "Buenos Aires", municipality: "La Matanza", city }, "2026-09-21").cents, 364000);
  assert.equal(detectFlexZone({ province: "Buenos Aires", municipality: "Partido de Lomas de Zamora", city: "Banfield Oeste" }).zone, "CORDON_1");
  assert.equal(detectFlexZone({ province: "Buenos Aires", city: "Banfield Oeste" }).zone, "CORDON_1");
  assert.equal(detectFlexZone({ province: "Buenos Aires", city: "MORON" }).zone, "CORDON_2");
  assert.equal(detectFlexZone({ province: "Buenos Aires", municipality: "Zárate" }).zone, "CORDON_3");
});

test("La Matanza exige localidad clasificada; CP solo como apoyo", () => {
  const base = { province: "Buenos Aires", municipality: "La Matanza" };
  for (const city of ["San Justo", "Ramos Mejía", "Villa Luzuriaga", "Lomas del Mirador", "La Tablada", "Tapiales", "Ciudad Madero", "Villa Madero", "Villa Celina", "Aldo Bonzi", "Ciudad Evita"])
    assert.equal(detectFlexZone({ ...base, city }).zone, "CORDON_1", city);
  for (const city of ["Isidro Casanova", "Rafael Castillo", "Gregorio de Laferrere", "Laferrere", "González Catán", "Virrey del Pino", "20 de Junio"])
    assert.equal(detectFlexZone({ ...base, city }).zone, "CORDON_2", city);
  for (const city of [undefined, "Desconocida"])
    assert.equal(detectFlexZone({ ...base, city }).zone, undefined);
  assert.equal(detectFlexZone({ ...base, postalCode: "B1753ABC" }).zone, "CORDON_1");
  assert.equal(detectFlexZone({ ...base, city: "Desconocida", postalCode: "1753" }).zone, undefined);
  assert.equal(detectFlexZone({ ...base, city: "Villa Luzuriaga", neighborhood: "González Catán" }).zone, undefined);
  assert.equal(detectFlexZone({ province: "Mendoza", city: "San Martín" }).zone, undefined);
  assert.equal(detectFlexZone({ latitude: -34.6, longitude: -58.4 }).zone, undefined, "Sin polígonos verificados no inventamos una zona");
});

test("elección manual, tarifas con vigencia y retorno a automático se conservan en el estado existente", () => {
  const order: Order = { id: "100", createdAt: "2026-09-21T12:00:00Z", mode: "flex", cancelled: false, lines: [] };
  let state = updateBusiness(emptyState(), businessCommand.parse({ type: "note", id: "100", flexZone: "CORDON_2" }), order);
  assert.equal(resolveFlex(state.business, {}, "2026-09-21", state.business!.notes["100"].flexZone).cents, 420000);
  state = updateBusiness(state, businessCommand.parse({ type: "flexRate", zone: "CORDON_2", from: "2026-10-01", cents: 450000 }));
  assert.equal(resolveFlex(state.business, {}, "2026-09-30", "CORDON_2").cents, 420000);
  assert.equal(resolveFlex(state.business, {}, "2026-10-01", "CORDON_2").cents, 450000);
  assert.equal(resolveFlex(state.business, {}, "2026-10-01", "NONE").cents, 0);
  state = updateBusiness(state, businessCommand.parse({ type: "note", id: "100", flexZone: null }), order);
  assert.equal(state.business!.notes["100"].flexZone, undefined);
  assert.equal(state.orders.length, 0);
  assert.equal(businessCommand.safeParse({ type: "note", id: "100", flexZone: "incorrecta" }).success, false);
  assert.throws(() => updateBusiness(state, { type: "note", id: "100", flexZone: "CABA" }, { ...order, mode: "correo" }));
});

test("un envío compartido respeta la selección de cualquiera de sus órdenes y detecta conflictos", () => {
  const order: Order = { id: "1", shipmentId: "99", mode: "flex", createdAt: "2026-09-21T12:00:00Z", cancelled: false, lines: [] };
  const business = emptyBusiness();
  business.notes["2"] = { updatedAt: "", flexZone: "CORDON_2" };
  const orders = [order, { ...order, id: "2" }];
  const result = resolveFlexShipments(business, orders);
  assert.equal(result["1"].cents, 420000);
  assert.equal(result["2"].method, "manual");
  business.notes["1"] = { updatedAt: "", flexZone: "CABA" };
  assert.equal(resolveFlexShipments(business, orders)["1"].cents, undefined);
});

test("extrae dirección de entrega tanto nueva como legacy, sin usar facturación", () => {
  const address = { state: { name: "Buenos Aires" }, city: { name: "Villa Luzuriaga" }, municipality: { name: "La Matanza" }, neighborhood: { name: "Villa Luzuriaga" }, zip_code: "1753", latitude: -34.6, longitude: -58.5 };
  const modern = shipmentDestination({ id: 1, status: "shipped", destination: { shipping_address: address } });
  assert.deepEqual(modern, shipmentDestination({ id: 1, status: "shipped", receiver_address: address }));
  assert.equal(modern.municipality, "La Matanza");
  assert.equal(modern.postalCode, "1753");
  assert.equal(shipmentDestination({ id: 1, status: "shipped", receiver_address: { latitude: NaN, longitude: 900 } }).longitude, undefined);
});
