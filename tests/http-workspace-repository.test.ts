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
