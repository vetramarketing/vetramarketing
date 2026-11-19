import assert from 'node:assert/strict';
import test from 'node:test';
import { createEmptyWorkspace, pruneTrash, validateWorkspace } from '../src/lib/data';
import {
  defaultShippingSettings,
  emptyShippingAddress,
  formatMoneySatang,
  MAX_ORDER_MONEY_SATANG,
  nextOrderNumber,
  OrderSaveError,
  orderTotals,
  parseMoneySatang,
  prepareOrderSave,
  prepareOrderTrash,
  validateOrder,
  validateOrderForShipment,
  validateOrders,
  validateShippingSettings,
  type Order,
  type ShippingAddress,
} from '../src/lib/orders';
import {
  deserializeWorkspace,
  serializeWorkspace,
  WORKSPACE_KEY,
  V9_WORKSPACE_KEY,
} from '../src/lib/workspace-storage';
import {
  LocalWorkspaceRepository,
  WorkspaceRevisionConflict,
} from '../src/lib/workspace-repository';
import type { Customer, Workspace } from '../src/lib/types';

const now = '2026-11-05T05:00:00.000Z';
const address: ShippingAddress = {
  name: 'Example recipient',
  phone: '0812345678',
  address: '10 Test Road',
  subdistrict: 'Lumphini',
  district: 'Pathum Wan',
  province: 'Bangkok',
  postalCode: '10330',
};
function order(overrides: Partial<Order> = {}): Order {
  return {
    id: 'order-1',
    number: 'VT-20261105-001',
    companyId: 'vetra',
    customerName: 'Customer snapshot',
    orderedOn: '2026-11-05',
    items: [{ id: 'line-1', name: 'Product snapshot', quantity: 3, unitPriceSatang: 19999 }],
    discountSatang: 1000,
    shippingSatang: 4500,
    paymentMethod: 'transfer',
    status: 'ordered',
    sender: { ...address, name: 'Example sender' },
    recipient: { ...address },
    carrier: 'flash',
    parcel: { weightGrams: 500, widthCm: 10, lengthCm: 15, heightCm: 5 },
    trackingNumber: '',
    notes: '',
    createdAt: now,
    updatedAt: now,
    ...overrides,
  };
}
function workspace(): Workspace {
  const value = createEmptyWorkspace();
  value.companies.push({ ...value.companies[0], id: 'other', name: 'Other company' });
  value.products = [
    { id: 'product-1', name: 'Original name', companyIds: ['vetra'], imageUrl: '', sortOrder: 0 },
  ];
  const customer: Customer = {
    id: 'customer-1',
    companyId: 'vetra',
    name: 'Original customer',
    organization: '',
    contactName: '',
    email: '',
    phone: '',
    website: '',
    lastContactOn: '',
    notes: '',
    socialLinks: [],
    domains: [],
    githubAccounts: [],
    fieldValues: {},
    productIds: ['product-1'],
    productQuantities: { 'product-1': 9 },
    createdAt: now,
    updatedAt: now,
  };
  value.customers = [customer];
  return value;
}
function errorCode(code: OrderSaveError['code']) {
  return (error: unknown) => error instanceof OrderSaveError && error.code === code;
}

test('THB parses exact satang and rejects rounding, negative, blank, or excessive money', () => {
  assert.equal(parseMoneySatang('0'), 0);
  assert.equal(parseMoneySatang('0.10'), 10);
  assert.equal(parseMoneySatang('199.99'), 19999);
  assert.equal(parseMoneySatang(' 200.5 '), 20050);
  assert.equal(parseMoneySatang('1000000000'), MAX_ORDER_MONEY_SATANG);
  for (const invalid of [
    '',
    ' ',
    '-1',
    '1.001',
    '1e3',
    '1,000',
    'NaN',
    'Infinity',
    '1000000000.01',
  ])
    assert.equal(parseMoneySatang(invalid), null, invalid);
  assert.match(formatMoneySatang(19999), /199\.99/);
});

test('totals stay exact and reject discounts above subtotal or multiplication overflow', () => {
  assert.deepEqual(orderTotals(order()), {
    subtotalSatang: 59997,
    discountSatang: 1000,
    shippingSatang: 4500,
    totalSatang: 63497,
  });
  assert.throws(() => orderTotals(order({ discountSatang: 59998 })), /Discount/);
  assert.throws(
    () =>
      orderTotals(
        order({
          items: [
            {
              id: 'large',
              name: 'Large',
              quantity: 1_000_000,
              unitPriceSatang: MAX_ORDER_MONEY_SATANG,
            },
          ],
        }),
      ),
    /subtotal/,
  );
  assert.throws(() => orderTotals(order({ shippingSatang: MAX_ORDER_MONEY_SATANG })), /total/);
  assert.throws(
    () =>
      orderTotals(
        order({ items: [{ id: 'zero', name: 'Zero', quantity: 0, unitPriceSatang: 0 }] }),
      ),
    /quantity/,
  );
});

test('new orders use Flash defaults and date sequence includes other companies and Trash', () => {
  assert.deepEqual(defaultShippingSettings(), { defaultCarrier: 'flash', senders: {} });
  const source = workspace();
  source.orders = [order({ number: 'VT-20261105-008', companyId: 'other', deletedAt: now })];
  assert.equal(nextOrderNumber(source.orders, '2026-11-05'), 'VT-20261105-009');
  assert.equal(nextOrderNumber(source.orders, '2026-11-06'), 'VT-20261106-001');
  const saved = prepareOrderSave(source, order({ id: 'new', number: '' }));
  assert.equal(saved.orders?.at(-1)?.number, 'VT-20261105-009');
  assert.equal(source.orders.length, 1, 'preparation does not mutate source');
  assert.throws(() => nextOrderNumber([], '2026-02-30'), /date/);
});

test('manual order statuses can be saved without sender, parcel weight or carrier tracking', () => {
  const manual = order({
    items: [],
    discountSatang: 0,
    recipient: emptyShippingAddress(),
    parcel: { weightGrams: 0, widthCm: 0, lengthCm: 0, heightCm: 0 },
  });
  delete manual.sender;
  delete manual.trackingNumber;
  for (const status of ['ordered', 'cod', 'paid', 'shipped', 'completed', 'cancelled'] as const) {
    const candidate = { ...manual, paymentMethod: 'cod' as const, status };
    assert.deepEqual(validateOrder(candidate), candidate);
  }
  assert.throws(() => validateOrderForShipment(manual), /item/);
  assert.throws(() => validateOrderForShipment({ ...manual, items: order().items }), /Sender/);
  assert.throws(() => validateOrder({ ...manual, status: 'cod' }), /payment method/);
});

test('v9 legacy orders migrate with original bookkeeping, addresses and tracking intact', async () => {
  const raw = {
    ...serializeWorkspace(workspace()),
    version: 9,
    orders: [
      ['draft', 'unpaid', 'transfer'],
      ['confirmed', 'unpaid', 'cod'],
      ['confirmed', 'paid', 'cod'],
      ['completed', 'paid', 'transfer'],
      ['shipped', 'unpaid', 'cod'],
      ['cancelled', 'refunded', 'cash'],
    ].map(([status, paymentStatus, paymentMethod], index) => ({
      ...order({
        id: 'order-' + index,
        number: 'VT-test-' + index,
        trackingNumber: 'TEST-' + index,
      }),
      status,
      paymentStatus,
      paymentMethod,
    })),
  };
  const original = JSON.stringify(raw);
  const values = new Map([[V9_WORKSPACE_KEY, original]]);
  const repo = new LocalWorkspaceRepository(
    {
      getItem: (key) => values.get(key) ?? null,
      setItem: (key, value) => {
        values.set(key, value);
      },
    },
    null,
  );
  const { workspace: migrated } = await repo.load();
  const legacyOrders = raw.orders.map((before) =>
    migrated.orders!.find((entry) => entry.id === before.id)!,
  );
  assert.deepEqual(
    legacyOrders.map(({ status }) => status),
    ['ordered', 'cod', 'paid', 'completed', 'shipped', 'cancelled'],
  );
  for (const [i, entry] of legacyOrders.entries()) {
    const prior = raw.orders[i];
    assert.equal('paymentStatus' in entry, false);
    assert.deepEqual(entry.legacyWorkflow, {
      status: prior.status,
      paymentStatus: prior.paymentStatus,
    });
    assert.deepEqual(entry.sender, prior.sender);
    assert.equal(entry.trackingNumber, prior.trackingNumber);
  }
  assert.deepEqual(
    deserializeWorkspace(JSON.parse(values.get(WORKSPACE_KEY)!)).orders,
    migrated.orders,
  );
  assert.equal(values.get(V9_WORKSPACE_KEY), original);
});

test('runtime validation rejects malformed nested data, invalid enums, dates, and labels', () => {
  const source = order();
  for (const bad of [
    { ...source, items: null },
    { ...source, recipient: null },
    { ...source, carrier: 'fake' },
    { ...source, orderedOn: '2026-02-29' },
    { ...source, orderedOn: '' },
    { ...source, companyId: '../bad' },
    { ...source, discountSatang: 1.5 },
    { ...source, trackingNumber: '<script>' },
    { ...source, parcel: { ...source.parcel, weightGrams: -1 } },
    { ...source, recipient: { ...address, postalCode: 'abcde' } },
    { ...source, updatedAt: '2020-01-01T00:00:00.000Z' },
    { ...source, label: { id: 'pdf', name: 'label.pdf', size: 20, sha256: 'wrong', addedAt: now } },
  ])
    assert.throws(() => validateOrder(bad));
  assert.throws(() => validateOrder(source, new Set(['other'])), /missing company/);
  assert.throws(() => validateOrders([source, source], new Set(['vetra'])), /duplicate IDs/);
  assert.throws(
    () => validateOrders([source, { ...source, id: 'second' }], new Set(['vetra'])),
    /duplicate order numbers/,
  );
  assert.throws(() => validateOrders({}, new Set(['vetra'])), /Orders/);
});

test('new relationships must belong to the order company while snapshots remain independent', () => {
  const source = workspace();
  const draft = order({
    customerId: 'customer-1',
    items: [{ ...order().items[0], productId: 'product-1' }],
  });
  const saved = prepareOrderSave(source, draft);
  assert.equal(saved.orders?.[0].customerName, 'Customer snapshot');
  assert.equal(saved.orders?.[0].items[0].name, 'Product snapshot');
  assert.deepEqual(
    saved.customers[0].productQuantities,
    source.customers[0].productQuantities,
    'orders never change manually recorded quantities',
  );
  assert.throws(() => prepareOrderSave(source, { ...draft, companyId: 'other' }), /customer/);
  assert.throws(
    () => prepareOrderSave(source, { ...draft, customerId: undefined, companyId: 'other' }),
    /products/,
  );
  source.customers[0].deletedAt = now;
  assert.throws(() => prepareOrderSave(source, draft), /customer/);
  source.customers[0].deletedAt = undefined;
  source.products[0].deletedAt = now;
  assert.throws(() => prepareOrderSave(source, draft), /products/);
});

test('renamed, reassigned, or expired catalog relationships preserve historical order snapshots', () => {
  const source = workspace();
  const original = order({
    customerId: 'customer-1',
    items: [{ ...order().items[0], productId: 'product-1' }],
  });
  source.orders = [original];
  source.customers[0].deletedAt = '2026-09-01T00:00:00.000Z';
  source.products[0].deletedAt = '2026-09-01T00:00:00.000Z';
  const pruned = pruneTrash(source, new Date(now));
  assert.equal(pruned.customers.length, 0);
  assert.equal(pruned.products.length, 0);
  assert.deepEqual(pruned.orders?.[0], original);
  const saved = prepareOrderSave(pruned, { ...original, notes: 'Updated history' }, original);
  assert.equal(saved.orders?.[0].items[0].productId, 'product-1');
  assert.equal(validateWorkspace(saved).orders?.[0].customerId, 'customer-1');
});

test('stale editors cannot replace concurrent saves, reuse IDs, or resurrect deleted orders', () => {
  const source = workspace();
  const original = order();
  source.orders = [{ ...original, notes: 'Saved in another tab' }];
  assert.throws(
    () => prepareOrderSave(source, { ...original, notes: 'Stale' }, original),
    errorCode('conflict'),
  );
  assert.throws(() => prepareOrderSave(source, original), errorCode('conflict'));
  assert.throws(
    () => prepareOrderSave({ ...source, orders: [] }, original, original),
    errorCode('conflict'),
  );
  const deleted = { ...original, deletedAt: now };
  assert.throws(
    () => prepareOrderSave({ ...source, orders: [deleted] }, original, deleted),
    errorCode('conflict'),
  );
  source.orders = [original];
  assert.throws(
    () => prepareOrderSave(source, { ...original, number: 'different' }, original),
    /number/,
  );
});

test('tracking numbers are unique per carrier, case-insensitive, including orders in Trash', () => {
  const source = workspace();
  source.orders = [order({ trackingNumber: 'TH12345TEST', deletedAt: now })];
  const second = order({ id: 'order-2', number: '', trackingNumber: 'th12345test' });
  assert.throws(() => prepareOrderSave(source, second), errorCode('duplicate-tracking'));
  assert.doesNotThrow(() => prepareOrderSave(source, { ...second, carrier: 'thailand-post' }));
  assert.throws(
    () =>
      validateOrders(
        [source.orders![0], { ...second, number: 'VT-20261105-002' }],
        new Set(['vetra']),
      ),
    /tracking number/,
  );
});

test('official shipment booking locks carrier details while notes and manual status remain editable', () => {
  const source = workspace();
  const original = order({
    trackingNumber: 'TH12345TEST',
    shipment: {
      source: 'flash-api',
      mode: 'production',
      trackingNumber: 'TH12345TEST',
      bookedAt: now,
      requestId: 'order-1',
    },
  });
  source.orders = [original];
  const changed = prepareOrderSave(
    source,
    { ...original, notes: 'Packed', status: 'shipped' },
    original,
  );
  assert.equal(changed.orders?.[0].status, 'shipped');
  for (const mutation of [
    { carrier: 'other' as const },
    { trackingNumber: 'DIFFERENT' },
    { shipment: undefined },
    { recipient: { ...address, address: 'Changed after booking' } },
    { discountSatang: 0 },
    { status: 'cancelled' as const },
    { parcel: { ...original.parcel, weightGrams: 700 } },
  ])
    assert.throws(
      () => prepareOrderSave(source, { ...original, ...mutation }, original),
      errorCode('shipment-locked'),
    );
  assert.throws(() => validateOrder({ ...original, carrier: 'other' }), /does not match/);
  assert.throws(() => validateOrder({ ...original, status: 'cancelled' }), /Cancel the carrier/);
});

test('label metadata is preserved and cannot silently move to another tracking number', () => {
  const source = workspace();
  const original = order({
    trackingNumber: 'TH12345TEST',
    label: {
      id: 'label-1',
      name: 'carrier-label.pdf',
      size: 1234,
      sha256: 'a'.repeat(64),
      addedAt: now,
    },
  });
  source.orders = [original];
  assert.deepEqual(validateOrder(original).label, original.label);
  assert.throws(
    () => prepareOrderSave(source, { ...original, trackingNumber: 'TH67890TEST' }, original),
    errorCode('shipment-locked'),
  );
  assert.doesNotThrow(() =>
    prepareOrderSave(
      source,
      { ...original, label: undefined, trackingNumber: 'TH67890TEST' },
      original,
    ),
  );
  assert.throws(() => validateOrder({ ...original, trackingNumber: '' }), /tracking number/);
  for (const mutation of [
    { recipient: { ...original.recipient, address: 'A different destination' } },
    { parcel: { ...original.parcel, weightGrams: 700 } },
    { paymentMethod: 'cod' as const },
    { discountSatang: 0 },
    { items: [{ ...original.items[0], quantity: 4 }] },
  ])
    assert.throws(
      () => prepareOrderSave(source, { ...original, ...mutation }, original),
      errorCode('shipment-locked'),
    );
  assert.doesNotThrow(() =>
    prepareOrderSave(source, { ...original, notes: 'Parcel packed', status: 'paid' }, original),
  );
  assert.doesNotThrow(() =>
    prepareOrderSave(
      source,
      {
        ...original,
        recipient: { ...original.recipient, address: 'A different destination' },
        label: { ...original.label!, id: 'replacement', sha256: 'b'.repeat(64) },
      },
      original,
    ),
  );
});

test('one carrier PDF cannot be assigned to multiple orders, including Trash', () => {
  const source = workspace();
  const original = order({
    trackingNumber: 'TH12345TEST',
    label: { id: 'label-1', name: 'label.pdf', size: 123, sha256: 'a'.repeat(64), addedAt: now },
    deletedAt: now,
  });
  source.orders = [original];
  const second = order({
    id: 'second',
    number: '',
    trackingNumber: 'TH23456TEST',
    label: original.label,
  });
  assert.throws(() => prepareOrderSave(source, second), errorCode('duplicate-label'));
  assert.throws(
    () =>
      prepareOrderSave(source, { ...second, label: { ...original.label!, id: 'different-id' } }),
    errorCode('duplicate-label'),
  );
  assert.throws(
    () => validateOrders([original, { ...second, number: 'VT-20261105-002' }], new Set(['vetra'])),
    /label is already/,
  );
});

test('test shipments cannot be reported as fulfilled real deliveries', () => {
  const training = order({
    trackingNumber: 'TH12345TEST',
    shipment: {
      source: 'flash-api',
      mode: 'training',
      trackingNumber: 'TH12345TEST',
      bookedAt: now,
      requestId: 'order-1',
    },
  });
  assert.doesNotThrow(() => validateOrder(training));
  assert.throws(() => validateOrder({ ...training, status: 'shipped' }), /test shipment/);
  assert.throws(() => validateOrder({ ...training, status: 'completed' }), /test shipment/);
});

test('Move to Trash is revision-safe and preserves attached label metadata', () => {
  const source = workspace();
  const original = order({
    trackingNumber: 'TH12345TEST',
    label: { id: 'label-1', name: 'label.pdf', size: 123, sha256: 'a'.repeat(64), addedAt: now },
  });
  source.orders = [original];
  const next = prepareOrderTrash(source, original, now);
  assert.equal(next.orders?.[0].deletedAt, now);
  assert.deepEqual(next.orders?.[0].label, original.label);
  assert.equal(source.orders[0].deletedAt, undefined);
  assert.throws(() => prepareOrderTrash(next, original, now), errorCode('conflict'));
  const booked = {
    ...original,
    shipment: {
      source: 'flash-api' as const,
      mode: 'production' as const,
      trackingNumber: 'TH12345TEST',
      bookedAt: now,
      requestId: 'order-1',
    },
  };
  assert.throws(
    () => prepareOrderTrash({ ...source, orders: [booked] }, booked, now),
    errorCode('shipment-locked'),
  );
});

test('legacy backups get empty orders and Flash defaults; malformed order records are never discarded', () => {
  const source = {
    ...serializeWorkspace(createEmptyWorkspace()),
    version: 10,
    orders: undefined,
    shippingSettings: undefined,
  };
  const restored = deserializeWorkspace(source);
  assert.deepEqual(restored.orders, []);
  assert.deepEqual(restored.shippingSettings, defaultShippingSettings());
  assert.throws(() => deserializeWorkspace({ ...source, orders: [{ id: 'broken' }] }), /Order/);
  assert.throws(() => deserializeWorkspace({ ...source, orders: null }), /Orders/);
  assert.throws(
    () =>
      deserializeWorkspace({
        ...source,
        shippingSettings: { defaultCarrier: 'fake', senders: {} },
      }),
    /carrier/,
  );
});

test('orders and sender settings round-trip through backups and revision-checked repository saves', async () => {
  const source = workspace();
  source.orders = [order()];
  source.shippingSettings = { defaultCarrier: 'flash', senders: { vetra: { ...address } } };
  const restored = deserializeWorkspace(serializeWorkspace(source));
  assert.deepEqual(restored.orders, source.orders);
  assert.deepEqual(restored.shippingSettings, source.shippingSettings);
  const values = new Map<string, string>();
  const storage = {
    getItem: (key: string) => values.get(key) ?? null,
    setItem: (key: string, value: string) => {
      values.set(key, value);
    },
  };
  const first = new LocalWorkspaceRepository(storage, null);
  const baseline = await first.load();
  await first.commit({
    workspace: source,
    expectedRevision: baseline.revision,
    operationId: 'create-orders',
  });
  const loaded = await new LocalWorkspaceRepository(storage, null).load();
  assert.deepEqual(loaded.workspace.orders, source.orders);
  assert.deepEqual(loaded.workspace.shippingSettings, source.shippingSettings);
  const priorBytes = values.get(WORKSPACE_KEY);
  await assert.rejects(
    first.commit({
      workspace: { ...source, orders: [] },
      expectedRevision: baseline.revision,
      operationId: 'stale-order-delete',
    }),
    WorkspaceRevisionConflict,
  );
  assert.equal(values.get(WORKSPACE_KEY), priorBytes);
});

test('Trash retains orders through 30 days and preserves retained label and shipment records', () => {
  const source = workspace();
  source.orders = [
    order({ id: 'recent', number: 'VT-20261105-001', deletedAt: '2026-10-06T05:00:00.001Z' }),
    order({ id: 'expired', number: 'VT-20261105-002', deletedAt: '2026-10-06T05:00:00.000Z' }),
    order({ id: 'active', number: 'VT-20261105-003' }),
  ];
  assert.deepEqual(
    pruneTrash(source, new Date(now)).orders?.map((item) => item.id),
    ['recent', 'active'],
  );
  assert.equal(source.orders.length, 3);
});

test('order numbering does not reuse a number after Trash expiry and backup reload', () => {
  const source = workspace();
  source.orders = [order({ number: 'VT-20261105-009', deletedAt: '2026-09-01T00:00:00.000Z' })];
  const pruned = pruneTrash(source, new Date(now));
  assert.deepEqual(pruned.orders, []);
  assert.equal(pruned.orderSequences?.['20261105'], 9);
  const restored = deserializeWorkspace(serializeWorkspace(pruned));
  const saved = prepareOrderSave(restored, order({ id: 'after-expiry', number: '' }));
  assert.equal(saved.orders?.[0].number, 'VT-20261105-010');
  assert.equal(saved.orderSequences?.['20261105'], 10);
  assert.throws(
    () => prepareOrderSave(restored, order({ id: 'reused', number: 'VT-20261105-009' })),
    /already used/,
  );
  assert.throws(
    () =>
      deserializeWorkspace({ ...serializeWorkspace(pruned), orderSequences: { '20260230': 1 } }),
    /sequence date/,
  );
});

test('sender settings reject unknown companies and prototype keys while allowing partial profiles', () => {
  const source = { defaultCarrier: 'flash', senders: { vetra: emptyShippingAddress() } };
  assert.deepEqual(validateShippingSettings(source, new Set(['vetra'])), source);
  assert.throws(() => validateShippingSettings(source, new Set(['other'])), /missing company/);
  assert.throws(
    () =>
      validateShippingSettings(
        JSON.parse('{"defaultCarrier":"flash","senders":{"__proto__":{}}}'),
        new Set(['vetra']),
      ),
    /invalid/,
  );
});
