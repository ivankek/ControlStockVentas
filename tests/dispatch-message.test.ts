import test from 'node:test';
import assert from 'node:assert/strict';
import { dispatchMessage, dispatchQueryResult } from '../lib/dispatch-query';
import { supplierReport } from '../lib/supplier';
import { emptyState, type Order } from '../lib/domain';

test('resumen por día: extremos inclusivos, packs y costos vigentes sin sumar pedidos sin fecha', () => {
  const state = emptyState();
  state.supplierProducts = [{ id: 'p', name: 'Cepillos', costs: [{ from: '2026-09-01', cents: 10000 }, { from: '2026-09-24', cents: 15000 }] }];
  state.supplierLinks = { 'MLA1:0': { supplierId: 'p', units: 2 } };
  const orders: Order[] = ['2026-09-22', '2026-09-23', '2026-09-24', '2026-09-25', undefined].map((dispatchedDate, i) => ({ id: String(i), createdAt: '', dispatchedDate, mode: 'flex', cancelled: false, lines: [{ productId: 'MLA1:0', quantity: 3 }] }));
  const query = dispatchQueryResult({ orders, products: [], syncedAt: '' }, '2026-09-24', '2026-09-23');
  assert.deepEqual(query.orders.map(o => o.dispatchedDate), ['2026-09-23', '2026-09-24']);
  assert.equal(query.unverified.length, 1);
  const days = query.orders.map(o => ({ date: o.dispatchedDate!, supplier: supplierReport(state, [o], o.dispatchedDate!) }));
  assert.equal(dispatchMessage(days), 'Miércoles 23/09:\nCepillos x 6u = $600\n\nJueves 24/09:\nCepillos x 6u = $900\n\nTotal = $1.500');
  assert.equal(dispatchMessage(days.slice(0, 1)), 'Miércoles 23/09:\nCepillos x 6u = $600\n\nTotal = $600');
});
test('el resumen advierte importes incompletos e incidencias', () => {
  const order: Order = { id: '1', createdAt: '', mode: 'flex', cancelled: true, lines: [{ productId: 'MLA1:0', quantity: 1 }] };
  const text = dispatchMessage([{ date: '2026-09-23', supplier: supplierReport(emptyState(), [order], '2026-09-23') }]);
  assert.match(text, /Pendiente de revisión/);
  assert.match(text, /Subtotal parcial/);
});
