import test from 'node:test';
import assert from 'node:assert/strict';
import { dispatchMessage, dispatchQueryResult, filterDispatchOrders, type DispatchFilters } from '../lib/dispatch-query';
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
  assert.match(text, /Orden 1/);
  assert.match(text, /MLA1:0/);
  assert.match(text, /Venta cancelada/);
});

test('detalle filtrable por despacho y estados, con motivos concretos y totales intactos', () => {
  const state = emptyState();
  state.products = [{ id: 'MLA1:0', name: 'Cepillo', costs: [] }];
  state.supplierProducts = [{ id: 'p', name: 'Cepillo proveedor', costs: [{ from: '2026-09-25', cents: 1000 }] }];
  state.supplierLinks = { 'MLA1:0': { supplierId: 'p', units: 1 } };
  const orders: Order[] = [
    { id: '1', createdAt: '2026-09-01', dispatchedDate: '2026-09-23', mode: 'flex', cancelled: false, shippingStatus: 'delivered', orderStatus: 'paid', lines: [{ productId: 'MLA1:0', quantity: 1 }] },
    { id: '2', createdAt: '2026-09-21', dispatchedDate: '2026-09-25', mode: 'correo', cancelled: false, shippingStatus: 'shipped', orderStatus: 'paid', lines: [{ productId: 'MLA1:0', quantity: 1 }] },
  ];
  const days = orders.map((o) => ({ date: o.dispatchedDate!, supplier: supplierReport(state, [o], o.dispatchedDate!) }));
  assert.match(days[0].supplier.orders[0].missing[0], /Cepillo.*sin costo vigente al 2026-09-23/);
  const result = { ...dispatchQueryResult({ orders, products: state.products, syncedAt: '' }, '2026-09-25', '2026-09-23'), supplier: { ...days[1].supplier, orders: days.flatMap((d) => d.supplier.orders), complete: false }, days };
  const filters: DispatchFilters = { from: '', to: '', shipping: '', order: '', reviewOnly: false, sort: 'desc' };
  assert.deepEqual(filterDispatchOrders(result, filters).map((o) => o.id), ['2', '1']);
  assert.deepEqual(filterDispatchOrders(result, { ...filters, shipping: 'delivered' }).map((o) => o.id), ['1']);
  assert.deepEqual(filterDispatchOrders(result, { ...filters, reviewOnly: true }).map((o) => o.id), ['1']);
  assert.deepEqual(filterDispatchOrders(result, { ...filters, from: '2026-09-25', to: '2026-09-25' }).map((o) => o.id), ['2']);
  assert.equal(filterDispatchOrders(result, { ...filters, order: 'cancelled' }).length, 0);
  assert.deepEqual(filterDispatchOrders(result, { ...filters, sort: 'review' }).map((o) => o.id), ['1', '2']);
  assert.equal(result.supplier.totalCents, 1000);
  assert.deepEqual(result.orders.map((o) => o.id), ['1', '2']);
});
