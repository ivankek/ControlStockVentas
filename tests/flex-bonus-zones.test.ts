import test from "node:test";
import assert from "node:assert/strict";
import { zoneBonus } from "../lib/flex-bonus-zones";
import { profitRows, reportTotals, type Sale } from "../lib/profit";
import { emptyState } from "../lib/domain";
import { emptyBusiness } from "../lib/business";

const sale = (more: Partial<Sale> = {}): Sale => ({ id: "100", createdAt: "2026-10-02T12:00:00Z", orderStatus: "paid", cancelled: false, mode: "flex", province: "Buenos Aires", city: "Hurlingham", shipmentId: "1000", lines: [{ productId: "MLA1:0", quantity: 1 }], grossCents: 4000000, receivedCents: 3000000, paymentBaseCents: 3000000, paymentIds: ["500"], issues: [], ...more });
const state = () => ({ ...emptyState(), business: emptyBusiness(), supplierProducts: [{ id: "p", name: "Producto", costs: [{ from: "2026-09-01", cents: 1050000 }] }], supplierLinks: { "MLA1:0": { supplierId: "p", units: 1 } } });

test("tabla del usuario: cercanas, medias, lejanas y límite inclusivo de $33.000", () => {
  for (const [city, full] of [["Hurlingham", 499000], ["Villa Tesei", 499000], ["Moron", 499000], ["Tres de Febrero", 499000], ["Merlo", 699000], ["General San Martín", 699000], ["San Miguel", 699000], ["Beccar", 899000], ["La Plata Oeste", 899000], ["José C. Paz", 899000], ["Nordelta", 899000], ["Guernica", 899000]] as const) {
    const dest = { province: "Buenos Aires", city };
    assert.equal(zoneBonus(dest, 3299999).cents, full, city);
    assert.equal(zoneBonus(dest, 3300000).cents, full / 10, city);
    assert.equal(zoneBonus(dest, 4400000).cents, full / 10, city);
  }
  assert.equal(zoneBonus({ province: "Capital Federal", city: "San Nicolás" }, 1940000).cents, 699000);
  assert.equal(zoneBonus({ province: "Mendoza", city: "San Martín" }, 1900000).cents, undefined);
  assert.equal(zoneBonus({ city: "San Martín" }, 1900000).cents, undefined);
  assert.equal(zoneBonus({ province: "Buenos Aires", city: "Destino desconocido" }, 1900000).cents, undefined);
  assert.equal(zoneBonus({ province: "Buenos Aires", city: "Hurlingham" }).cents, undefined);
});

test("La Matanza usa la clasificación logística, incluyendo georef y corrección manual", () => {
  const dest = { province: "Buenos Aires", municipality: "La Matanza", city: "Ramos Mejía" };
  assert.equal(zoneBonus(dest, 1900000).cents, 499000);
  assert.equal(zoneBonus({ ...dest, city: "González Catán" }, 4000000).cents, 89900);
  assert.equal(zoneBonus(dest, 1900000, "CORDON_2").cents, 899000);
  assert.equal(zoneBonus({ ...dest, city: "La Matanza", georef: { municipality: "La Matanza", zone: "CORDON_1", method: "georef-coordinates", reason: "" } }, 1900000).cents, 499000);
  assert.equal(zoneBonus({ province: "Buenos Aires", municipality: "General San Martín", city: "Billinghurst" }, 1900000).cents, 699000);
});

test("suma el estimado Flex al recibido, neto y total sin usar descuentos ni facturación fallida", () => {
  const input = sale({ flexCreditsUnavailable: true, flexCredits: [{ id: "old", shipmentId: "1000", cents: 899000 }] });
  const rows = profitRows(state(), [input]);
  assert.equal(rows[0].bonusAdded, 49900);
  assert.equal(rows[0].received, 3049900);
  assert.equal(rows[0].net, 3049900 - 1050000 - rows[0].shipping!);
  assert.equal(reportTotals(rows, emptyBusiness(), "2026-10-01", "2026-10-05").net, rows[0].net);
  assert.equal(rows[0].bonusUnresolved, false);
  const caba = profitRows(state(), [sale({ province: "Capital Federal", city: "San Nicolás", grossCents: 1940000, receivedCents: 1375000, paymentBaseCents: 1940000 })])[0];
  assert.equal(caba.received, 2074000);
  for (const mode of ["correo", "acordar"] as const) {
    const row = profitRows(state(), [sale({ mode })])[0];
    assert.equal(row.received, 3000000); assert.equal(row.bonusAdded, 0);
  }
  assert.equal(profitRows(state(), [sale({ cancelled: true, orderStatus: "cancelled" })])[0].bonusAdded, 0);
});

test("envío compartido: usa bruto conjunto y suma una vez; respeta recibido manual o ya incluido", () => {
  const orders = [sale({ grossCents: 2000000 }), sale({ id: "101", paymentIds: ["501"], grossCents: 2000000 })];
  const rows = profitRows(state(), orders);
  assert.equal(rows.reduce((sum, row) => sum + row.bonusAdded, 0), 49900);
  assert.equal(rows[1].bonusElsewhere, true);
  assert.equal(profitRows(state(), [sale({ receivedCents: 3049900 })])[0].bonusAdded, 0);
  const manual = state(); manual.business.notes["100"] = { updatedAt: "", netCents: 3100000 };
  assert.equal(profitRows(manual, [sale()])[0].received, 3100000);
  assert.equal(profitRows(state(), [sale({ receivedCents: undefined })])[0].net, undefined);
  assert.equal(profitRows(state(), [sale({ city: "Desconocido" })])[0].net, undefined);
});
