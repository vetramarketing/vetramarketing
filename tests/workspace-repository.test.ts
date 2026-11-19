import assert from 'node:assert/strict';
import test from 'node:test';
import { createEmptyWorkspace, createSampleWorkspace } from '../src/lib/data';
import type { Workspace } from '../src/lib/types';
import { createConsoleScript } from '../src/lib/console-scripts';
import { newCustomer } from '../src/lib/customer-data';
import { prepareWorkspaceLabelRestore, exportWorkspaceWithLabels } from '../src/lib/order-labels';
import {
  LocalWorkspaceRepository,
  WorkspaceRemovedError,
  WorkspaceRevisionConflict,
  WorkspaceUnreadableError,
  type WorkspaceEventSource,
  type WorkspaceStorage,
} from '../src/lib/workspace-repository';
import {
  LEGACY_WORKSPACE_KEY,
  PREVIOUS_WORKSPACE_KEY,
  OLDER_WORKSPACE_KEY,
  V3_WORKSPACE_KEY,
  V2_WORKSPACE_KEY,
  V8_WORKSPACE_KEY,
  V10_WORKSPACE_KEY,
  V11_WORKSPACE_KEY,
  serializeWorkspace,
  WORKSPACE_KEY,
} from '../src/lib/workspace-storage';

class MemoryStorage implements WorkspaceStorage {
  readonly values = new Map<string, string>();
  failWrites = false;

  getItem(key: string): string | null {
    return this.values.get(key) ?? null;
  }

  setItem(key: string, value: string): void {
    if (this.failWrites) throw new Error('Storage quota exceeded');
    this.values.set(key, value);
  }
}

class FakeStorageEvents implements WorkspaceEventSource {
  readonly listeners = new Set<(event: StorageEvent) => void>();

  addEventListener(_type: 'storage', listener: (event: StorageEvent) => void): void {
    this.listeners.add(listener);
  }

  removeEventListener(_type: 'storage', listener: (event: StorageEvent) => void): void {
    this.listeners.delete(listener);
  }

  emit(key: string, newValue: string | null): void {
    for (const listener of this.listeners) listener({ key, newValue } as StorageEvent);
  }
}

function sampleLegacy(): Workspace {
  const workspace = createSampleWorkspace(new Date('2026-10-16T10:00:00Z'));
  workspace.sample = false;
  workspace.posts = workspace.posts.map((post) => ({
    ...post,
    metrics: post.viewers === null ? [] : [{ date: '2026-10-16', viewers: post.viewers }],
  }));
  return workspace;
}

test('first load creates the current workspace once, and revisions are stable across repository instances', async () => {
  const storage = new MemoryStorage();
  const first = await new LocalWorkspaceRepository(storage).load();
  const raw = storage.getItem(WORKSPACE_KEY);
  assert.ok(raw);
  assert.deepEqual(JSON.parse(raw), serializeWorkspace(createEmptyWorkspace()));
  assert.deepEqual(first.workspace, createEmptyWorkspace());
  assert.match(first.revision, /^[0-9a-f]{64}$/);

  const second = await new LocalWorkspaceRepository(storage).load();
  assert.equal(second.revision, first.revision);
  assert.equal(storage.getItem(WORKSPACE_KEY), raw);
});

test('v3, v2 and v1 workspaces migrate to v12 without deleting recovery copies', async () => {
  const legacy = sampleLegacy();
  const v2 = {
    ...legacy,
    version: 2,
    posts: legacy.posts.map(({ title, content, status, scheduledAt, ...post }) => post),
  };
  const v3 = { ...v2, version: 3, posts: v2.posts.filter((post) => post.publishedAt) };
  for (const [key, source] of [
    [V3_WORKSPACE_KEY, v3],
    [V2_WORKSPACE_KEY, v2],
    [LEGACY_WORKSPACE_KEY, legacy],
  ] as const) {
    const storage = new MemoryStorage();
    const backup = JSON.stringify(source);
    storage.setItem(key, backup);
    const snapshot = await new LocalWorkspaceRepository(storage).load();
    assert.equal(
      snapshot.workspace.posts.length,
      legacy.posts.filter((post) => post.status === 'published').length,
    );
    assert.ok(snapshot.workspace.posts.every((post) => !('status' in post)));
    assert.equal(JSON.parse(storage.getItem(WORKSPACE_KEY)!).version, 12);
    assert.equal(storage.getItem(key), backup);
  }
});

test('v10 customer quantities become one regular customer order, once, through browser migration and backup restore', async () => {
  const source = createEmptyWorkspace();
  source.products = ['tea', 'honey'].map((id, sortOrder) => ({
    id,
    sortOrder,
    name: id,
    imageUrl: '',
    companyIds: ['vetra'],
  }));
  source.customers = [
    {
      ...newCustomer('vetra', '2026-01-01T00:00:00Z'),
      id: 'buyer',
      name: 'Buyer',
      productIds: ['tea', 'honey'],
      productQuantities: { tea: 4, honey: 7 },
    },
    { ...newCustomer('vetra', '2026-01-01T00:00:00Z'), id: 'unknown', name: 'Unknown units' },
  ];
  const old = { ...serializeWorkspace(source), version: 10 };
  const oldBytes = JSON.stringify(old, null, 2);
  const storage = new MemoryStorage();
  storage.setItem(V10_WORKSPACE_KEY, oldBytes);
  const repository = new LocalWorkspaceRepository(storage, null);
  const initial = await repository.load();
  const opening = initial.workspace.orders!;
  assert.equal(opening.length, 2);
  assert.deepEqual(opening[1].items, []);
  assert.equal(opening[1].customerId, 'unknown');
  assert.equal(opening[0].customerId, 'buyer');
  assert.deepEqual(
    Object.fromEntries(opening[0].items.map((item) => [item.productId, item.quantity])),
    { tea: 4, honey: 7 },
  );
  assert.equal(storage.getItem(V10_WORKSPACE_KEY), oldBytes);
  assert.equal((await repository.load()).revision, initial.revision);

  const portable = JSON.parse(await exportWorkspaceWithLabels(initial.workspace));
  const persisted = JSON.parse(storage.getItem(WORKSPACE_KEY)!);
  assert.deepEqual(portable.workspace.orders, persisted.orders);
  assert.equal('carrier' in persisted.orders[0], false);
  assert.equal('unitPriceSatang' in persisted.orders[0].items[0], false);
  for (const backup of [old, { ...portable, workspace: old }, portable]) {
    const preview = await prepareWorkspaceLabelRestore(backup);
    assert.deepEqual(preview.workspace.orders, opening);
    await preview.commitLabels();
    assert.deepEqual((await repository.recover(preview.workspace)).workspace.orders, opening);
  }
  const newBuyer = { ...newCustomer('vetra'), id: 'new-buyer', name: 'New buyer' };
  await repository.recover({
    ...initial.workspace,
    customers: [...initial.workspace.customers, newBuyer],
    orders: [],
  });
  assert.deepEqual((await repository.load()).workspace.orders, []);
  assert.equal(storage.getItem(V10_WORKSPACE_KEY), oldBytes);
});

test('v11 converts existing balances once, keeps exact identity and Trash state, and dates only same-company matches', async () => {
  const source = createEmptyWorkspace();
  source.companies.push({ ...source.companies[0], id: 'other' });
  const stamp = '2026-01-01T00:00:00Z';
  source.customers = ['buyer', 'fresh'].map((id) => ({
    ...newCustomer('vetra', stamp),
    id,
    name: id,
    lastContactOn: '2026-04-16',
  }));
  const balance = {
    id: 'b1',
    number: 'OPEN-01',
    companyId: 'vetra',
    customerId: 'buyer',
    customerName: 'Buyer',
    status: 'paid',
    quantitySource: 'opening',
    orderedOn: '',
    createdAt: stamp,
    updatedAt: stamp,
    items: [{ id: 'line-1', name: 'Tea', quantity: 7 }],
  };
  const removed = {
    ...balance,
    id: 'b2',
    number: 'OPEN-02',
    items: [],
    deletedAt: new Date().toISOString(),
  };
  const unlinked = { ...balance, id: 'b3', number: 'OPEN-03', companyId: 'other' };
  const regular = {
    ...balance,
    id: 'order',
    number: 'VT-20260101-001',
    quantitySource: 'quick',
    orderedOn: '2026-01-01',
  };
  const old = {
    ...serializeWorkspace(source),
    version: 11,
    orderSequences: { '20260416': 5 },
    orders: [regular, balance, removed, unlinked],
  };
  const storage = new MemoryStorage();
  const oldBytes = JSON.stringify(old);
  storage.setItem(V11_WORKSPACE_KEY, oldBytes);
  const repository = new LocalWorkspaceRepository(storage, null);
  const first = await repository.load();
  const entries = first.workspace.orders!;
  assert.deepEqual(
    entries.map((o) => o.id),
    ['order', 'b1', 'b2', 'b3'],
  );
  assert.deepEqual(
    entries.map((o) => o.number),
    ['VT-20260101-001', 'VT-20260416-006', 'VT-20260416-007', 'VT-UNDATED-00001'],
  );
  assert.equal(entries[0].quantitySource, 'quick');
  assert.equal(entries[1].quantitySource, 'imported');
  assert.equal(entries[1].orderedOn, '2026-04-16');
  assert.equal(entries[1].status, 'paid');
  assert.equal(entries[1].items[0].quantity, 7);
  assert.equal(entries[2].deletedAt, removed.deletedAt);
  assert.equal(entries[3].orderedOn, '');
  assert.equal(first.workspace.orderSequences?.['20260416'], 7);
  assert.equal(storage.getItem(V11_WORKSPACE_KEY), oldBytes);
  assert.equal((await repository.load()).revision, first.revision);
  const restored = await prepareWorkspaceLabelRestore(old);
  assert.deepEqual(restored.workspace.orders, entries);
  // Later customer edits cannot rewrite the converted order date or recreate deleted orders.
  const changed = {
    ...first.workspace,
    customers: first.workspace.customers.map((c) => ({ ...c, lastContactOn: '2026-06-01' })),
  };
  const saved = await repository.commit({
    workspace: changed,
    expectedRevision: first.revision,
    operationId: 'date-edit',
  });
  assert.deepEqual(saved.workspace.orders, entries);
});

test('v8 migration preserves recovery bytes and any scripts saved by the intermediate version', async () => {
  const base = serializeWorkspace(createEmptyWorkspace());
  const snippet = {
    ...createConsoleScript('', 'migration-script', new Date('2026-11-06T03:00:00Z')),
    title: 'Preserved snippet',
    code: '\tconsole.log("ภาษาไทย");\r\n',
  };
  const { scripts: _scripts, ...withoutScripts } = base;
  for (const legacy of [
    { ...withoutScripts, version: 8 },
    { ...base, version: 8, scripts: [snippet] },
  ]) {
    const storage = new MemoryStorage();
    const originalBytes = JSON.stringify(legacy, null, 2);
    storage.setItem(V8_WORKSPACE_KEY, originalBytes);
    const repository = new LocalWorkspaceRepository(storage, null);
    const snapshot = await repository.load();
    assert.equal(storage.getItem(V8_WORKSPACE_KEY), originalBytes);
    assert.equal(JSON.parse(storage.getItem(WORKSPACE_KEY)!).version, 12);
    assert.deepEqual(snapshot.workspace.scripts, 'scripts' in legacy ? legacy.scripts : []);
    assert.deepEqual(repository.listOlderBackups(), [{ key: V8_WORKSPACE_KEY, version: 'v8' }]);
    assert.equal(repository.readOlderBackup(V8_WORKSPACE_KEY), originalBytes);
  }
});

test('an older tab normalizing v8 cannot erase current scripts or trigger an active subscription', async () => {
  const storage = new MemoryStorage();
  const events = new FakeStorageEvents();
  const { scripts: _scripts, ...legacyBase } = serializeWorkspace(createEmptyWorkspace());
  const legacy = { ...legacyBase, version: 8 };
  storage.setItem(V8_WORKSPACE_KEY, JSON.stringify(legacy));
  const repository = new LocalWorkspaceRepository(storage, events);
  const initial = await repository.load();
  const snippet = {
    ...createConsoleScript('', 'protected-script', new Date('2026-11-06T03:00:00Z')),
    title: 'Must survive old tabs',
    code: 'console.log("retained");\r\n',
  };
  const saved = await repository.commit({
    workspace: { ...initial.workspace, scripts: [snippet] },
    expectedRevision: initial.revision,
    operationId: 'save-protected-script',
  });
  const activeBytes = storage.getItem(WORKSPACE_KEY);
  let notifications = 0;
  const unsubscribe = repository.subscribe(() => {
    notifications += 1;
  });
  // Older clients serialize only their supported fields and keep using the v8 key.
  legacy.companies[0].name = 'Edited in an older tab';
  const oldTabBytes = JSON.stringify(legacy);
  storage.setItem(V8_WORKSPACE_KEY, oldTabBytes);
  events.emit(V8_WORKSPACE_KEY, oldTabBytes);
  const reloaded = await repository.load();
  assert.equal(notifications, 0);
  assert.equal(storage.getItem(WORKSPACE_KEY), activeBytes);
  assert.equal(storage.getItem(V8_WORKSPACE_KEY), oldTabBytes);
  assert.equal(reloaded.revision, saved.revision);
  assert.deepEqual(reloaded.workspace.scripts, [snippet]);
  unsubscribe();
});

test('corrupt active data is preserved even when an older valid backup exists', async () => {
  const storage = new MemoryStorage();
  const repository = new LocalWorkspaceRepository(storage);
  storage.setItem(WORKSPACE_KEY, '{broken-json');
  storage.setItem(
    PREVIOUS_WORKSPACE_KEY,
    JSON.stringify(serializeWorkspace(createEmptyWorkspace())),
  );
  await assert.rejects(repository.load(), WorkspaceUnreadableError);
  assert.equal(repository.readPreservedRaw(), '{broken-json');

  const restored = await repository.recover(createEmptyWorkspace());
  assert.equal(JSON.parse(storage.getItem(WORKSPACE_KEY)!).version, 12);
  assert.equal(
    storage.getItem(PREVIOUS_WORKSPACE_KEY),
    JSON.stringify(serializeWorkspace(createEmptyWorkspace())),
  );
  assert.equal((await repository.load()).revision, restored.revision);
});

test('an unreadable v5 copy is preserved and does not silently fall back to v1', async () => {
  const storage = new MemoryStorage();
  storage.setItem(PREVIOUS_WORKSPACE_KEY, '{broken');
  storage.setItem(LEGACY_WORKSPACE_KEY, JSON.stringify(sampleLegacy()));
  await assert.rejects(new LocalWorkspaceRepository(storage).load(), WorkspaceUnreadableError);
  assert.equal(storage.getItem(WORKSPACE_KEY), null);
  assert.equal(storage.getItem(PREVIOUS_WORKSPACE_KEY), '{broken');
});

test('commit accepts the loaded revision and rejects stale writes from another instance', async () => {
  const storage = new MemoryStorage();
  const firstRepository = new LocalWorkspaceRepository(storage);
  const secondRepository = new LocalWorkspaceRepository(storage);
  const first = await firstRepository.load();
  const second = await secondRepository.load();
  const candidate = structuredClone(first.workspace);
  candidate.companies[0].name = 'Updated store';
  const saved = await firstRepository.commit({
    workspace: candidate,
    expectedRevision: first.revision,
    operationId: 'save-one',
  });
  assert.equal(saved.workspace.companies[0].name, 'Updated store');
  assert.notEqual(saved.revision, first.revision);

  const stale = structuredClone(second.workspace);
  stale.companies[0].name = 'Stale store';
  await assert.rejects(
    secondRepository.commit({
      workspace: stale,
      expectedRevision: second.revision,
      operationId: 'save-two',
    }),
    WorkspaceRevisionConflict,
  );
  assert.equal((await secondRepository.load()).workspace.companies[0].name, 'Updated store');
});

test('pin toggles persist after reload and a stale tab cannot undo the new state', async () => {
  const storage = new MemoryStorage();
  const firstRepository = new LocalWorkspaceRepository(storage);
  const secondRepository = new LocalWorkspaceRepository(storage);
  const empty = await firstRepository.load();
  const workspace = structuredClone(empty.workspace);
  workspace.posts.push({
    id: 'tracked-post',
    companyId: 'vetra',
    groupId: '',
    product: 'Honey',
    platform: 'facebook',
    publishedAt: '',
    facebookPostId: '',
    url: 'https://example.com/post',
    viewers: 10,
    color: '#263b4b',
  });
  const created = await firstRepository.commit({
    workspace,
    expectedRevision: empty.revision,
    operationId: 'create-post',
  });
  const stale = await secondRepository.load();
  assert.equal(stale.workspace.posts[0].pinned, false);

  const pinned = structuredClone(created.workspace);
  pinned.posts[0].pinned = true;
  await firstRepository.commit({
    workspace: pinned,
    expectedRevision: created.revision,
    operationId: 'pin-post',
  });
  assert.equal(
    (await new LocalWorkspaceRepository(storage).load()).workspace.posts[0].pinned,
    true,
  );
  await assert.rejects(
    secondRepository.commit({
      workspace: stale.workspace,
      expectedRevision: stale.revision,
      operationId: 'stale-unpin',
    }),
    WorkspaceRevisionConflict,
  );
  assert.equal((await secondRepository.load()).workspace.posts[0].pinned, true);
});

test('racing saves through one repository cannot both pass the same revision', async () => {
  const storage = new MemoryStorage();
  const repository = new LocalWorkspaceRepository(storage);
  const baseline = await repository.load();
  const first = structuredClone(baseline.workspace);
  first.companies[0].name = 'First';
  const second = structuredClone(baseline.workspace);
  second.companies[0].name = 'Second';

  const results = await Promise.allSettled([
    repository.commit({
      workspace: first,
      expectedRevision: baseline.revision,
      operationId: 'race-one',
    }),
    repository.commit({
      workspace: second,
      expectedRevision: baseline.revision,
      operationId: 'race-two',
    }),
  ]);
  assert.equal(results.filter((result) => result.status === 'fulfilled').length, 1);
  const rejected = results.find((result) => result.status === 'rejected');
  assert.ok(rejected?.status === 'rejected');
  assert.ok(rejected.reason instanceof WorkspaceRevisionConflict);
  assert.equal((await repository.load()).workspace.companies[0].name, 'First');
});

test('same-instance retries are idempotent, but an operation ID cannot represent different data', async () => {
  const storage = new MemoryStorage();
  const repository = new LocalWorkspaceRepository(storage);
  const baseline = await repository.load();
  const candidate = structuredClone(baseline.workspace);
  candidate.companies[0].name = 'VETRA One';
  const request = {
    workspace: candidate,
    expectedRevision: baseline.revision,
    operationId: 'once',
  };
  const saved = await repository.commit(request);
  assert.deepEqual(await repository.commit(request), saved);
  const changed = structuredClone(candidate);
  changed.companies[0].name = 'VETRA Two';
  await assert.rejects(
    repository.commit({ ...request, workspace: changed }),
    WorkspaceRevisionConflict,
  );
  assert.equal((await repository.load()).workspace.companies[0].name, 'VETRA One');
});

test('invalid candidates and failed writes leave the previous workspace intact', async () => {
  const storage = new MemoryStorage();
  const repository = new LocalWorkspaceRepository(storage);
  const baseline = await repository.load();
  const raw = storage.getItem(WORKSPACE_KEY);
  const invalid = structuredClone(baseline.workspace);
  invalid.companies = [];
  await assert.rejects(
    repository.commit({
      workspace: invalid,
      expectedRevision: baseline.revision,
      operationId: 'invalid',
    }),
  );
  assert.equal(storage.getItem(WORKSPACE_KEY), raw);

  storage.failWrites = true;
  const changed = structuredClone(baseline.workspace);
  changed.companies[0].name = 'New name';
  await assert.rejects(
    repository.commit({
      workspace: changed,
      expectedRevision: baseline.revision,
      operationId: 'failed-write',
    }),
  );
  assert.equal(storage.getItem(WORKSPACE_KEY), raw);
});

test('backup helpers and language preference use only their existing storage keys', async () => {
  const storage = new MemoryStorage();
  const repository = new LocalWorkspaceRepository(storage);
  await repository.load();
  assert.equal(repository.readLocale(), 'th');
  repository.writeLocale('en');
  assert.equal(repository.readLocale(), 'en');
  assert.equal(storage.getItem('vetra-marketing.locale'), 'en');
  storage.setItem(PREVIOUS_WORKSPACE_KEY, 'previous copy');
  storage.setItem(OLDER_WORKSPACE_KEY, 'older copy');
  storage.setItem(V3_WORKSPACE_KEY, 'v3 copy');
  storage.setItem(V2_WORKSPACE_KEY, 'v2 copy');
  storage.setItem(LEGACY_WORKSPACE_KEY, 'legacy copy');
  assert.deepEqual(repository.listOlderBackups(), [
    { key: PREVIOUS_WORKSPACE_KEY, version: 'v5' },
    { key: OLDER_WORKSPACE_KEY, version: 'v4' },
    { key: V3_WORKSPACE_KEY, version: 'v3' },
    { key: V2_WORKSPACE_KEY, version: 'v2' },
    { key: LEGACY_WORKSPACE_KEY, version: 'v1' },
  ]);
  assert.equal(repository.readOlderBackup(PREVIOUS_WORKSPACE_KEY), 'previous copy');
  assert.equal(repository.readOlderBackup(OLDER_WORKSPACE_KEY), 'older copy');
  assert.equal(repository.readOlderBackup(V3_WORKSPACE_KEY), 'v3 copy');
  assert.equal(repository.readOlderBackup(V2_WORKSPACE_KEY), 'v2 copy');
  assert.equal(repository.readOlderBackup(LEGACY_WORKSPACE_KEY), 'legacy copy');
  assert.equal(repository.readOlderBackup('other-site-secret'), null);
});

test('storage subscriptions report validated external changes and can unsubscribe', async () => {
  const storage = new MemoryStorage();
  const events = new FakeStorageEvents();
  const repository = new LocalWorkspaceRepository(storage, events);
  const baseline = await repository.load();
  const changed = structuredClone(baseline.workspace);
  changed.companies[0].name = 'Another tab';
  const nextRaw = JSON.stringify(serializeWorkspace(changed));
  const received = new Promise<unknown>((resolve) => {
    const unsubscribe = repository.subscribe((message) => {
      unsubscribe();
      resolve(message);
    });
  });
  storage.setItem(WORKSPACE_KEY, nextRaw);
  events.emit(WORKSPACE_KEY, nextRaw);
  const message = await received;
  assert.ok(message && typeof message === 'object' && 'workspace' in message);
  assert.equal((message as { workspace: Workspace }).workspace.companies[0].name, 'Another tab');
  assert.equal(events.listeners.size, 0);
});

test('a removed active key blocks subscribers instead of loading an empty workspace', async () => {
  const storage = new MemoryStorage();
  const events = new FakeStorageEvents();
  const repository = new LocalWorkspaceRepository(storage, events);
  await repository.load();
  const messages: Array<unknown> = [];
  const unsubscribe = repository.subscribe((message) => messages.push(message));
  storage.values.delete(WORKSPACE_KEY);
  events.emit(WORKSPACE_KEY, null);
  assert.equal(messages.length, 1);
  assert.ok(messages[0] instanceof WorkspaceRemovedError);
  assert.equal(storage.getItem(WORKSPACE_KEY), null);
  unsubscribe();
});
