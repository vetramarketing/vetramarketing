import type {
  BusinessType,
  Company,
  Customer,
  CustomerContact,
  CustomerFieldDefinition,
  Product,
} from './types';
import {
  CONTACT_TYPES,
  safeCustomerUrl,
  validCustomerContact,
  validCustomerEmail,
} from './customer-contacts';
export { safeCustomerUrl, validCustomerEmail } from './customer-contacts';
import { validateShippingAddress } from './shipping-address';

const sections = new Set(['social', 'domains', 'github']);
const fieldTypes = new Set(['text', 'email', 'url', 'date', 'textarea']);
const reservedIds = new Set(['__proto__', 'constructor', 'prototype']);
export const MAX_CUSTOMER_PRODUCT_QUANTITY = 1_000_000;

export function newCustomer(companyId: string, now = new Date().toISOString()): Customer {
  return {
    id: crypto.randomUUID(),
    companyId,
    name: '',
    organization: '',
    contactName: '',
    email: '',
    phone: '',
    website: '',
    firstContactOn: '',
    lastContactOn: '',
    notes: '',
    socialLinks: [],
    productIds: [],
    domains: [],
    githubAccounts: [],
    fieldValues: {},
    createdAt: now,
    updatedAt: now,
  };
}

export function createDefaultBusinessTypes(): BusinessType[] {
  return [
    {
      id: 'retail',
      name: 'Store / retail',
      nameTh: 'ร้านค้า / ค้าปลีก',
      customerSections: ['social'],
      customerFields: [],
      sortOrder: 0,
    },
    {
      id: 'software-house',
      name: 'Software house',
      nameTh: 'ซอฟต์แวร์เฮาส์',
      customerSections: ['domains', 'github'],
      customerFields: [],
      sortOrder: 1,
    },
    {
      id: 'other',
      name: 'Other business',
      nameTh: 'ธุรกิจอื่น',
      customerSections: [],
      customerFields: [],
      sortOrder: 2,
    },
  ];
}

/** Customer calendar dates do not shift when the browser's timezone changes. */
export function validCustomerDate(value: string): boolean {
  if (!value) return true;
  if (!/^\d{4}-\d{2}-\d{2}$/.test(value)) return false;
  const [year, month, day] = value.split('-').map(Number);
  if (year < 1 || month < 1 || month > 12 || day < 1 || day > 31) return false;
  const date = new Date(0);
  date.setUTCFullYear(year, month - 1, day);
  date.setUTCHours(0, 0, 0, 0);
  return (
    date.getUTCFullYear() === year && date.getUTCMonth() === month - 1 && date.getUTCDate() === day
  );
}

export function validCustomerDomain(value: string): boolean {
  if (!value) return true;
  if (value.length > 253 || value.trim() !== value || /[\s/:@?#\\]/.test(value)) return false;
  try {
    const host = new URL(`https://${value}`).hostname;
    const labels = host.split('.');
    return (
      labels.length >= 2 &&
      !/^\d+(?:\.\d+){3}$/.test(host) &&
      !/^\d+$/.test(labels.at(-1) ?? '') &&
      labels.every((label) => /^[a-z0-9](?:[a-z0-9-]{0,61}[a-z0-9])?$/i.test(label))
    );
  } catch {
    return false;
  }
}

function record(value: unknown, label: string): Record<string, unknown> {
  if (!value || typeof value !== 'object' || Array.isArray(value))
    throw new Error(`${label} must be an object.`);
  return value as Record<string, unknown>;
}
function list(value: unknown, label: string, limit: number): unknown[] {
  if (!Array.isArray(value) || value.length > limit)
    throw new Error(`${label} must be a list of at most ${limit} items.`);
  return value;
}
function text(value: unknown, label: string, limit: number, required = false): string {
  if (
    typeof value !== 'string' ||
    value.length > limit ||
    (required && !value.trim()) ||
    /[\u0000-\u0008\u000b\u000c\u000e-\u001f\u007f]/.test(value)
  )
    throw new Error(`${label} is invalid.`);
  return value;
}
function optionalText(value: unknown, label: string, limit = 200): string {
  return value === undefined ? '' : text(value, label, limit);
}
function id(value: unknown, label: string): string {
  const result = text(value, label, 100, true);
  if (!/^[A-Za-z0-9_.-]+$/.test(result) || reservedIds.has(result))
    throw new Error(`${label} is invalid.`);
  return result;
}
function unique(items: readonly { id: string }[], label: string) {
  if (new Set(items.map((item) => item.id)).size !== items.length)
    throw new Error(`${label} contain duplicate IDs.`);
}
function dateOnly(value: unknown, label: string): string {
  const result = optionalText(value, label, 10);
  if (!validCustomerDate(result)) throw new Error(`${label} must be a valid YYYY-MM-DD date.`);
  return result;
}
function email(value: unknown, label: string): string {
  const result = optionalText(value, label, 254);
  if (!validCustomerEmail(result)) throw new Error(`${label} must be a valid email address.`);
  return result;
}
function url(value: unknown, label: string): string {
  const result = optionalText(value, label, 2048);
  if (!safeCustomerUrl(result)) throw new Error(`${label} must be a safe HTTPS URL.`);
  return result;
}
function timestamp(value: unknown, label: string): string {
  const result = text(value, label, 40, true);
  if (
    !/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(?:\.\d{1,3})?(?:Z|[+-]\d{2}:\d{2})$/.test(result) ||
    !validCustomerDate(result.slice(0, 10)) ||
    !Number.isFinite(Date.parse(result))
  )
    throw new Error(`${label} must be a valid timestamp.`);
  return result;
}

export function validateBusinessTypes(input: unknown): BusinessType[] {
  const fieldIds = new Set<string>();
  const types = list(input, 'Business types', 100).map((value) => {
    const item = record(value, 'Business type');
    const customerSections = list(item.customerSections, 'Customer sections', 3).map((value) => {
      if (typeof value !== 'string' || !sections.has(value))
        throw new Error('Customer section is invalid.');
      return value as BusinessType['customerSections'][number];
    });
    if (new Set(customerSections).size !== customerSections.length)
      throw new Error('Customer sections contain duplicates.');
    const customerFields = list(item.customerFields, 'Customer fields', 100).map((value) => {
      const field = record(value, 'Customer field');
      const fieldId = id(field.id, 'Customer field ID');
      if (fieldIds.has(fieldId))
        throw new Error('Customer field IDs must be unique across business types.');
      fieldIds.add(fieldId);
      if (typeof field.type !== 'string' || !fieldTypes.has(field.type))
        throw new Error('Customer field type is invalid.');
      if (field.archived !== undefined && typeof field.archived !== 'boolean')
        throw new Error('Customer field archived state is invalid.');
      return {
        id: fieldId,
        label: text(field.label, 'Customer field label', 100, true),
        type: field.type as CustomerFieldDefinition['type'],
        ...(field.archived === undefined ? {} : { archived: field.archived }),
      };
    });
    if (
      typeof item.sortOrder !== 'number' ||
      !Number.isSafeInteger(item.sortOrder) ||
      item.sortOrder < 0 ||
      item.sortOrder > 1_000_000
    )
      throw new Error('Business type sort order is invalid.');
    return {
      id: id(item.id, 'Business type ID'),
      name: text(item.name, 'Business type name', 100, true),
      ...(item.nameTh === undefined
        ? {}
        : { nameTh: text(item.nameTh, 'Thai business type name', 100) }),
      customerSections,
      customerFields,
      sortOrder: item.sortOrder,
    };
  });
  if (!types.length) throw new Error('A workspace needs at least one business type.');
  unique(types, 'Business types');
  return types;
}

export function validateCustomers(
  input: unknown,
  companies: readonly Pick<Company, 'id'>[],
  businessTypes: readonly BusinessType[],
  products: readonly Pick<Product, 'id'>[] = [],
): Customer[] {
  const companyIds = new Set(companies.map((company) => company.id));
  const existingProductIds = new Set(products.map((product) => product.id));
  const fields = new Map(
    businessTypes.flatMap((type) => type.customerFields.map((field) => [field.id, field] as const)),
  );
  const customers = list(input, 'Customers', 10000).map((value) => {
    const item = record(value, 'Customer');
    const companyId = id(item.companyId, 'Customer company ID');
    if (!companyIds.has(companyId)) throw new Error('A customer references a missing company.');
    const productIds =
      item.productIds === undefined
        ? undefined
        : list(item.productIds, 'Customer products', 10000).map((value) => {
            const productId = id(value, 'Customer product ID');
            if (!existingProductIds.has(productId))
              throw new Error('A customer references a missing product.');
            return productId;
          });
    if (productIds && new Set(productIds).size !== productIds.length)
      throw new Error('Customer products contain duplicate IDs.');
    const productQuantities =
      item.productQuantities === undefined
        ? undefined
        : Object.fromEntries(
            Object.entries(record(item.productQuantities, 'Customer product quantities')).map(
              ([rawProductId, quantity]) => {
                const productId = id(rawProductId, 'Customer product quantity ID');
                if (!productIds?.includes(productId))
                  throw new Error('Customer product quantity references an unassociated product.');
                if (
                  typeof quantity !== 'number' ||
                  !Number.isSafeInteger(quantity) ||
                  quantity < 0 ||
                  quantity > MAX_CUSTOMER_PRODUCT_QUANTITY
                )
                  throw new Error(
                    'Customer product quantity must be a whole number from 0 to 1000000.',
                  );
                return [productId, quantity] as const;
              },
            ),
          );
    const socialLinks = list(item.socialLinks ?? [], 'Customer social links', 100).map((value) => {
      const link = record(value, 'Social link');
      if (link.type !== undefined && !CONTACT_TYPES.some((option) => option.value === link.type))
        throw new Error('Social link type is invalid.');
      const contact: CustomerContact = {
        id: id(link.id, 'Social link ID'),
        label: optionalText(link.label, 'Social link label', 100),
        url: optionalText(link.url, 'Social link URL', 2048),
        ...(link.type === undefined ? {} : { type: link.type as CustomerContact['type'] }),
      };
      if (!validCustomerContact(contact))
        throw new Error(
          'Social link URL must be a safe HTTPS URL, email address, or phone number for its selected type.',
        );
      return contact;
    });
    const domains = list(item.domains ?? [], 'Customer domains', 100).map((value) => {
      const entry = record(value, 'Domain');
      const domain = text(entry.domain, 'Customer domain', 253, true);
      if (!validCustomerDomain(domain))
        throw new Error('Customer domain must be a valid domain without a protocol or path.');
      return {
        id: id(entry.id, 'Domain ID'),
        domain,
        expiresOn: dateOnly(entry.expiresOn, 'Domain expiry date'),
      };
    });
    const githubAccounts = list(item.githubAccounts ?? [], 'GitHub accounts', 100).map((value) => {
      const account = record(value, 'GitHub account');
      return {
        id: id(account.id, 'GitHub account ID'),
        name: optionalText(account.name, 'GitHub name'),
        email: email(account.email, 'GitHub email'),
        username: optionalText(account.username, 'GitHub username', 100),
      };
    });
    unique(socialLinks, 'Social links');
    unique(domains, 'Domains');
    unique(githubAccounts, 'GitHub accounts');
    const rawValues = record(item.fieldValues ?? {}, 'Customer field values');
    if (Object.keys(rawValues).length > 1000)
      throw new Error('Customer field values are too large.');
    const fieldValues: Record<string, string> = {};
    for (const [key, value] of Object.entries(rawValues)) {
      id(key, 'Customer field ID');
      const field = fields.get(key);
      const result = text(
        value,
        'Customer field value',
        !field || field.type === 'textarea' ? 10000 : 2048,
      );
      if (field?.type === 'email' && !validCustomerEmail(result))
        throw new Error(`${field.label} must be a valid email address.`);
      if (field?.type === 'url' && !safeCustomerUrl(result))
        throw new Error(`${field.label} must be a safe HTTPS URL.`);
      if (field?.type === 'date' && !validCustomerDate(result))
        throw new Error(`${field.label} must be a valid YYYY-MM-DD date.`);
      fieldValues[key] = result;
    }
    const createdAt = timestamp(item.createdAt, 'Customer creation date');
    const updatedAt = timestamp(item.updatedAt, 'Customer update date');
    if (Date.parse(updatedAt) < Date.parse(createdAt))
      throw new Error('Customer update date cannot precede its creation date.');
    return {
      id: id(item.id, 'Customer ID'),
      companyId,
      name: text(item.name, 'Customer name', 200, true),
      organization: optionalText(item.organization, 'Customer organization'),
      contactName: optionalText(item.contactName, 'Customer contact name'),
      email: email(item.email, 'Customer email'),
      phone: optionalText(item.phone, 'Customer phone', 100),
      ...(item.recipient === undefined
        ? {}
        : { recipient: validateShippingAddress(item.recipient, 'Customer recipient') }),
      website: url(item.website, 'Customer website'),
      ...(item.firstContactOn === undefined
        ? {}
        : { firstContactOn: dateOnly(item.firstContactOn, 'First contact date') }),
      lastContactOn: dateOnly(item.lastContactOn, 'Last contact date'),
      notes: optionalText(item.notes, 'Customer notes', 10000),
      socialLinks,
      ...(productIds === undefined ? {} : { productIds }),
      ...(productQuantities === undefined ? {} : { productQuantities }),
      domains,
      githubAccounts,
      fieldValues,
      createdAt,
      updatedAt,
      ...(item.deletedAt === undefined
        ? {}
        : { deletedAt: timestamp(item.deletedAt, 'Customer deletion date') }),
    };
  });
  unique(customers, 'Customers');
  return customers;
}
