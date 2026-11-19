import assert from 'node:assert/strict';
import test from 'node:test';
import { MAX_SORT_ORDER, nextSortOrder, reorderCompanies, sortCatalog } from '../src/lib/catalog';
import {
  createEmptyWorkspace,
  createSampleWorkspace,
  pruneTrash,
  validateWorkspace,
} from '../src/lib/data';
import { entityEditIsCurrent } from '../src/lib/entity-edit';
import { CATALOG_INDEXES, prepareCatalogDocuments } from '../src/lib/mongodb-catalog';
import {
  LocalWorkspaceRepository,
  WorkspaceRevisionConflict,
} from '../src/lib/workspace-repository';
import {
  deserializeWorkspace,
  OLDER_WORKSPACE_KEY,
  serializeWorkspace,
  WORKSPACE_KEY,
} from '../src/lib/workspace-storage';

const catalog = () => {
  const workspace = createEmptyWorkspace();
  workspace.companies[0] = {
    ...workspace.companies[0],
    ownerName: 'เจ้าของร้าน',
    logoImageUrl: 'https://example.com/logo.webp',
    sortOrder: 7,
  };
  workspace.products = [
    { id: 'honey', name: 'น้ำผึ้ง', imageUrl: 'https://example.com/honey.webp', sortOrder: 2 },
  ];
  return workspace;
};
const memoryStorage = () => {
  const records = new Map<string, string>();
  return {
    getItem: (key: string) => records.get(key) ?? null,
    setItem: (key: string, value: string) => {
      records.set(key, value);
    },
  };
};

test('v4 migrates company defaults without losing branding, posts, totals, or recovery bytes', async () => {
  const sample = createSampleWorkspace(new Date('2026-10-17T10:00:00Z'));
  const { products, ...current } = serializeWorkspace({
    ...sample,
    sample: false,
    posts: sample.posts.filter((post) => post.status === 'published'),
  });
  const source = {
    ...current,
    version: 4,
    companies: current.companies.map(({ logoImageUrl, ownerName, sortOrder, ...store }) => store),
  };
  const raw = JSON.stringify(source);
  const storage = memoryStorage();
  storage.setItem(OLDER_WORKSPACE_KEY, raw);
  const repository = new LocalWorkspaceRepository(storage);
  const snapshot = await repository.load();
  assert.deepEqual(snapshot.workspace.products, []);
  assert.deepEqual(serializeWorkspace(snapshot.workspace).posts, source.posts);
  assert.deepEqual(
    snapshot.workspace.companies.map(({ logoImageUrl, ownerName, sortOrder, ...store }) => store),
    source.companies,
  );
  assert.deepEqual(
    snapshot.workspace.companies.map((store) => [
      store.logoImageUrl,
      store.ownerName,
      store.sortOrder,
    ]),
    [
      ['', '', 0],
      ['', '', 1],
      ['', '', 2],
    ],
  );
  assert.equal(storage.getItem(OLDER_WORKSPACE_KEY), raw);
  assert.equal(JSON.parse(storage.getItem(WORKSPACE_KEY)!).version, 12);
  assert.equal((await repository.load()).revision, snapshot.revision);
});

test('catalog edits survive repository reload and JSON restore including Thai names and images', async () => {
  const storage = memoryStorage();
  const repository = new LocalWorkspaceRepository(storage);
  const baseline = await repository.load();
  const candidate = catalog();
  const saved = await repository.commit({
    workspace: candidate,
    expectedRevision: baseline.revision,
    operationId: 'catalog-save',
  });
  assert.deepEqual((await new LocalWorkspaceRepository(storage).load()).workspace, candidate);
  assert.deepEqual(
    deserializeWorkspace(JSON.parse(JSON.stringify(serializeWorkspace(candidate)))),
    candidate,
  );
  const renamed = structuredClone(candidate);
  renamed.products[0].name = 'น้ำผึ้งใหม่';
  await assert.rejects(
    repository.commit({
      workspace: renamed,
      expectedRevision: baseline.revision,
      operationId: 'stale-product',
    }),
    WorkspaceRevisionConflict,
  );
  assert.equal((await repository.load()).revision, saved.revision);
  assert.equal(entityEditIsCurrent(candidate.products[0], renamed.products[0]), false);
  assert.equal(
    entityEditIsCurrent(candidate.companies[0], {
      ...candidate.companies[0],
      ownerName: 'New owner',
    }),
    false,
  );
});

test('products accept missing images, duplicate names, and safe whole sort numbers', () => {
  const workspace = catalog();
  workspace.products.push({ id: 'honey-2', name: 'น้ำผึ้ง', imageUrl: '', sortOrder: 0 });
  workspace.companies[0].logoImageUrl = '';
  workspace.companies[0].ownerName = '';
  assert.deepEqual(validateWorkspace(workspace), workspace);
  for (const value of [-1, 1.1, NaN, Infinity, MAX_SORT_ORDER + 1, '1', null, undefined]) {
    const invalid = structuredClone(workspace);
    Object.assign(invalid.products[0], { sortOrder: value });
    assert.throws(() => validateWorkspace(invalid), /Sort order/);
    Object.assign(invalid.products[0], { sortOrder: 0 });
    Object.assign(invalid.companies[0], { sortOrder: value });
    assert.throws(() => validateWorkspace(invalid), /Sort order/);
  }
});

test('product company associations survive repository, backup, and Mongo document preparation', async () => {
  const workspace = catalog();
  workspace.companies.push({ ...workspace.companies[0], id: 'second-store', name: 'Second store' });
  workspace.products[0].companyIds = ['vetra', 'second-store'];
  const storage = memoryStorage();
  const repository = new LocalWorkspaceRepository(storage);
  const baseline = await repository.load();
  await repository.commit({
    workspace,
    expectedRevision: baseline.revision,
    operationId: 'associate-product-companies',
  });
  assert.deepEqual((await new LocalWorkspaceRepository(storage).load()).workspace, workspace);
  assert.deepEqual(deserializeWorkspace(serializeWorkspace(workspace)), workspace);
  const documents = prepareCatalogDocuments(workspace, 'workspace-1');
  assert.deepEqual(documents.products[0].companyIds, ['vetra', 'second-store']);
  assert.deepEqual(CATALOG_INDEXES.products[2].key, {
    workspaceId: 1,
    companyIds: 1,
    deletedAt: 1,
  });
});

test('product companies are optional for legacy data but explicit associations must be valid', () => {
  const legacy = catalog();
  assert.deepEqual(validateWorkspace(legacy), legacy);
  assert.deepEqual(deserializeWorkspace(serializeWorkspace(legacy)), legacy);
  for (const [companyIds, message] of [
    [[], /Product companies must include/],
    [['missing'], /missing company/],
    [['vetra', 'vetra'], /duplicate IDs/],
    ['vetra', /Product companies must be a list/],
    [[null], /Product company ID/],
  ] as const) {
    const invalid = catalog();
    Object.assign(invalid.products[0], { companyIds });
    assert.throws(() => validateWorkspace(invalid), message);
  }
});

test('catalog rejects unsafe image links, invalid names, duplicate IDs, and malformed current backups', () => {
  for (const url of [
    'javascript:alert(1)',
    'data:image/png;base64,test',
    'http://example.com/image.jpg',
    'https://user:password@example.com/image.jpg',
    'https://example.com/a b.jpg',
  ]) {
    const invalid = catalog();
    invalid.products[0].imageUrl = url;
    assert.throws(() => validateWorkspace(invalid), /HTTPS/);
    invalid.products[0].imageUrl = '';
    invalid.companies[0].logoImageUrl = url;
    assert.throws(() => validateWorkspace(invalid), /HTTPS/);
  }
  const invalid = catalog();
  invalid.products.push({ ...invalid.products[0] });
  assert.throws(() => validateWorkspace(invalid), /duplicate IDs/);
  invalid.products.pop();
  invalid.products[0].name = ' ';
  assert.throws(() => validateWorkspace(invalid), /Product name/);
  const stored = serializeWorkspace(catalog());
  assert.throws(() => deserializeWorkspace({ ...stored, products: undefined }), /Products/);
  assert.throws(
    () =>
      deserializeWorkspace({ ...stored, companies: [{ ...stored.companies[0], ownerName: null }] }),
    /Owner name/,
  );
});

test('sort order is deterministic, does not mutate input, and new order stays bounded', () => {
  const items = [
    { id: 'z', sortOrder: 0 },
    { id: 'a', sortOrder: 0 },
    { id: 'first', sortOrder: 1 },
  ];
  const before = structuredClone(items);
  assert.deepEqual(
    sortCatalog(items).map((item) => item.id),
    ['a', 'z', 'first'],
  );
  assert.deepEqual(items, before);
  assert.equal(nextSortOrder([]), 0);
  assert.equal(nextSortOrder(items), 2);
  assert.equal(nextSortOrder([{ sortOrder: MAX_SORT_ORDER }]), MAX_SORT_ORDER);
});

test('company drag ordering preserves metadata, persists, and ignores invalid moves', async () => {
  const workspace = catalog();
  const first = { ...workspace.companies[0], id: 'first', sortOrder: 8 };
  const second = { ...workspace.companies[0], id: 'second', sortOrder: 2, name: 'Second' };
  const third = { ...workspace.companies[0], id: 'third', sortOrder: 5, name: 'Third' };
  workspace.companies = [first, second, third];
  const before = structuredClone(workspace.companies);

  const reordered = reorderCompanies(workspace.companies, 'first', 'second');
  assert.deepEqual(
    reordered.map((store) => [store.id, store.sortOrder]),
    [
      ['first', 0],
      ['second', 1],
      ['third', 2],
    ],
  );
  assert.deepEqual(reordered[0], { ...first, sortOrder: 0 });
  assert.deepEqual(workspace.companies, before);
  assert.deepEqual(reorderCompanies(workspace.companies, 'first', 'first'), sortCatalog(before));
  assert.deepEqual(reorderCompanies(workspace.companies, 'missing', 'second'), sortCatalog(before));
  assert.deepEqual(reorderCompanies(workspace.companies, 'first', 'missing'), sortCatalog(before));

  const storage = memoryStorage();
  const repository = new LocalWorkspaceRepository(storage);
  const baseline = await repository.load();
  await repository.commit({
    workspace: { ...workspace, companies: reordered },
    expectedRevision: baseline.revision,
    operationId: 'reorder-companies',
  });
  assert.deepEqual(
    sortCatalog((await new LocalWorkspaceRepository(storage).load()).workspace.companies).map(
      (store) => store.id,
    ),
    ['first', 'second', 'third'],
  );
});

test('product Trash retains images for restore and expiry never changes existing posts', () => {
  const workspace = createSampleWorkspace(new Date('2026-10-17T10:00:00Z'));
  const beforePosts = structuredClone(workspace.posts);
  workspace.products = [{ ...catalog().products[0], deletedAt: '2026-10-01T00:00:00Z' }];
  const retained = pruneTrash(workspace, new Date('2026-10-30T23:59:59Z'));
  assert.deepEqual(retained.products, workspace.products);
  const restored = validateWorkspace({
    ...retained,
    products: retained.products.map(({ deletedAt, ...product }) => product),
  });
  assert.equal(restored.products[0].imageUrl, workspace.products[0].imageUrl);
  const expired = pruneTrash(workspace, new Date('2026-10-31T00:00:00Z'));
  assert.deepEqual(expired.products, []);
  assert.deepEqual(expired.posts, beforePosts);
  assert.equal(workspace.products.length, 1);
});

test('MongoDB preparation validates and scopes catalog documents without mutating source data', () => {
  const workspace = catalog();
  const before = structuredClone(workspace);
  const documents = prepareCatalogDocuments(workspace, 'workspace-1');
  assert.deepEqual(
    documents.products,
    workspace.products.map((product) => ({ ...product, workspaceId: 'workspace-1' })),
  );
  assert.deepEqual(
    documents.companies,
    workspace.companies.map((store) => ({ ...store, workspaceId: 'workspace-1' })),
  );
  assert.deepEqual(workspace, before);
  documents.companies[0].name = 'Changed document';
  assert.deepEqual(workspace, before);
  assert.throws(() => prepareCatalogDocuments(workspace, ''), /workspace ID/);
  workspace.products[0].imageUrl = 'javascript:alert(1)';
  assert.throws(() => prepareCatalogDocuments(workspace, 'workspace-1'), /HTTPS/);
});
