import assert from 'node:assert/strict';
import test from 'node:test';
import { createEmptyWorkspace } from '../src/lib/data';
import {
  createBrowserWorkspaceRepository,
  RemoteWorkspaceRepository,
} from '../src/lib/remote-workspace-repository';
import {
  LocalWorkspaceRepository,
  WorkspaceStorageError,
  type WorkspaceStorage,
} from '../src/lib/workspace-repository';
import { WORKSPACE_KEY } from '../src/lib/workspace-storage';

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

function withPost() {
  const workspace = createEmptyWorkspace();
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
    pinned: false,
    color: '#263b4b',
  });
  return workspace;
}

test('the app factory keeps local-only storage until an API source is explicitly provided', () => {
  assert.ok(createBrowserWorkspaceRepository() instanceof LocalWorkspaceRepository);
});

test('remote pin saves update a scoped browser cache without overwriting the existing local workspace', async () => {
  const browser = new MemoryStorage();
  const existingLocal = new LocalWorkspaceRepository(browser);
  await existingLocal.recover(withPost());
  const original = browser.getItem(WORKSPACE_KEY);
  const remote = new LocalWorkspaceRepository(new MemoryStorage());
  await remote.recover(withPost());
  const repository = new RemoteWorkspaceRepository({
    remote,
    cacheScope: { userId: 'owner', workspaceId: 'vetra' },
    storage: browser,
  });

  const first = await repository.load();
  const pinned = structuredClone(first.workspace);
  pinned.posts[0].pinned = true;
  const saved = await repository.commit({
    workspace: pinned,
    expectedRevision: first.revision,
    operationId: 'pin-post',
  });

  assert.equal(saved.workspace.posts[0].pinned, true);
  assert.equal((await remote.load()).workspace.posts[0].pinned, true);
  assert.equal(repository.readCachedSnapshot()?.workspace.posts[0].pinned, true);
  assert.equal(browser.getItem(WORKSPACE_KEY), original);
  assert.equal((await existingLocal.load()).workspace.posts[0].pinned, false);
});

test('a failed remote save leaves both remote data and the last browser cache unchanged', async () => {
  const browser = new MemoryStorage();
  const remote = new LocalWorkspaceRepository(new MemoryStorage());
  await remote.recover(withPost());
  const repository = new RemoteWorkspaceRepository({
    remote: {
      load: () => remote.load(),
      commit: async () => {
        throw new Error('Network unavailable');
      },
      recover: (workspace) => remote.recover(workspace),
      subscribe: (listener) => remote.subscribe(listener),
    },
    cacheScope: { userId: 'owner', workspaceId: 'vetra' },
    storage: browser,
  });
  const first = await repository.load();
  const cached = browser.getItem(repository.cacheKey);
  const pinned = structuredClone(first.workspace);
  pinned.posts[0].pinned = true;

  await assert.rejects(
    repository.commit({
      workspace: pinned,
      expectedRevision: first.revision,
      operationId: 'pin-post',
    }),
    /Network unavailable/,
  );
  assert.equal(browser.getItem(repository.cacheKey), cached);
  assert.equal((await remote.load()).workspace.posts[0].pinned, false);
});

test('cache quota failure does not make a successful remote save appear to fail', async () => {
  const browser = new MemoryStorage();
  const remote = new LocalWorkspaceRepository(new MemoryStorage());
  await remote.recover(withPost());
  const warnings: WorkspaceStorageError[] = [];
  const repository = new RemoteWorkspaceRepository({
    remote,
    cacheScope: { userId: 'owner', workspaceId: 'vetra' },
    storage: browser,
    onCacheError: (error) => warnings.push(error),
  });
  const first = await repository.load();
  browser.failWrites = true;
  const pinned = structuredClone(first.workspace);
  pinned.posts[0].pinned = true;

  const saved = await repository.commit({
    workspace: pinned,
    expectedRevision: first.revision,
    operationId: 'pin-post',
  });
  assert.equal(saved.workspace.posts[0].pinned, true);
  assert.equal((await remote.load()).workspace.posts[0].pinned, true);
  assert.equal(repository.readCachedSnapshot()?.workspace.posts[0].pinned, false);
  assert.equal(warnings.length, 1);
  assert.ok(warnings[0] instanceof WorkspaceStorageError);
});

test('cached snapshots stay separate by signed-in user and workspace', async () => {
  const browser = new MemoryStorage();
  const remote = new LocalWorkspaceRepository(new MemoryStorage());
  await remote.recover(withPost());
  const first = new RemoteWorkspaceRepository({
    remote,
    cacheScope: { userId: 'owner', workspaceId: 'vetra' },
    storage: browser,
  });
  const second = new RemoteWorkspaceRepository({
    remote,
    cacheScope: { userId: 'another-user', workspaceId: 'vetra' },
    storage: browser,
  });
  await first.load();
  assert.notEqual(first.cacheKey, second.cacheKey);
  assert.equal(second.readCachedSnapshot(), null);
  const dottedUser = new RemoteWorkspaceRepository({
    remote,
    cacheScope: { userId: 'owner.vetra', workspaceId: 'other' },
    storage: browser,
  });
  const dottedWorkspace = new RemoteWorkspaceRepository({
    remote,
    cacheScope: { userId: 'owner', workspaceId: 'vetra.other' },
    storage: browser,
  });
  assert.notEqual(dottedUser.cacheKey, dottedWorkspace.cacheKey);
});

test('an unavailable API does not silently load the cached workspace as editable data', async () => {
  const browser = new MemoryStorage();
  const remote = new LocalWorkspaceRepository(new MemoryStorage());
  await remote.recover(withPost());
  let online = true;
  const repository = new RemoteWorkspaceRepository({
    remote: {
      load: () => (online ? remote.load() : Promise.reject(new Error('API unavailable'))),
      commit: (input) => remote.commit(input),
      recover: (workspace) => remote.recover(workspace),
      subscribe: (listener) => remote.subscribe(listener),
    },
    cacheScope: { userId: 'owner', workspaceId: 'vetra' },
    storage: browser,
  });
  await repository.load();
  online = false;
  await assert.rejects(repository.load(), /API unavailable/);
  assert.equal(repository.readCachedSnapshot()?.workspace.posts[0].pinned, false);
});
