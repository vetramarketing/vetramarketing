import assert from 'node:assert/strict';
import test from 'node:test';
import {
  CONTACT_TYPES,
  customerContactHref,
  customerContactType,
  validCustomerContact,
} from '../src/lib/customer-contacts';
import type { CustomerContact, CustomerContactType } from '../src/lib/types';

const contact = (url: string, type?: CustomerContactType, label = ''): CustomerContact => ({
  id: 'contact-1',
  label,
  url,
  ...(type ? { type } : {}),
});

test('contact types recognize existing labels while preserving custom choices and source data', () => {
  const existing = contact('https://www.facebook.com/example', undefined, '  FACEBOOK  ');
  const before = structuredClone(existing);
  assert.equal(customerContactType(existing), 'facebook');
  assert.equal(customerContactHref(existing), existing.url);
  assert.deepEqual(existing, before);
  assert.equal(customerContactType(contact('', undefined, 'My sales team')), 'custom');
  assert.equal(customerContactType(contact('', 'custom', 'Facebook')), 'custom');
  assert.equal(customerContactType(contact('', undefined, 'อีเมล')), 'email');
  assert.deepEqual(
    CONTACT_TYPES.map((item) => item.value),
    ['facebook', 'line', 'whatsapp', 'email', 'instagram', 'phone', 'custom'],
  );
});

test('contact actions open HTTPS links, single-address email, and formatted phone numbers', () => {
  for (const { value } of CONTACT_TYPES) {
    assert.equal(
      customerContactHref(contact('https://example.com/contact', value)),
      'https://example.com/contact',
    );
    assert.equal(validCustomerContact(contact('', value)), true);
    assert.equal(customerContactHref(contact('', value)), '');
  }
  assert.equal(
    customerContactHref(contact('team+sales@example.co.th', 'email')),
    'mailto:team+sales@example.co.th',
  );
  assert.equal(
    customerContactHref(contact('MAILTO:team@example.com', 'email')),
    'mailto:team@example.com',
  );
  assert.equal(customerContactHref(contact('+66 (81) 234-5678', 'phone')), 'tel:+66812345678');
  assert.equal(customerContactHref(contact('tel:02 123 4567', 'phone')), 'tel:021234567');
  assert.equal(
    customerContactHref(contact('team@example.com', undefined, 'Email')),
    'mailto:team@example.com',
  );
});

test('contact actions reject unsafe schemes, headers, ambiguous recipients, and mismatched types', () => {
  for (const { value: type } of CONTACT_TYPES) {
    for (const url of [
      'javascript:alert(1)',
      'data:text/html,<script>alert(1)</script>',
      'http://example.com',
      'https://user:pass@example.com',
      'https://example.com\\redirect',
      ' https://example.com',
      'https://example.com\n',
    ]) {
      assert.equal(customerContactHref(contact(url, type)), '', `${type}: ${url}`);
      assert.equal(validCustomerContact(contact(url, type)), false, `${type}: ${url}`);
    }
  }
  for (const url of [
    'mailto:',
    'mailto:team@example.com?subject=Hi',
    'mailto:team@example.com?bcc=other@example.com',
    'team@example.com,other@example.com',
    'team@example.com;other@example.com',
    'team@example.com%0d%0aBcc:other@example.com',
    'team@example.com\r\n',
    'mailto:mailto:team@example.com',
    'team@example.com/path',
    'tel:+66812345678',
  ])
    assert.equal(customerContactHref(contact(url, 'email')), '', url);
  for (const url of [
    'tel:',
    'tel:+66812345678;ext=1',
    'tel:+66812345678?other=1',
    '++66812345678',
    '+66\n812345678',
    'tel:%2B66812345678',
    '1234567890123456',
    'mailto:team@example.com',
  ])
    assert.equal(customerContactHref(contact(url, 'phone')), '', url);
  for (const type of ['facebook', 'line', 'whatsapp', 'instagram', 'custom'] as const) {
    assert.equal(customerContactHref(contact('mailto:team@example.com', type)), '');
    assert.equal(customerContactHref(contact('+66812345678', type)), '');
  }
});
