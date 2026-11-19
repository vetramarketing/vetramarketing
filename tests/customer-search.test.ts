import assert from 'node:assert/strict';
import test from 'node:test';
import { createEmptyWorkspace, validateWorkspace } from '../src/lib/data';
import { buildCustomerSearchIndex, createCustomerSearchMatcher } from '../src/lib/customer-search';
import {
  recordedPurchasedUnits,
  selectCustomers,
  type CustomerListOptions,
} from '../src/lib/customer-list';
import { deserializeWorkspace, serializeWorkspace } from '../src/lib/workspace-storage';
import type { Customer, Workspace } from '../src/lib/types';

function customer(id: string, name = id): Customer {
  return {
    id,
    name,
    companyId: 'vetra',
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
    createdAt: '2026-01-01T00:00:00Z',
    updatedAt: '2026-10-28T00:00:00Z',
  };
}

/** Synthetic customer details exercise the full saved schema; no browser records are used. */
function fixture(): Workspace {
  const data = createEmptyWorkspace();
  data.products = [
    { id: 'honey', name: 'น้ำผึ้งดอกกาแฟ ESHAN 320g', imageUrl: '', sortOrder: 0 },
    { id: 'gift', name: 'Gift box', imageUrl: '', sortOrder: 1, deletedAt: '2026-10-28T00:00:00Z' },
  ];
  data.businessTypes[0].customerFields = [
    { id: 'loyalty', label: 'Membership level', type: 'text' },
    { id: 'renewal', label: 'Renewal date', type: 'date' },
    { id: 'empty-field', label: 'Delivery instructions', type: 'textarea' },
  ];
  data.businessTypes[1].customerFields = [
    { id: 'portal', label: 'ชื่อระบบ Portal', type: 'text', archived: true },
  ];
  const napa = customer('customer-napa', 'นภา Napa');
  Object.assign(napa, {
    organization: 'Coffee House',
    contactName: 'คุณมะลิ Mali',
    email: 'napa@example.com',
    phone: '+66 (81) 234-5678',
    website: 'https://coffee.example.com/contact',
    firstContactOn: '2024-02-29',
    lastContactOn: '2026-10-28',
    notes: 'Prefers morning delivery จัดส่งช่วงเช้า',
    productIds: ['honey', 'gift'],
    productQuantities: { honey: 0, gift: 1234 },
    socialLinks: [
      { id: 'line', label: 'Sales team', type: 'line', url: 'https://line.me/R/ti/p/@coffee-team' },
      { id: 'phone', label: 'Phone Call', url: 'tel:02 123 4567' },
      { id: 'email', label: 'Billing', type: 'email', url: 'accounts@example.com' },
      { id: 'custom', label: 'Support desk', type: 'custom', url: 'https://help.example.com' },
    ],
    domains: [{ id: 'domain', domain: 'service.example.com', expiresOn: '2027-03-01' }],
    githubAccounts: [
      {
        id: 'github',
        name: 'Coffee developer',
        email: 'developer@example.com',
        username: 'coffee-dev',
      },
    ],
    fieldValues: {
      loyalty: 'Gold',
      renewal: '2027-02-28',
      portal: 'Retained service',
      orphan: 'Legacy detail',
      'empty-field': '',
    },
  });
  const unknown = customer('customer-bee', 'Bee');
  unknown.productIds = ['honey'];
  data.customers = [unknown, napa];
  return validateWorkspace(data);
}

function search(data: Workspace, query: string): string[] {
  const match = createCustomerSearchMatcher(buildCustomerSearchIndex(data), query);
  return data.customers.filter(match).map((customer) => customer.id);
}

test('all saved customer sections are searchable, including typed and legacy contacts', () => {
  const data = fixture();
  for (const query of [
    'นภา',
    'Coffee House',
    'Mali',
    'napa@example.com',
    'coffee.example.com/contact',
    'จัดส่งช่วงเช้า',
    'VETRA',
    'ค้าปลีก',
    'Sales team',
    '@coffee-team',
    'Phone Call',
    'โทรศัพท์',
    'Billing',
    'อีเมล',
    'accounts@example.com',
    'Support desk',
    'help.example.com',
    'service.example.com',
    'GitHub coffee-dev',
    '@coffee-dev',
    'developer@example.com',
    'Coffee developer',
    'Membership Gold',
    'ชื่อระบบ Retained',
    'Legacy detail',
    'customer-napa',
  ]) {
    assert.ok(search(data, query).includes('customer-napa'), query);
  }
});

test('words can match across fields in any order while every word remains required', () => {
  const data = fixture();
  for (const query of [
    'ESHAN Napa VETRA',
    'VETRA Napa ESHAN',
    'Gold Mali morning',
    'coffee-dev 320g นภา',
    'Napa Gift box',
  ])
    assert.deepEqual(search(data, query), ['customer-napa'], query);
  assert.deepEqual(search(data, 'ESHAN nonexistent'), []);
  assert.deepEqual(search(data, 'Bee Napa'), []);
});

test('phone formatting is optional for primary and legacy contact phone numbers', () => {
  const data = fixture();
  for (const query of [
    '66812345678',
    '+66-81-234-5678',
    'Napa +66 (81) 234-5678',
    '021234567',
    '(02)123-4567',
    'tel:021234567',
  ])
    assert.deepEqual(search(data, query), ['customer-napa'], query);
  assert.deepEqual(search(data, '66812345679'), []);
  assert.deepEqual(
    search(data, '0812345678'),
    [],
    'do not invent country/local dialing equivalence',
  );
  assert.deepEqual(search(data, '()'), []);
});

test('calendar date searches match displayed first contact, last contact, domain expiry, and custom dates', () => {
  const data = fixture();
  for (const query of [
    '29/02/2024',
    '2024-02-29',
    '28/10/2026',
    '2026-10-28',
    '01/03/2027',
    '2027-03-01',
    'Renewal 28/02/2027',
    'Renewal 2027-02-28',
  ])
    assert.deepEqual(search(data, query), ['customer-napa'], query);
  assert.deepEqual(search(data, '28/02/2024'), []);
  assert.deepEqual(search(data, '2026-10-27'), []);
});

test('archived, moved and unknown custom fields keep their saved values searchable; blank labels do not match', () => {
  const data = fixture();
  assert.deepEqual(search(data, 'Portal service'), ['customer-napa']);
  assert.deepEqual(search(data, 'Legacy detail'), ['customer-napa']);
  assert.deepEqual(search(data, 'Delivery instructions'), []);
  data.companies[0].businessTypeId = 'other';
  assert.deepEqual(search(data, 'Membership Gold'), ['customer-napa']);
  assert.deepEqual(search(data, 'ชื่อระบบ Retained'), ['customer-napa']);
  data.businessTypes[0].customerFields[0].label = 'VIP tier';
  assert.deepEqual(search(data, 'VIP Gold'), ['customer-napa']);
});

test('Thai marks are preserved while Unicode, case and pasted spacing are normalized', () => {
  const data = fixture();
  assert.deepEqual(search(data, '  ＥＳＨＡＮ\tNAPA\nVETRA\u00a0STORE  '), ['customer-napa']);
  assert.deepEqual(search(data, 'น้ำ\u200bผึ้งดอกกาแฟ\ufeff Napa'), ['customer-napa']);
  data.customers[1].notes = 'ป่า café';
  assert.deepEqual(search(data, 'ป่า cafe\u0301'), ['customer-napa']);
  assert.deepEqual(search(data, 'ป้า'), []);
  assert.deepEqual(search(data, '[.*]'), []);
  assert.deepEqual(search(data, '\t \u200b\n'), ['customer-bee', 'customer-napa']);
});

test('known quantities including zero and retained products can be searched without treating unknown as zero', () => {
  const data = fixture();
  assert.deepEqual(search(data, 'purchased 0'), ['customer-napa']);
  assert.deepEqual(search(data, 'จำนวนที่ซื้อ 1,234'), ['customer-napa']);
  assert.deepEqual(search(data, 'Gift box 1234'), ['customer-napa']);
  data.products[0].name = 'Renamed honey';
  assert.deepEqual(search(data, 'Renamed Napa'), ['customer-napa']);
  assert.deepEqual(search(data, 'ESHAN'), []);
  assert.deepEqual(search(data, 'Bee purchased'), []);
});

test('matching respects company/product/date filters, sorting, Trash and recorded-unit totals', () => {
  const data = fixture();
  data.customers.push(
    { ...structuredClone(data.customers[1]), id: 'deleted', deletedAt: '2026-10-29T00:00:00Z' },
    { ...structuredClone(data.customers[1]), id: 'other-company', companyId: 'elsewhere' },
  );
  const options: CustomerListOptions = {
    companyId: 'vetra',
    productId: 'gift',
    search: 'Napa ESHAN',
    today: '2026-10-29',
    locale: 'en',
    sort: 'last-newest',
    lastContactFilter: 'recent',
    companies: data.companies,
    businessTypes: data.businessTypes,
    products: data.products,
  };
  const visible = selectCustomers(data.customers, options);
  assert.deepEqual(
    visible.map((item) => item.id),
    ['customer-napa'],
  );
  assert.equal(recordedPurchasedUnits(visible, options.productId), 1234);
  assert.deepEqual(
    selectCustomers(data.customers, { ...options, searchIndex: buildCustomerSearchIndex(data) }),
    visible,
  );
  assert.deepEqual(
    selectCustomers(data.customers, { ...options, lastContactFilter: 'missing' }),
    [],
  );
  assert.deepEqual(selectCustomers(data.customers, { ...options, productId: 'missing' }), []);
  assert.deepEqual(selectCustomers(data.customers, { ...options, locale: 'th' }), visible);
  assert.ok(!search(data, 'Napa').includes('deleted'));
});

test('indexing, filtering, and backup round trips preserve every customer record and relationship', () => {
  const data = fixture();
  const before = structuredClone(data);
  search(data, 'Napa');
  const roundTrip = deserializeWorkspace(serializeWorkspace(data));
  assert.deepEqual(search(roundTrip, 'Portal service'), ['customer-napa']);
  assert.deepEqual(roundTrip.customers, before.customers);
  assert.deepEqual(data, before);
  const legacy = customer('legacy');
  legacy.fieldValues = { unknown: 'Stored value' };
  const missingRelations = {
    ...data,
    companies: [],
    businessTypes: [],
    products: [],
    customers: [legacy],
  };
  assert.deepEqual(search(missingRelations, 'Stored value'), ['legacy']);
  assert.deepEqual(search(missingRelations, ''), ['legacy']);
});
