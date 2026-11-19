import test from 'node:test';
import assert from 'node:assert/strict';
import { newCustomer } from '../src/lib/customer-data';
import { buildCustomerPurchaseIndex } from '../src/lib/customer-purchases';
import {
  customerProductOrderHistory,
  migrateCustomerOrderQuantities,
  prepareCustomerQuantityOrder,
  prepareCustomerQuantityOrderItems,
} from '../src/lib/customer-orders';
import { createEmptyWorkspace } from '../src/lib/data';
import {
  emptyShippingAddress,
  prepareOrderSave,
  serializeOrder,
  validateOrder,
  validateOrderForShipment,
} from '../src/lib/orders';

const clock = new Date('2026-11-18T18:00:00Z');
function example() {
  const workspace = createEmptyWorkspace();
  workspace.products = ['beans', 'cups'].map((id, i) => ({
    id,
    name: 'Item ' + i,
    sortOrder: i,
    imageUrl: '',
    companyIds: ['vetra'],
  }));
  workspace.customers = [
    {
      ...newCustomer('vetra'),
      id: 'buyer',
      name: 'Customer A',
      lastContactOn: '2026-05-06',
      productIds: ['beans', 'cups'],
      productQuantities: { beans: 5, cups: 0 },
    },
    { ...newCustomer('vetra'), id: 'second', name: 'Customer B' },
  ];
  return workspace;
}

test('legacy quantities become dated orders, retain known zero and unknown units, and subtract only counted linked units', () => {
  const workspace = prepareCustomerQuantityOrder(example(), 'buyer', 'beans', 2, clock);
  const draft = workspace.orders![0];
  workspace.orders!.push(
    { ...draft, id: 'cancel', number: 'C', status: 'cancelled' },
    { ...draft, id: 'other-company', number: 'OC', companyId: 'other' },
    { ...draft, id: 'trash', number: 'T', deletedAt: clock.toISOString() },
    { ...draft, id: 'other-buyer', number: 'OB', customerId: 'someone-else' },
  );
  const migrated = migrateCustomerOrderQuantities(workspace);
  const openings = migrated.orders!.filter((order) => order.quantitySource === 'imported');
  assert.equal(openings.length, 2);
  assert.equal(openings[0].orderedOn, '2026-05-06');
  assert.equal(openings[0].number, 'VT-20260506-001');
  assert.equal(openings[1].orderedOn, '');
  assert.equal(openings[1].number, 'VT-UNDATED-00001');
  assert.deepEqual(
    openings[0].items.map(({ quantity }) => quantity),
    [3, 0],
  );
  assert.deepEqual(openings[1].items, []);
  assert.equal(migrateCustomerOrderQuantities(migrated), migrated);
  assert.deepEqual(migrateCustomerOrderQuantities(workspace), migrated);
  const totals = buildCustomerPurchaseIndex(migrated.orders!, migrated.customers);
  assert.equal(totals.get('buyer')?.total, 5);
  assert.equal(totals.get('buyer')?.byProduct.get('cups'), 0);
  assert.equal(totals.get('second'), undefined);
  assert.deepEqual(
    customerProductOrderHistory(migrated, 'buyer', 'beans')
      .map(({ order, quantity }) => [order.id, quantity])
      .sort(),
    [
      [draft.id, 2],
      ['cancel', 2],
      [openings[0].id, 3],
    ].sort(),
  );
  assert.equal(customerProductOrderHistory(migrated, 'second')[0].order, openings[1]);
});

test('quick orders use Bangkok today, retain product snapshots, and persist only the entered information', () => {
  const workspace = example();
  const first = prepareCustomerQuantityOrder(workspace, 'buyer', undefined, 1, clock);
  const second = prepareCustomerQuantityOrder(first, 'buyer', 'cups', 3, clock);
  const [unassigned, productOrder] = second.orders!;
  assert.equal(unassigned.orderedOn, '2026-11-19');
  assert.equal(unassigned.number, 'VT-20261119-001');
  assert.equal(unassigned.items[0].productId, undefined);
  assert.equal(productOrder.number, 'VT-20261119-002');
  assert.equal(productOrder.items[0].name, 'Item 1');
  for (const order of second.orders!) {
    const raw = serializeOrder(order);
    assert.equal('carrier' in raw, false);
    assert.equal('paymentMethod' in raw, false);
    assert.equal('unitPriceSatang' in raw.items[0], false);
    assert.equal('recipient' in raw, false);
    assert.deepEqual(validateOrder(raw), order);
    assert.throws(() => validateOrderForShipment(order), /Quantity-only/);
  }
  assert.equal(workspace.customers, second.customers);
  assert.equal(workspace.orders!.length, 0);
  const changed = prepareOrderSave(second, { ...unassigned, status: 'cancelled' }, unassigned);
  assert.equal(
    buildCustomerPurchaseIndex(changed.orders!, changed.customers).get('buyer')?.total,
    3,
  );
  assert.equal(customerProductOrderHistory(changed, 'buyer').length, 2);
  assert.equal(customerProductOrderHistory(changed, 'buyer', 'cups').length, 1);
  assert.throws(
    () => prepareOrderSave(changed, { ...unassigned, status: 'paid' }, unassigned),
    /changed/,
  );
});

test('quick order validation rejects an unavailable customer or product and invalid quantities', () => {
  const workspace = example();
  for (const quantity of [0, -2, 2.1, 1_000_001, NaN]) {
    assert.throws(
      () => prepareCustomerQuantityOrder(workspace, 'buyer', 'beans', quantity),
      /quantity/,
    );
  }
  workspace.products[0].companyIds = ['other'];
  assert.throws(() => prepareCustomerQuantityOrder(workspace, 'buyer', 'beans', 1), /products/);
  assert.throws(() => prepareCustomerQuantityOrder(workspace, 'buyer', 'missing', 1), /products/);
  workspace.customers[0].deletedAt = clock.toISOString();
  assert.throws(() => prepareCustomerQuantityOrder(workspace, 'buyer', undefined, 1), /customer/);
});

test('an initial order preserves multiple quantities in one linked order without changing the recipient profile', () => {
  const workspace = example();
  const customer: (typeof workspace.customers)[number] = {
    ...newCustomer('vetra', clock.toISOString()),
    id: 'new-buyer',
    name: 'Buyer',
    productIds: ['beans', 'cups'],
    recipient: { ...emptyShippingAddress(), name: 'Receiver' },
  };
  const withCustomer = { ...workspace, customers: [...workspace.customers, customer] };
  const lines = [
    { productId: 'beans', quantity: 2 },
    { productId: 'cups', quantity: 3 },
  ];
  const next = prepareCustomerQuantityOrderItems(withCustomer, customer.id, lines, clock);
  assert.equal(next.orders?.length, 1);
  assert.deepEqual(
    next.orders[0].items.map(({ productId, quantity }) => ({ productId, quantity })),
    lines,
  );
  assert.equal(next.orders[0].customerId, customer.id);
  assert.equal(next.orders[0].customerName, 'Buyer');
  assert.equal(next.customers.at(-1)?.recipient?.name, 'Receiver');
  assert.equal(customerProductOrderHistory(next, customer.id)[0].quantity, 5);

  const unavailable = {
    ...withCustomer,
    products: withCustomer.products.map((product) =>
      product.id === 'cups' ? { ...product, companyIds: ['other'] } : product,
    ),
  };
  assert.throws(
    () => prepareCustomerQuantityOrderItems(unavailable, customer.id, lines, clock),
    /active products belonging to this company/,
  );
  assert.deepEqual(withCustomer.orders, []);
});
