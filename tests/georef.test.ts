import { test } from "node:test";
import assert from "node:assert/strict";
import { createGeorefResolver } from "../lib/georef";
import { detectFlexZone } from "../lib/flex-zones";
import type { Shipment } from "../lib/shipping";
const shipment = (city: string, extra = {}): Shipment => ({ id: 1, status: "shipped", logistic_type: "self_service", receiver_address: { state: { name: "Buenos Aires" }, city: { name: city }, ...extra } });
const row = (nombre: string, district: string) => ({ nombre, provincia: { id: "06", nombre: "Buenos Aires" }, departamento: { nombre: district } });
const mock = (body: unknown) => (async () => Response.json(body)) as typeof fetch;

test("Georef classifies exact locality and manual selection still wins", async () => {
  const georef = await createGeorefResolver(mock({ total: 1, localidades: [row("Wilde", "Avellaneda")] }))(shipment("WILDE"));
  assert.equal(georef?.zone, "CORDON_1");
  assert.equal(georef?.method, "georef-locality");
  assert.equal(detectFlexZone({ georef }, "CORDON_3").zone, "CORDON_3");
});
test("same-named localities are ambiguous even when both districts share a tariff", async () => {
  const result = await createGeorefResolver(mock({ total: 2, localidades: [row("San Francisco Solano", "Quilmes"), row("San Francisco Solano", "Almirante Brown")] }))(shipment("San Francisco Solano"));
  assert.equal(result?.zone, undefined);
  assert.match(result!.reason, /ambigua/);
});
test("coordinates resolve Solano without requiring a locality guess or forwarding credentials", async () => {
  const resolver = createGeorefResolver((async (url, init) => {
    assert.match(String(url), /ubicacion\?/);
    assert.equal(init?.headers, undefined);
    assert.equal(init?.cache, "no-store");
    return Response.json({ ubicacion: row("", "Quilmes") });
  }) as typeof fetch);
  assert.equal((await resolver(shipment("Solano", { latitude: -34.7, longitude: -58.3 })))?.zone, "CORDON_2");
});
test("La Matanza without a classified locality stays unknown", async () => {
  const result = await createGeorefResolver(mock({ ubicacion: row("", "La Matanza") }))(shipment("Desconocida", { latitude: -34.7, longitude: -58.5 }));
  assert.equal(result?.zone, undefined);
});
test("exact street number and locality resolve address, fuzzy matches do not", async () => {
  const resolver = createGeorefResolver(mock({ direcciones: [{ ...row("", "Avellaneda"), localidad: { nombre: "Wilde" }, calle: { nombre: "GUAMINI" }, altura: { valor: 5945 } }] }));
  const result = await resolver(shipment("Wilde", { street_name: "Guaminí", street_number: "5945" }));
  assert.equal(result?.method, "georef-address");
  assert.equal(result?.zone, "CORDON_1");
});
test("outage preserves aliases and opens circuit; known municipalities skip Georef", async () => {
  let calls = 0;
  const resolver = createGeorefResolver((async () => { calls++; throw Error("offline"); }) as typeof fetch);
  assert.equal(await resolver(shipment("Wilde", { municipality: { name: "Avellaneda" } })), undefined);
  assert.equal(calls, 0);
  assert.equal(await resolver(shipment("Wilde")), undefined);
  assert.equal(await resolver(shipment("Sarandí")), undefined);
  assert.equal(calls, 1);
  assert.equal(detectFlexZone({ province: "Buenos Aires", city: "Wilde" }).zone, "CORDON_1");
});
test("duplicate destinations share one lookup within request", async () => {
  let calls = 0;
  const resolver = createGeorefResolver((async () => { calls++; return Response.json({ total: 1, localidades: [row("Wilde", "Avellaneda")] }); }) as typeof fetch);
  await Promise.all([resolver(shipment("Wilde")), resolver(shipment("Wilde"))]);
  assert.equal(calls, 1);
});
