import assert from 'node:assert/strict';
import test from 'node:test';
import { existsSync } from 'node:fs';
import {
  createEmptyWorkspace,
  createSampleWorkspace,
  safeCatalogImageUrl,
  validateWorkspace,
} from '../src/lib/data';
import {
  addProvidedProducts,
  assignCurrentPostsToEshan,
  ensureProvidedProducts,
  ESHAN_PRODUCT,
} from '../src/lib/provided-products';
import { LocalWorkspaceRepository } from '../src/lib/workspace-repository';
import {
  deserializeWorkspace,
  serializeWorkspace,
  WORKSPACE_KEY,
} from '../src/lib/workspace-storage';

function storage() {
  const values = new Map<string, string>();
  return {
    getItem: (key: string) => values.get(key) ?? null,
    setItem: (key: string, value: string) => {
      values.set(key, value);
    },
  };
}

test('supplied ESHAN product has the exact name and an existing bundled image', () => {
  const data = createEmptyWorkspace();
  const updated = validateWorkspace(addProvidedProducts(data));
  assert.equal(updated.products[0].name, 'น้ำผึ้งดอกกาแฟ ESHAN 320g');
  assert.ok(existsSync(`public${decodeURIComponent(updated.products[0].imageUrl)}`));
  assert.equal(updated.products[0].imageAsset, undefined);
  assert.deepEqual(data.products, []);
  assert.deepEqual(updated.companies, data.companies);
  assert.deepEqual(updated.posts, data.posts);
});

test('bulk assignment preserves every other post field and survives saved backup reloads', async () => {
  const data = createSampleWorkspace();
  data.sample = false;
  data.posts = data.posts.filter((post) => post.status === 'published');
  assert.ok(data.posts.length > 1);
  data.posts[0].deletedAt = new Date().toISOString();
  const local = storage();
  // Upgrade a workspace where the earlier product addition already ran.
  local.setItem(WORKSPACE_KEY, JSON.stringify(serializeWorkspace(addProvidedProducts(data))));
  const repository = new LocalWorkspaceRepository(local);
  const initial = await repository.load();
  const saved = await ensureProvidedProducts(repository, initial);
  assert.deepEqual(
    saved.workspace.posts,
    initial.workspace.posts.map((post) => ({
      ...post,
      product: ESHAN_PRODUCT.name,
      productId: ESHAN_PRODUCT.id,
    })),
  );
  assert.deepEqual(saved.workspace.groups, initial.workspace.groups);
  assert.deepEqual(saved.workspace.companies, initial.workspace.companies);
  const restored = deserializeWorkspace(serializeWorkspace(saved.workspace));
  assert.deepEqual(restored.posts, saved.workspace.posts);
  restored.posts[0].product = 'Later edit';
  restored.posts.push({ ...restored.posts[1], id: 'later-post', product: 'Another product' });
  assert.equal(assignCurrentPostsToEshan(restored), restored);
  assert.equal(
    (await ensureProvidedProducts(repository, await repository.load())).revision,
    saved.revision,
  );
});

test('assignment retries against current posts after a concurrent save', async () => {
  const data = createSampleWorkspace();
  data.sample = false;
  data.posts = data.posts.filter((post) => post.status === 'published');
  const local = storage();
  local.setItem(WORKSPACE_KEY, JSON.stringify(serializeWorkspace(addProvidedProducts(data))));
  const repository = new LocalWorkspaceRepository(local);
  const stale = await repository.load();
  const edited = structuredClone(stale.workspace);
  edited.posts[0].viewers = 9876;
  await repository.commit({
    workspace: edited,
    expectedRevision: stale.revision,
    operationId: 'viewer-edit',
  });
  const saved = await ensureProvidedProducts(repository, stale);
  assert.equal(saved.workspace.posts[0].viewers, 9876);
  assert.ok(saved.workspace.posts.every((post) => post.product === ESHAN_PRODUCT.name));
});

test('addition persists once and backups respect later renaming and removal', async () => {
  const repository = new LocalWorkspaceRepository(storage());
  const initial = await repository.load();
  const saved = await ensureProvidedProducts(repository, initial);
  assert.equal(saved.workspace.products.length, 1);
  assert.equal(
    (await ensureProvidedProducts(repository, await repository.load())).revision,
    saved.revision,
  );
  const renamed = structuredClone(saved.workspace);
  renamed.products[0].name = 'Edited name';
  assert.equal(
    addProvidedProducts(deserializeWorkspace(serializeWorkspace(renamed))).products[0].name,
    'Edited name',
  );
  const removed = { ...saved.workspace, products: [] };
  assert.equal(
    addProvidedProducts(deserializeWorkspace(serializeWorkspace(removed))).products.length,
    0,
  );
});

test('matching records keep custom images and Trash state, and blank images are filled without duplicates', () => {
  for (const existing of [
    { ...ESHAN_PRODUCT, id: 'existing', imageUrl: 'https://example.com/custom.png' },
    { ...ESHAN_PRODUCT, deletedAt: '2026-10-17T01:00:00Z' },
    { ...ESHAN_PRODUCT, name: 'User renamed this' },
  ]) {
    const data = { ...createEmptyWorkspace(), products: [existing] };
    assert.deepEqual(addProvidedProducts(data).products, [existing]);
  }
  const data = {
    ...createEmptyWorkspace(),
    products: [{ ...ESHAN_PRODUCT, id: 'existing', imageUrl: '' }],
  };
  const updated = addProvidedProducts(data);
  assert.equal(updated.products.length, 1);
  assert.equal(updated.products[0].id, 'existing');
  assert.equal(updated.products[0].imageUrl, ESHAN_PRODUCT.imageUrl);
});

test('supplied addition retries a stale revision without overwriting unrelated changes', async () => {
  const repository = new LocalWorkspaceRepository(storage());
  const initial = await repository.load();
  await repository.commit({
    workspace: {
      ...initial.workspace,
      products: [{ id: 'other', name: 'Another product', imageUrl: '', sortOrder: 10 }],
    },
    expectedRevision: initial.revision,
    operationId: 'other-edit',
  });
  const saved = await ensureProvidedProducts(repository, initial);
  assert.deepEqual(
    saved.workspace.products.map((product) => product.id),
    ['other', ESHAN_PRODUCT.id],
  );
  assert.equal(saved.workspace.products[1].sortOrder, 11);
});

test('failed writes preserve the original workspace and permit a later retry', async () => {
  const local = storage();
  let fail = false;
  const repository = new LocalWorkspaceRepository({
    ...local,
    setItem: (key, value) => {
      if (fail) throw new Error('Quota');
      local.setItem(key, value);
    },
  });
  const initial = await repository.load();
  const raw = local.getItem(WORKSPACE_KEY);
  fail = true;
  await assert.rejects(ensureProvidedProducts(repository, initial));
  assert.equal(local.getItem(WORKSPACE_KEY), raw);
  fail = false;
  assert.equal((await ensureProvidedProducts(repository, initial)).workspace.products.length, 1);
});

test('image validation allows approved bundled assets without admitting arbitrary local paths', () => {
  assert.equal(safeCatalogImageUrl(ESHAN_PRODUCT.imageUrl), true);
  for (const path of [
    '/api/private',
    '//evil.example/image.png',
    '/product/../secret',
    'file:///C:/image.png',
    'javascript:alert(1)',
  ])
    assert.equal(safeCatalogImageUrl(path), false);
  assert.equal(safeCatalogImageUrl('https://example.com/image.png'), true);
});
