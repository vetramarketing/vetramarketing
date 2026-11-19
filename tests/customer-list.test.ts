import assert from 'node:assert/strict';
import test from 'node:test';
import { createEmptyWorkspace } from '../src/lib/data';
import {
  recordedPurchasedUnits,
  selectCustomers,
  type CustomerListOptions,
} from '../src/lib/customer-list';
import type { Customer } from '../src/lib/types';
import { buildCustomerPurchaseIndex } from '../src/lib/customer-purchases';
import { validateOrder } from '../src/lib/orders';

const workspace = createEmptyWorkspace();
const options: CustomerListOptions = {
  companyId: 'all',
  productId: 'all',
  search: '',
  today: '2026-03-01',
  locale: 'en',
  sort: 'name-asc',
  lastContactFilter: 'all',
  companies: workspace.companies,
  businessTypes: workspace.businessTypes,
  products: [
    { id: 'product-1', name: 'Honey jar', imageUrl: '', sortOrder: 0 },
    { id: 'product-2', name: 'Gift box', imageUrl: '', sortOrder: 1 },
  ],
};

function customer(id: string, name: string, lastContactOn = '', firstContactOn?: string): Customer {
  return {
    id,
    companyId: 'vetra',
    name,
    organization: '',
    contactName: '',
    email: '',
    phone: '',
    website: '',
    firstContactOn,
    lastContactOn,
    notes: '',
    socialLinks: [],
    domains: [],
    githubAccounts: [],
    fieldValues: {},
    createdAt: '2026-01-01T00:00:00.000Z',
    updatedAt: '2026-01-01T00:00:00.000Z',
  };
}

function ids(customers: Customer[], changes: Partial<CustomerListOptions> = {}) {
  return selectCustomers(customers, { ...options, ...changes }).map((item) => item.id);
}

test('customer list keeps company and Trash scope while searching saved details', () => {
  const matching = customer('matching', 'Ada');
  matching.productIds = ['product-1'];
  const otherCompany = { ...customer('other-company', 'Other'), companyId: 'elsewhere' };
  otherCompany.notes = 'Honey jar';
  const deleted = { ...customer('deleted', 'Deleted'), deletedAt: '2026-02-01T00:00:00.000Z' };
  deleted.notes = 'Honey jar';
  const input = [otherCompany, deleted, matching];
  assert.deepEqual(ids(input, { companyId: 'vetra', search: 'honey jar' }), ['matching']);
  assert.equal(input[0], otherCompany, 'sorting must not mutate workspace order');
});

test('last contact filters use a Bangkok calendar 30-day window and keep future dates separate', () => {
  const input = [
    customer('recent-start', 'A', '2026-01-31'),
    customer('earlier', 'B', '2026-01-30'),
    customer('today', 'C', '2026-03-01'),
    customer('future', 'D', '2026-03-02'),
    customer('missing', 'E'),
  ];
  assert.deepEqual(ids(input, { lastContactFilter: 'recent' }), ['recent-start', 'today']);
  assert.deepEqual(ids(input, { lastContactFilter: 'earlier' }), ['earlier']);
  assert.deepEqual(ids(input, { lastContactFilter: 'recorded' }), [
    'recent-start',
    'earlier',
    'today',
    'future',
  ]);
  assert.deepEqual(ids(input, { lastContactFilter: 'missing' }), ['missing']);
});

test('newest last contact puts unknown dates first; other date sorts keep them last', () => {
  const input = [
    customer('b', 'Customer 10', '2026-02-01', '2024-03-01'),
    customer('a', 'Customer 2', '2026-02-01', '2024-02-29'),
    customer('c', 'Customer 1', '', ''),
    customer('d', 'Customer 3', '2026-02-28', '2026-03-02'),
  ];
  assert.deepEqual(ids(input, { sort: 'name-asc' }), ['c', 'a', 'd', 'b']);
  assert.deepEqual(ids(input, { sort: 'name-desc' }), ['b', 'd', 'a', 'c']);
  assert.deepEqual(ids(input, { sort: 'last-newest' }), ['c', 'd', 'a', 'b']);
  assert.deepEqual(ids(input, { sort: 'last-oldest' }), ['a', 'b', 'd', 'c']);
  assert.deepEqual(ids(input, { sort: 'first-longest' }), ['a', 'b', 'c', 'd']);
  assert.deepEqual(ids(input, { sort: 'first-shortest' }), ['b', 'a', 'c', 'd']);
});

test('product selection matches stable associations, including customers with several products', () => {
  const honey = customer('honey', 'Honey');
  honey.productIds = ['product-1'];
  const gift = customer('gift', 'Gift');
  gift.productIds = ['product-2'];
  const both = customer('both', 'Both');
  both.productIds = ['product-1', 'product-2'];
  const none = customer('none', 'None');
  const input = [honey, gift, both, none];

  assert.deepEqual(ids(input, { productId: 'product-1' }), ['both', 'honey']);
  assert.deepEqual(ids(input, { productId: 'product-2' }), ['both', 'gift']);
  assert.deepEqual(ids(input, { productId: 'all' }), ['both', 'gift', 'honey', 'none']);
  assert.deepEqual(ids(input, { productId: 'unlisted-product' }), []);
  assert.deepEqual(
    input,
    [honey, gift, both, none],
    'selection must not change stored associations',
  );
});

test('first-contact sorting validates leap dates and keeps invalid, future, and absent dates last', () => {
  const input = [
    customer('valid-leap', 'B', '', '2024-02-29'),
    customer('invalid-leap', 'A', '', '2025-02-29'),
    customer('future', 'C', '', '2026-03-02'),
    customer('absent', 'D'),
    customer('today', 'E', '', '2026-03-01'),
    customer('oldest', 'F', '', '2020-01-01'),
  ];
  const before = structuredClone(input);
  assert.deepEqual(ids(input, { sort: 'first-longest' }), [
    'oldest',
    'valid-leap',
    'today',
    'invalid-leap',
    'future',
    'absent',
  ]);
  assert.deepEqual(ids(input, { sort: 'first-shortest' }), [
    'today',
    'valid-leap',
    'oldest',
    'invalid-leap',
    'future',
    'absent',
  ]);
  assert.deepEqual(input, before);
});

test('product selection combines with company, search, and contact-date filters', () => {
  const matching = customer('matching', 'Ada', '2026-02-28');
  matching.productIds = ['product-1', 'product-2'];
  matching.notes = 'ready to call';
  const older = customer('older', 'Bea', '2025-01-01');
  older.productIds = ['product-1'];
  older.notes = 'ready to call';
  const wrongProduct = customer('wrong-product', 'Cia', '2026-02-28');
  wrongProduct.productIds = ['product-2'];
  wrongProduct.notes = 'ready to call';
  const otherCompany = { ...matching, id: 'other-company', companyId: 'elsewhere' };
  const deleted = { ...matching, id: 'deleted', deletedAt: '2026-02-28T00:00:00.000Z' };
  assert.deepEqual(
    ids([otherCompany, deleted, older, wrongProduct, matching], {
      companyId: 'vetra',
      productId: 'product-1',
      search: 'ready to call',
      lastContactFilter: 'recent',
    }),
    ['matching'],
  );
});

test('customer filters, search and totals follow linked orders even without a catalog association', () => {
  const buyer = customer('id-buyer', 'Buyer');
  const base = {
    id: 'q1',
    number: 'VT-20261118-001',
    companyId: buyer.companyId,
    customerId: buyer.id,
    customerName: buyer.name,
    orderedOn: '2026-11-18',
    quantitySource: 'quick',
    status: 'ordered',
    createdAt: '2026-11-18T12:00:00Z',
    updatedAt: '2026-11-18T12:00:00Z',
  };
  const items = [{ id: 'i1', productId: 'archived', name: 'Honey', quantity: 7 }];
  const purchases = buildCustomerPurchaseIndex(
    [
      validateOrder({ ...base, items }),
      validateOrder({ ...base, id: 'q2', items: [{ id: 'i2', name: 'Quantity', quantity: 2 }] }),
      validateOrder({ ...base, id: 'q3', companyId: 'other', items }),
      validateOrder({ ...base, id: 'q4', status: 'cancelled', items }),
      validateOrder({ ...base, id: 'q5', deletedAt: base.createdAt, items }),
    ],
    [buyer],
  );
  assert.equal(recordedPurchasedUnits([buyer], 'all', purchases), 9);
  assert.equal(recordedPurchasedUnits([buyer], 'archived', purchases), 7);
  assert.deepEqual(
    ids([buyer], { productId: 'archived', search: 'honey purchased 7', purchases }),
    [buyer.id],
  );
  assert.deepEqual(ids([buyer], { search: 'units 9', purchases }), [buyer.id]);
});

test('units sort uses the displayed product scope and keeps unrecorded quantities last', () => {
  const a = customer('a', 'A');
  const b = customer('b', 'B');
  const unknown = customer('unknown', 'Unknown');
  const zero = customer('zero', 'Zero');
  const input = [a, b, unknown, zero];
  for (const item of input) item.productIds = ['product-1'];
  const purchases = new Map([
    [a.id, { total: 9, byProduct: new Map([['product-1', 2]]), productNames: new Map() }],
    [b.id, { total: 5, byProduct: new Map([['product-1', 5]]), productNames: new Map() }],
  ]);
  const customersWithUnrecordedUnits = new Set(['vetra:unknown']);
  const scope = { purchases, customersWithUnrecordedUnits };
  assert.deepEqual(ids(input, { ...scope, sort: 'units-highest' }), ['a', 'b', 'zero', 'unknown']);
  assert.deepEqual(ids(input, { ...scope, productId: 'product-1', sort: 'units-highest' }), [
    'b',
    'a',
    'zero',
    'unknown',
  ]);
  assert.deepEqual(ids(input, { ...scope, productId: 'product-1', sort: 'units-lowest' }), [
    'zero',
    'a',
    'b',
    'unknown',
  ]);
});

test('product and contact sorts use the first displayed value and keep blanks last', () => {
  const a = customer('a', 'A');
  a.productIds = ['product-1', 'product-2'];
  a.socialLinks = [{ id: 'social-a', label: 'Phone Call', url: '0812345678' }];
  const b = customer('b', 'B');
  b.socialLinks = [
    { id: 'invalid-url', label: 'WhatsApp', url: '' },
    { id: 'social-b', label: 'Email', url: 'customer@example.com' },
  ];
  const none = customer('none', 'None');
  const input = [a, b, none];
  const purchases = new Map([
    [
      b.id,
      {
        total: 1,
        byProduct: new Map([['archived', 1]]),
        productNames: new Map([['archived', 'Gift']]),
      },
    ],
  ]);
  assert.deepEqual(ids(input, { purchases, sort: 'products-asc' }), ['b', 'a', 'none']);
  assert.deepEqual(ids(input, { purchases, sort: 'products-desc' }), ['a', 'b', 'none']);
  assert.deepEqual(ids(input, { sort: 'contact-asc' }), ['b', 'a', 'none']);
  assert.deepEqual(ids(input, { sort: 'contact-desc' }), ['a', 'b', 'none']);
});

test('recorded purchased units sum known counts only for associated products in scope', () => {
  const both = customer('both', 'Both');
  both.productIds = ['product-1', 'product-2'];
  both.productQuantities = { 'product-1': 2, 'product-2': 3 };
  const unknownAndZero = customer('unknown', 'Unknown and zero');
  unknownAndZero.productIds = ['product-1', 'product-2'];
  unknownAndZero.productQuantities = { 'product-2': 0 };
  const honey = customer('honey', 'Honey');
  honey.productIds = ['product-1'];
  honey.productQuantities = { 'product-1': 4 };
  const unassociated = customer('unassociated', 'Unassociated');
  unassociated.productIds = ['product-2'];
  unassociated.productQuantities = { 'product-1': 99, 'product-2': 0 };
  const deleted = customer('deleted', 'Deleted');
  deleted.productIds = ['product-1'];
  deleted.productQuantities = { 'product-1': 100 };
  deleted.deletedAt = '2026-02-28T00:00:00.000Z';
  const input = [both, unknownAndZero, honey, unassociated, deleted];
  const before = structuredClone(input);

  assert.equal(recordedPurchasedUnits(input, 'all'), 9);
  assert.equal(recordedPurchasedUnits(input, 'product-1'), 6);
  assert.equal(recordedPurchasedUnits(input, 'product-2'), 3);
  assert.equal(recordedPurchasedUnits(input, 'missing-product'), 0);
  assert.deepEqual(input, before, 'counting must not change customer data');
});
