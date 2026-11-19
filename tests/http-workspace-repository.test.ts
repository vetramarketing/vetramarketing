import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import test from 'node:test';
import { createEmptyWorkspace } from '../src/lib/data';
import { connectWorkspace, readBrowserMigrationSource } from '../src/lib/http-workspace-repository';
import {
  LocalWorkspaceRepository,
  WorkspaceRevisionConflict,
  WorkspaceUnreadableError,
} from '../src/lib/workspace-repository';
import { serializeWorkspace, WORKSPACE_KEY, V11_WORKSPACE_KEY } from '../src/lib/workspace-storage';

const workspace = createEmptyWorkspace();
const encoded = serializeWorkspace(workspace);
const scope = 'db-scope';
const snapshot = (revision: string) =>
  Response.json({ configured: true, workspace: encoded, databaseScope: scope, revision });

test('migration source lookup keeps original bytes, never seeds a fresh browser and rejects unreadable active records', () => {
  const values = new Map<string, string>();
  const storage = {
    getItem: (key: string) => values.get(key) ?? null,
    setItem() {
      throw Error('unexpected write');
    },
  };
  assert.equal(readBrowserMigrationSource(storage), null);
  values.set(V11_WORKSPACE_KEY, JSON.stringify(encoded));
  assert.equal(readBrowserMigrationSource(storage)?.key, V11_WORKSPACE_KEY);
  values.set(WORKSPACE_KEY, '{');
  assert.throws(() => readBrowserMigrationSource(storage), WorkspaceUnreadableError);
});

test('only an explicitly unconfigured service selects browser storage', async (t) => {
  const remote = t.mock.method(globalThis, 'fetch', async () =>
    Response.json({ configured: false }),
  );
  assert.ok((await connectWorkspace(() => {})).store instanceof LocalWorkspaceRepository);
  remote.mock.mockImplementation(async () =>
    Response.json({ code: 'WORKSPACE_SERVICE_UNAVAILABLE' }, { status: 503 }),
  );
  await assert.rejects(connectWorkspace(() => {}));
});

test('an empty database waits for explicit initialization and a competing migration cannot be overwritten', async (t) => {
  const calls: string[] = [];
  t.mock.method(globalThis, 'fetch', async (_url: string, init: RequestInit) => {
    calls.push(init.method ?? 'GET');
    if (!init.method)
      return Response.json(
        { configured: true, code: 'WORKSPACE_NOT_INITIALIZED', databaseScope: scope },
        { status: 404 },
      );
    const input = JSON.parse(String(init.body));
    assert.equal(input.expectedRevision, null);
    assert.deepEqual(input.workspace, JSON.parse(JSON.stringify(encoded)));
    return Response.json({ code: 'WORKSPACE_REVISION_CONFLICT' }, { status: 409 });
  });
  const connection = await connectWorkspace(() => {});
  assert.deepEqual(calls, ['GET']);
  assert.ok(connection.initialize);
  await assert.rejects(connection.initialize(workspace), WorkspaceRevisionConflict);
  assert.deepEqual(calls, ['GET', 'POST']);
});

test('a lost acknowledgement resends exactly the same operation and revision', async (t) => {
  const writes: string[] = [];
  t.mock.method(globalThis, 'fetch', async (_url: string, init: RequestInit) => {
    if (!init.method) return snapshot('first');
    writes.push(String(init.body));
    if (writes.length === 1) throw new TypeError('connection lost');
    return snapshot('second');
  });
  const { store } = await connectWorkspace(() => {});
  const initial = await store.load();
  const result = await store.commit({
    workspace: initial.workspace,
    expectedRevision: initial.revision,
    operationId: 'my-save',
  });
  assert.equal(result.revision, 'second');
  assert.equal(writes.length, 2);
  assert.equal(writes[0], writes[1]);
  assert.equal(JSON.parse(writes[0]).databaseScope, scope);
  assert.equal(JSON.parse(writes[0]).expectedRevision, 'first');
  assert.equal(JSON.parse(writes[0]).verifyLabelBytes, undefined);
  await store.commit({
    workspace: result.workspace,
    expectedRevision: result.revision,
    operationId: 'restore',
    verifyLabelBytes: true,
  });
  assert.equal(JSON.parse(writes[2]).verifyLabelBytes, true);
});

test('first import verifies the source fingerprint against a new read from MongoDB', async (t) => {
  const digest = createHash('sha256').update(JSON.stringify(encoded)).digest('hex');
  let phase = 0;
  t.mock.method(globalThis, 'fetch', async (_url: string, init: RequestInit) => {
    phase++;
    if (phase === 1)
      return Response.json(
        { configured: true, databaseScope: scope, code: 'WORKSPACE_NOT_INITIALIZED' },
        { status: 404 },
      );
    if (phase === 2) {
      assert.equal(JSON.parse(String(init.body)).operationId, 'browser-import-' + digest);
      return snapshot('imported');
    }
    assert.equal(init.method, undefined);
    return Response.json({
      configured: true,
      workspace: encoded,
      revision: 'imported',
      databaseScope: scope,
      migrationSourceDigest: digest,
    });
  });
  const { initialize } = await connectWorkspace(() => {});
  assert.ok(initialize);
  assert.equal((await initialize(workspace)).revision, 'imported');
  assert.equal(phase, 3);
});

test('an authorized scoped outage offers the last confirmed snapshot with no writes or migration', async (t) => {
  const values = new Map<string, string>([[WORKSPACE_KEY, 'unrelated browser source']]);
  const localStorage = {
    getItem: (key: string) => values.get(key) ?? null,
    setItem: (key: string, value: string) => {
      values.set(key, value);
    },
  };
  const fakeWindow = Object.assign(new EventTarget(), { localStorage });
  Object.defineProperty(globalThis, 'window', { configurable: true, value: fakeWindow });
  t.after(() => {
    Reflect.deleteProperty(globalThis, 'window');
  });
  const db = 'a'.repeat(32);
  const outage = (databaseScope: string, status = 503) =>
    Response.json({ databaseScope, code: 'WORKSPACE_SERVICE_UNAVAILABLE' }, { status });
  const transport = t.mock.method(globalThis, 'fetch', async () =>
    Response.json({
      configured: true,
      workspace: encoded,
      databaseScope: db,
      revision: 'confirmed',
    }),
  );
  const availability: Array<string | null> = [];
  const live = await connectWorkspace(
    () => {},
    (cached) => availability.push(cached?.revision ?? null),
  );
  await live.store.load();
  transport.mock.mockImplementation(async () => outage(db));
  await assert.rejects(live.store.load());
  assert.equal(availability.at(-1), 'confirmed');
  transport.mock.mockImplementation(async () =>
    Response.json({
      configured: true,
      workspace: encoded,
      databaseScope: db,
      revision: 'confirmed',
    }),
  );
  await live.store.load();
  assert.equal(availability.at(-1), null);
  const lastConfirmed = new Map(values);
  transport.mock.mockImplementation(async () => outage(db));
  const recovery = await connectWorkspace(() => {});
  assert.equal(recovery.mode, 'cached');
  assert.equal(recovery.initialize, null);
  assert.equal(recovery.cached.revision, 'confirmed');
  assert.ok(recovery.cached.syncedAt && Number.isFinite(Date.parse(recovery.cached.syncedAt)));
  const before = transport.mock.callCount();
  const cached = await recovery.store.load();
  await assert.rejects(
    recovery.store.commit({ ...cached, expectedRevision: cached.revision, operationId: 'offline' }),
    /Reconnect/,
  );
  await assert.rejects(recovery.store.recover(cached.workspace), /Reconnect/);
  assert.deepEqual(values, lastConfirmed);
  assert.equal(transport.mock.callCount(), before);

  transport.mock.mockImplementation(async () => outage('b'.repeat(32)));
  await assert.rejects(connectWorkspace(() => {}));
  transport.mock.mockImplementation(async () => outage(db, 403));
  await assert.rejects(connectWorkspace(() => {}));
  let denied = 0;
  fakeWindow.addEventListener('vetra-workspace-session-denied', () => denied++);
  transport.mock.mockImplementation(async () => outage(db, 401));
  await assert.rejects(
    connectWorkspace(() => {}),
    /Unlock/,
  );
  await assert.rejects(live.store.load(), /Unlock/);
  assert.equal(availability.at(-1), null);
  assert.equal(denied, 2);
  assert.deepEqual(values, lastConfirmed);
  transport.mock.mockImplementation(async () => {
    throw new TypeError('network offline');
  });
  await assert.rejects(connectWorkspace(() => {})); // No authorized scope for a fresh session.

  const key = [...values.keys()].find((key) => key !== WORKSPACE_KEY)!;
  const old = JSON.parse(values.get(key)!);
  delete old.syncedAt;
  values.set(key, JSON.stringify(old));
  transport.mock.mockImplementation(async () => outage(db));
  assert.equal((await connectWorkspace(() => {})).cached?.syncedAt, null);
  values.set(key, '{');
  await assert.rejects(connectWorkspace(() => {}));
});
