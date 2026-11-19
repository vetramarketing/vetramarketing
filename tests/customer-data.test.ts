import assert from 'node:assert/strict';
import test from 'node:test';
import { createEmptyWorkspace, pruneTrash, validateWorkspace } from '../src/lib/data';
import {
  createDefaultBusinessTypes,
  safeCustomerUrl,
  validCustomerDate,
  validCustomerDomain,
  validCustomerEmail,
} from '../src/lib/customer-data';
import { prepareCustomerDocuments } from '../src/lib/mongodb-customers';
import {
  LocalWorkspaceRepository,
  WorkspaceRevisionConflict,
} from '../src/lib/workspace-repository';
import {
  deserializeWorkspace,
  serializeWorkspace,
  V7_WORKSPACE_KEY,
  WORKSPACE_KEY,
} from '../src/lib/workspace-storage';
import type { Customer, Workspace } from '../src/lib/types';
import { cloudinaryImageUrl, type CloudinaryImage } from '../src/lib/cloudinary-media';

function customer(): Customer {
  return {
    id: 'customer-1',
    companyId: 'vetra',
    name: 'คุณลูกค้า',
    organization: 'Example Co.',
    contactName: 'Poom',
    email: 'contact@example.com',
    phone: '+66 81 234 5678',
    website: 'https://example.com',
    lastContactOn: '2026-10-28',
    notes: 'Keep exact customer details.',
    socialLinks: [{ id: 'social-1', label: 'Facebook', url: 'https://www.facebook.com/example' }],
    domains: [{ id: 'domain-1', domain: 'example.com', expiresOn: '2028-02-29' }],
    githubAccounts: [
      {
        id: 'github-1',
        name: 'Example account',
        email: 'dev@example.com',
        username: 'example-user',
      },
    ],
    fieldValues: { 'contract-date': '2026-10-01', 'historic-field': 'Preserved value' },
    createdAt: '2026-10-01T07:00:00.000Z',
    updatedAt: '2026-10-28T07:00:00.000Z',
  };
}
function workspace(): Workspace {
  const result = createEmptyWorkspace();
  result.companies[0].businessTypeId = 'software-house';
  result.businessTypes[1].customerFields.push({
    id: 'contract-date',
    label: 'Contract date',
    type: 'date',
    archived: true,
  });
  result.customers = [customer()];
  return result;
}
function storage() {
  const values = new Map<string, string>();
  return {
    values,
    getItem: (key: string) => values.get(key) ?? null,
    setItem: (key: string, value: string) => {
      values.set(key, value);
    },
  };
}

test('customer profiles survive repository reload, backup, company type changes, and Mongo preparation', async () => {
  const source = workspace();
  source.customers[0].firstContactOn = '2024-02-29';
  const before = structuredClone(source.customers[0]);
  const store = storage();
  const repository = new LocalWorkspaceRepository(store);
  const baseline = await repository.load();
  await repository.commit({
    workspace: source,
    expectedRevision: baseline.revision,
    operationId: 'customer-create',
  });
  const loaded = await new LocalWorkspaceRepository(store).load();
  assert.deepEqual(loaded.workspace.customers[0], before);
  assert.equal(JSON.parse(store.getItem(WORKSPACE_KEY)!).version, 12);
  assert.deepEqual(deserializeWorkspace(serializeWorkspace(source)).customers[0], before);

  const changedType = {
    ...loaded.workspace,
    companies: loaded.workspace.companies.map((company) => ({
      ...company,
      businessTypeId: 'retail',
    })),
  };
  const valid = validateWorkspace(changedType);
  assert.deepEqual(valid.customers[0], before, 'hidden business-specific details remain intact');
  const documents = prepareCustomerDocuments(valid, 'workspace-1');
  assert.deepEqual(documents.customers[0], { ...before, workspaceId: 'workspace-1' });
  assert.equal(documents.businessTypes.length, createDefaultBusinessTypes().length);
  assert.throws(() => prepareCustomerDocuments(valid, '../another-workspace'), /workspace ID/);
});

test('first contact date keeps legacy customers unchanged and validates saved dates', () => {
  const legacy = workspace();
  assert.equal(Object.hasOwn(validateWorkspace(legacy).customers[0], 'firstContactOn'), false);
  legacy.customers[0].firstContactOn = '2024-02-29';
  assert.equal(validateWorkspace(legacy).customers[0].firstContactOn, '2024-02-29');
  legacy.customers[0].firstContactOn = '2025-02-29';
  assert.throws(() => validateWorkspace(legacy), /First contact date/);
});

test('v7 store workspaces migrate all relationships to companies and preserve the original recovery bytes', async () => {
  const current = createEmptyWorkspace();
  const legacyLogo: CloudinaryImage = {
    provider: 'cloudinary',
    cloudName: 'vetra-test',
    assetId: 'legacy-company-logo',
    publicId: 'vetra-marketing/workspace-legacy/stores/vetra/logo-1',
    version: 1792200000,
    format: 'webp',
    width: 512,
    height: 512,
    bytes: 40000,
  };
  current.companies[0].logoAsset = legacyLogo;
  current.companies[0].logoImageUrl = cloudinaryImageUrl(legacyLogo);
  current.products = [
    { id: 'product-1', name: 'Honey', imageUrl: '', companyIds: ['vetra'], sortOrder: 0 },
  ];
  current.groups = [
    {
      id: 'group-1',
      companyId: 'vetra',
      name: 'Exact group name',
      facebookId: '173363867184869',
      category: '',
      notes: '',
    },
  ];
  current.destinations = [
    {
      id: 'group-1',
      companyId: 'vetra',
      platform: 'facebook',
      kind: 'group',
      externalId: '173363867184869',
      name: 'Exact group name',
      groupId: 'group-1',
    },
  ];
  current.posts = [
    {
      id: 'post-1',
      companyId: 'vetra',
      groupId: 'group-1',
      destinationId: 'group-1',
      product: 'Honey',
      productId: 'product-1',
      platform: 'facebook',
      publishedAt: '2026-10-01T07:00:00.000Z',
      facebookPostId: '1879127649941807',
      url: '',
      viewers: 0,
      color: '#263b4b',
    },
  ];
  const saved = serializeWorkspace(current);
  const { companies, businessTypes: _types, customers: _customers, ...rest } = saved;
  const legacy = {
    ...rest,
    version: 7,
    stores: companies.map(({ businessTypeId: _type, ...company }) => company),
    products: saved.products.map(({ companyIds, ...product }) => ({
      ...product,
      storeIds: companyIds,
    })),
    groups: saved.groups.map(({ companyId, ...group }) => ({ ...group, storeId: companyId })),
    destinations: saved.destinations?.map(({ companyId, ...destination }) => ({
      ...destination,
      storeId: companyId,
    })),
    posts: saved.posts.map(({ companyId, ...post }) => ({ ...post, storeId: companyId })),
  };
  const raw = JSON.stringify(legacy);
  const store = storage();
  store.setItem(V7_WORKSPACE_KEY, raw);
  const result = await new LocalWorkspaceRepository(store).load();
  assert.equal(result.workspace.companies[0].id, 'vetra');
  assert.equal(result.workspace.companies[0].name, 'VETRA STORE');
  assert.equal(result.workspace.companies[0].businessTypeId, 'retail');
  assert.deepEqual(result.workspace.companies[0].logoAsset, legacyLogo);
  assert.equal(result.workspace.companies[0].logoImageUrl, cloudinaryImageUrl(legacyLogo));
  assert.deepEqual(result.workspace.products[0].companyIds, ['vetra']);
  assert.equal(result.workspace.posts[0].companyId, 'vetra');
  assert.equal(result.workspace.groups[0].companyId, 'vetra');
  assert.equal(result.workspace.destinations?.[0].companyId, 'vetra');
  assert.equal(result.workspace.posts[0].productId, 'product-1');
  assert.deepEqual(result.workspace.customers, []);
  assert.equal(store.getItem(V7_WORKSPACE_KEY), raw);
  const stored = JSON.parse(store.getItem(WORKSPACE_KEY)!);
  assert.equal(stored.version, 12);
  assert.equal('stores' in stored, false);
  assert.equal('storeId' in stored.posts[0], false);
  assert.equal('storeIds' in stored.products[0], false);
});

test('customer date, email, URL, and domain validation handles real calendar boundaries and unsafe values', () => {
  for (const validator of [
    validCustomerDate,
    validCustomerEmail,
    safeCustomerUrl,
    validCustomerDomain,
  ])
    assert.equal(validator(''), true);
  assert.equal(validCustomerDate('2028-02-29'), true);
  for (const value of [
    '2027-02-29',
    '2026-02-30',
    '2026-13-01',
    '28/10/2026',
    '2026-10-28T00:00:00Z',
  ])
    assert.equal(validCustomerDate(value), false, value);
  assert.equal(validCustomerEmail('person+team@example.co.th'), true);
  assert.equal(validCustomerEmail('person @example.com'), false);
  assert.equal(safeCustomerUrl('https://example.com/contact?source=crm'), true);
  for (const value of [
    'javascript:alert(1)',
    'http://example.com',
    'https://user:pass@example.com',
    'https://example.com\\other',
  ])
    assert.equal(safeCustomerUrl(value), false, value);
  assert.equal(validCustomerDomain('sub.example.co.th'), true);
  for (const value of [
    'https://example.com',
    'example.com/path',
    'user@example.com',
    '-bad.example',
    'localhost',
    '127.0.0.1',
  ])
    assert.equal(validCustomerDomain(value), false, value);
});

test('customer validation rejects broken relationships and malformed details without dropping good values', () => {
  const valid = workspace();
  const variants: Array<[(copy: Workspace) => void, RegExp]> = [
    [
      (copy) => {
        copy.customers[0].companyId = 'missing';
      },
      /missing company/,
    ],
    [
      (copy) => {
        copy.companies[0].businessTypeId = 'missing';
      },
      /missing business type/,
    ],
    [
      (copy) => {
        copy.customers.push(structuredClone(copy.customers[0]));
      },
      /duplicate IDs/,
    ],
    [
      (copy) => {
        copy.customers[0].domains[0].expiresOn = '2027-02-29';
      },
      /expiry date/,
    ],
    [
      (copy) => {
        copy.customers[0].domains[0].domain = 'https://example.com';
      },
      /valid domain/,
    ],
    [
      (copy) => {
        copy.customers[0].socialLinks[0].url = 'javascript:alert(1)';
      },
      /HTTPS URL/,
    ],
    [
      (copy) => {
        copy.customers[0].githubAccounts[0].email = 'invalid';
      },
      /GitHub email/,
    ],
    [
      (copy) => {
        copy.customers[0].fieldValues['contract-date'] = 'not-a-date';
      },
      /Contract date/,
    ],
    [
      (copy) => {
        copy.customers[0].fieldValues = JSON.parse('{"__proto__":"bad"}');
      },
      /Customer field ID/,
    ],
    [
      (copy) => {
        copy.customers[0].updatedAt = '2026-09-01T00:00:00.000Z';
      },
      /precede/,
    ],
  ];
  for (const [change, message] of variants) {
    const copy = structuredClone(valid);
    change(copy);
    assert.throws(() => validateWorkspace(copy), message);
  }
  assert.deepEqual(validateWorkspace(valid).customers[0], customer());
});

test('customer Trash keeps details for 30 days, then expires only the deleted customer', () => {
  const source = workspace();
  source.customers[0].deletedAt = '2026-10-01T07:00:00.000Z';
  assert.deepEqual(
    pruneTrash(source, new Date('2026-10-31T06:59:59.000Z')).customers,
    source.customers,
  );
  const expired = pruneTrash(source, new Date('2026-10-31T07:00:00.000Z'));
  assert.deepEqual(expired.customers, []);
  assert.deepEqual(expired.companies, source.companies);
  assert.equal(source.customers.length, 1);
});

test('v8 backups require company types and customer collections; stale customer saves cannot overwrite newer data', async () => {
  const saved = serializeWorkspace(workspace());
  for (const field of ['customers', 'businessTypes']) {
    const invalid: Record<string, unknown> = structuredClone(saved);
    delete invalid[field];
    assert.throws(() => deserializeWorkspace(invalid), /missing required/);
  }
  const missingType = structuredClone(saved) as unknown as { companies: Record<string, unknown>[] };
  delete missingType.companies[0].businessTypeId;
  assert.throws(() => deserializeWorkspace(missingType), /missing required/);
  const store = storage();
  const first = new LocalWorkspaceRepository(store);
  const baseline = await first.load();
  const second = new LocalWorkspaceRepository(store);
  const stale = await second.load();
  await first.commit({
    workspace: workspace(),
    expectedRevision: baseline.revision,
    operationId: 'create-customer',
  });
  await assert.rejects(
    second.commit({
      workspace: stale.workspace,
      expectedRevision: stale.revision,
      operationId: 'stale-customer-save',
    }),
    WorkspaceRevisionConflict,
  );
  assert.equal((await second.load()).workspace.customers[0].name, 'คุณลูกค้า');
});

test('multiple customer products and typed contacts survive save, backup, reload, and company changes', async () => {
  const source = workspace();
  source.products = [
    { id: 'product-1', name: 'First product', imageUrl: '', companyIds: ['vetra'], sortOrder: 0 },
    { id: 'product-2', name: 'Second product', imageUrl: '', companyIds: ['vetra'], sortOrder: 1 },
  ];
  source.customers[0].productIds = ['product-2', 'product-1'];
  source.customers[0].productQuantities = { 'product-2': 12, 'product-1': 0 };
  source.customers[0].socialLinks.push(
    { id: 'email-contact', type: 'email', label: 'Email', url: 'sales@example.com' },
    { id: 'phone-contact', type: 'phone', label: 'Phone Call', url: '+66 (81) 234-5678' },
    {
      id: 'custom-contact',
      type: 'custom',
      label: 'Exact custom label',
      url: 'https://example.com/help',
    },
  );
  const before = structuredClone(source.customers[0]);
  const store = storage();
  const repository = new LocalWorkspaceRepository(store);
  const baseline = await repository.load();
  await repository.commit({
    workspace: source,
    expectedRevision: baseline.revision,
    operationId: 'customer-relations',
  });
  const loaded = await new LocalWorkspaceRepository(store).load();
  assert.deepEqual(loaded.workspace.customers[0], before);
  assert.deepEqual(deserializeWorkspace(serializeWorkspace(source)).customers[0], before);
  assert.deepEqual(prepareCustomerDocuments(source, 'workspace-1').customers[0], {
    ...before,
    workspaceId: 'workspace-1',
  });
  source.companies.push({
    ...source.companies[0],
    id: 'another-company',
    businessTypeId: 'retail',
  });
  source.customers[0].companyId = 'another-company';
  assert.deepEqual(validateWorkspace(source).customers[0].productIds, before.productIds);
  assert.deepEqual(
    validateWorkspace(source).customers[0].productQuantities,
    before.productQuantities,
  );
  assert.deepEqual(validateWorkspace(source).customers[0].socialLinks, before.socialLinks);
});

test('customer product quantities keep unknown distinct from zero and validate each associated count', () => {
  const source = workspace();
  source.products = [
    { id: 'product-1', name: 'First product', imageUrl: '', companyIds: ['vetra'], sortOrder: 0 },
    { id: 'product-2', name: 'Second product', imageUrl: '', companyIds: ['vetra'], sortOrder: 1 },
  ];
  source.customers[0].productIds = ['product-1', 'product-2'];
  assert.equal(Object.hasOwn(validateWorkspace(source).customers[0], 'productQuantities'), false);
  source.customers[0].productQuantities = { 'product-1': 0 };
  assert.deepEqual(validateWorkspace(source).customers[0].productQuantities, { 'product-1': 0 });
  source.customers[0].productQuantities = { 'product-1': 1_000_000 };
  assert.equal(validateWorkspace(source).customers[0].productQuantities?.['product-1'], 1_000_000);
  for (const quantity of [-1, 1.5, 1_000_001, Number.NaN, Number.POSITIVE_INFINITY, '4']) {
    const invalid = structuredClone(source) as unknown as { customers: Record<string, unknown>[] };
    invalid.customers[0].productQuantities = { 'product-1': quantity };
    assert.throws(() => validateWorkspace(invalid), /product quantity/i);
  }
  for (const productId of ['missing', '__proto__']) {
    const invalid = structuredClone(source) as unknown as { customers: Record<string, unknown>[] };
    invalid.customers[0].productQuantities = JSON.parse(`{"${productId}":1}`);
    assert.throws(() => validateWorkspace(invalid), /product quantity/i);
  }
  const unassociated = structuredClone(source) as unknown as {
    customers: Record<string, unknown>[];
  };
  unassociated.customers[0].productIds = ['product-1'];
  unassociated.customers[0].productQuantities = { 'product-2': 1 };
  assert.throws(() => validateWorkspace(unassociated), /unassociated product/);
});

test('customer product associations reject malformed or missing identities and invalid contact types', () => {
  const source = workspace();
  source.products = [
    { id: 'product-1', name: 'Product', imageUrl: '', companyIds: ['vetra'], sortOrder: 0 },
  ];
  for (const productIds of [
    ['missing'],
    ['product-1', 'product-1'],
    ['__proto__'],
    [12],
    'product-1',
  ]) {
    const invalid = structuredClone(source) as unknown as { customers: Record<string, unknown>[] };
    invalid.customers[0].productIds = productIds;
    assert.throws(() => validateWorkspace(invalid), /product|Product/);
  }
  const invalidType = structuredClone(source) as unknown as {
    customers: { socialLinks: Record<string, unknown>[] }[];
  };
  invalidType.customers[0].socialLinks[0].type = 'javascript';
  assert.throws(() => validateWorkspace(invalidType), /Social link type/);
  source.customers[0].socialLinks[0] = {
    id: 'email',
    type: 'email',
    label: 'Email',
    url: 'mailto:person@example.com?bcc=other@example.com',
  };
  assert.throws(() => validateWorkspace(source), /Social link URL/);
});

test('customer product associations survive Trash restoration and unlink only permanently expired products', () => {
  const source = workspace();
  source.products = [
    { id: 'product-1', name: 'Active product', imageUrl: '', companyIds: ['vetra'], sortOrder: 0 },
    {
      id: 'product-2',
      name: 'Trashed product',
      imageUrl: '',
      companyIds: ['vetra'],
      sortOrder: 1,
      deletedAt: '2026-10-01T07:00:00.000Z',
    },
  ];
  source.customers[0].productIds = ['product-2', 'product-1'];
  source.customers[0].productQuantities = { 'product-2': 12, 'product-1': 0 };
  const retained = pruneTrash(source, new Date('2026-10-31T06:59:59.000Z'));
  assert.deepEqual(validateWorkspace(retained).customers[0].productIds, ['product-2', 'product-1']);
  assert.deepEqual(validateWorkspace(retained).customers[0].productQuantities, {
    'product-2': 12,
    'product-1': 0,
  });
  const restored = structuredClone(retained);
  delete restored.products[1].deletedAt;
  assert.deepEqual(
    pruneTrash(restored, new Date('2026-10-31T07:00:00.000Z')).customers[0].productIds,
    ['product-2', 'product-1'],
  );
  assert.deepEqual(
    pruneTrash(restored, new Date('2026-10-31T07:00:00.000Z')).customers[0].productQuantities,
    { 'product-2': 12, 'product-1': 0 },
  );
  const expired = pruneTrash(source, new Date('2026-10-31T07:00:00.000Z'));
  assert.deepEqual(validateWorkspace(expired).customers[0].productIds, ['product-1']);
  assert.deepEqual(validateWorkspace(expired).customers[0].productQuantities, { 'product-1': 0 });
  assert.deepEqual(source.customers[0].productIds, ['product-2', 'product-1']);
  assert.equal(expired.customers[0].notes, source.customers[0].notes);
});
