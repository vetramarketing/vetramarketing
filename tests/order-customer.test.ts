import assert from 'node:assert/strict';
import test from 'node:test';
import { createEmptyWorkspace } from '../src/lib/data';
import { newCustomer } from '../src/lib/customer-data';
import { recipientForCustomer } from '../src/lib/order-customer';
import { emptyShippingAddress, prepareOrderSave, type Order } from '../src/lib/orders';
import { deserializeWorkspace, serializeWorkspace } from '../src/lib/workspace-storage';

const now = '2026-11-18T05:00:00.000Z';
function order(overrides: Partial<Order> = {}): Order {
  return {
    id: 'order',
    number: '',
    companyId: 'vetra',
    customerName: 'Same name',
    orderedOn: '2026-11-18',
    items: [{ id: 'line', name: 'One', quantity: 1, unitPriceSatang: 100 }],
    discountSatang: 0,
    shippingSatang: 0,
    paymentMethod: 'transfer',
    status: 'ordered',
    recipient: {
      ...emptyShippingAddress(),
      name: 'Parcel recipient',
      phone: '0812345678',
      address: '21 Main Road',
    },
    carrier: 'flash',
    parcel: { weightGrams: 0, widthCm: 0, lengthCm: 0, heightCm: 0 },
    notes: '',
    createdAt: now,
    updatedAt: now,
    ...overrides,
  };
}

test('saving a custom customer creates and links a separate profile exactly once, including its delivery details', () => {
  const workspace = createEmptyWorkspace();
  const existing = { ...newCustomer('vetra', now), name: 'Same name' };
  workspace.customers = [existing];
  const draft = order();
  const saved = deserializeWorkspace(serializeWorkspace(prepareOrderSave(workspace, draft)));
  const entry = saved.orders![0];
  const customer = saved.customers.find((item) => item.id === entry.customerId)!;
  assert.notEqual(customer.id, existing.id);
  assert.equal(customer.companyId, entry.companyId);
  assert.equal(customer.name, draft.customerName);
  assert.equal(customer.contactName, '');
  assert.deepEqual(customer.recipient, entry.recipient);
  assert.equal(customer.phone, entry.recipient.phone);
  assert.deepEqual(recipientForCustomer(customer), entry.recipient);
  assert.equal(workspace.customers.length, 1);
  assert.equal(prepareOrderSave(saved, { ...entry, status: 'paid' }, entry).customers.length, 2);
});

test('a selected customer gains a delivery profile and later edits to old orders only sync changed fields', () => {
  const workspace = createEmptyWorkspace();
  const customer = {
    ...newCustomer('vetra', now),
    name: 'Company',
    contactName: 'Buyer',
    phone: '0822222222',
  };
  workspace.customers = [customer];
  assert.deepEqual(recipientForCustomer(customer), {
    ...emptyShippingAddress(),
    phone: customer.phone,
  });
  const draft = order({ customerId: customer.id });
  const first = prepareOrderSave(workspace, draft);
  const firstOrder = first.orders![0];
  const nextAddress = { ...draft.recipient, name: 'Another recipient', address: '22 Second Road' };
  const second = prepareOrderSave(
    first,
    order({ id: 'order-2', customerId: customer.id, recipient: nextAddress }),
  );
  const statusOnly = prepareOrderSave(second, { ...firstOrder, status: 'paid' }, firstOrder);
  assert.equal(statusOnly.customers, second.customers);
  const edit = prepareOrderSave(
    second,
    { ...firstOrder, recipient: { ...draft.recipient, province: 'Bangkok' } },
    firstOrder,
  );
  assert.deepEqual(edit.customers[0].recipient, { ...nextAddress, province: 'Bangkok' });
  assert.equal(edit.customers[0].name, customer.name);
  assert.equal(edit.customers[0].phone, customer.phone);
  assert.equal(edit.customers[0].contactName, customer.contactName);
  assert.equal(edit.orders?.[0].recipient.address, draft.recipient.address);
  assert.equal(edit.orders?.[1].recipient.province, '');
});

test('editing a historic order fills an absent delivery profile without changing the primary contact', () => {
  const workspace = createEmptyWorkspace();
  const customer = {
    ...newCustomer('vetra', now),
    name: 'Customer',
    contactName: 'Account contact',
    phone: '0822222222',
  };
  const original = order({ number: 'VT-20261118-001', customerId: customer.id });
  workspace.customers = [customer];
  workspace.orders = [original];
  const saved = prepareOrderSave(workspace, { ...original, status: 'completed' }, original);
  assert.deepEqual(saved.customers[0].recipient, original.recipient);
  assert.equal(saved.customers[0].phone, customer.phone);
  assert.equal(saved.customers[0].contactName, customer.contactName);
});

test('legacy customer without a recipient remains readable, and validation rejects a bad saved delivery profile', () => {
  const workspace = createEmptyWorkspace();
  const customer = { ...newCustomer('vetra', now), name: 'Legacy' };
  workspace.customers = [customer];
  assert.equal(
    deserializeWorkspace(serializeWorkspace(workspace)).customers[0].recipient,
    undefined,
  );
  assert.deepEqual(recipientForCustomer(customer), emptyShippingAddress());
  workspace.customers = [
    { ...customer, recipient: { ...emptyShippingAddress(), postalCode: '12a' } },
  ];
  assert.throws(() => serializeWorkspace(workspace), /postal code/);
});
