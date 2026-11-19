import assert from 'node:assert/strict';
import test from 'node:test';
import {
  createConsoleScript,
  SCRIPT_LIMITS,
  SCRIPT_PLATFORMS,
  scriptMatchesQuery,
  validateConsoleScripts,
  type ConsoleScript,
} from '../src/lib/console-scripts';
import { createEmptyWorkspace, pruneTrash, validateWorkspace } from '../src/lib/data';
import {
  deserializeWorkspace,
  serializeWorkspace,
  WORKSPACE_KEY,
} from '../src/lib/workspace-storage';
import {
  LocalWorkspaceRepository,
  WorkspaceRevisionConflict,
  type WorkspaceStorage,
} from '../src/lib/workspace-repository';

const now = new Date('2026-11-06T03:45:00.000Z');
const companies = new Set(['vetra']);
function script(overrides: Partial<ConsoleScript> = {}): ConsoleScript {
  return {
    ...createConsoleScript('vetra', 'script-1', now),
    title: 'Read post links',
    description: 'Collect currently visible links from the page.',
    code: "  const links = document.querySelectorAll('a');\r\n\tconsole.table(links);\r\n",
    ...overrides,
  };
}

test('new script starts as an unsaved Facebook snippet with shared or company scope', () => {
  const draft = createConsoleScript('', 'new-script', now);
  assert.equal(draft.companyId, '');
  assert.equal(draft.platform, 'facebook');
  assert.equal(draft.createdAt, now.toISOString());
  assert.equal(draft.updatedAt, now.toISOString());
  assert.equal(draft.pinned, false);
  assert.equal(draft.title, '');
  assert.equal(draft.code, '');
  assert.throws(() => validateConsoleScripts([draft], new Set()), /title/);
  for (const platform of SCRIPT_PLATFORMS)
    assert.equal(
      validateConsoleScripts([script({ platform, companyId: '' })], new Set())[0].platform,
      platform,
    );
});

test('missing legacy collection defaults empty but malformed collections are rejected', () => {
  assert.deepEqual(validateConsoleScripts(undefined, companies), []);
  for (const value of [null, {}, '[]', 1])
    assert.throws(() => validateConsoleScripts(value, companies), /list/);
  const workspace = createEmptyWorkspace();
  const { scripts: _oldMissing, ...current } = serializeWorkspace(workspace);
  const legacy = { ...current, version: 8 };
  const before = JSON.stringify(legacy);
  assert.deepEqual(deserializeWorkspace(legacy).scripts, []);
  assert.equal(JSON.stringify(legacy), before);
  assert.deepEqual(validateWorkspace({ ...workspace, scripts: undefined }).scripts, []);
});

test('backups preserve exact JavaScript text, Thai, whitespace and HTML-looking strings', () => {
  const code =
    '\t/* สคริปต์ */\r\nconst html = "</script><script>alert(1)</script>";\r\n' +
    'const literal = "\\n\\t${notInterpolated}";\n\fconsole.log(`ข้อความ 😀`);\r\n  ';
  const source = createEmptyWorkspace();
  source.scripts = [
    script({ code, pinned: true }),
    script({ id: 'shared', companyId: '', platform: 'tiktok' }),
  ];
  const before = structuredClone(source);
  const saved = serializeWorkspace(source);
  assert.equal(saved.version, 12);
  assert.equal(WORKSPACE_KEY, 'vetra-marketing.workspace.v12');
  const restored = deserializeWorkspace(JSON.parse(JSON.stringify(saved)));
  assert.equal(restored.scripts?.[0].code, code);
  assert.deepEqual(restored.scripts, source.scripts);
  assert.deepEqual(serializeWorkspace(restored), saved);
  assert.deepEqual(source, before);
});

test('validation rejects invalid identities, platforms, scope, flags and required text', () => {
  const invalid: Record<string, unknown>[] = [
    { id: '__proto__' },
    { id: '' },
    { id: 'with space' },
    { companyId: 'missing-company' },
    { companyId: undefined },
    { platform: 'linkedin' },
    { platform: null },
    { pinned: 'true' },
    { pinned: undefined },
    { title: ' \t\n' },
    { title: 'x'.repeat(SCRIPT_LIMITS.title + 1) },
    { description: null },
    { description: 'x'.repeat(SCRIPT_LIMITS.description + 1) },
    { code: '' },
    { code: '\r\n  \t' },
    { code: 1 },
    { code: 'x'.repeat(SCRIPT_LIMITS.code + 1) },
    { createdAt: '2026-02-30T00:00:00Z' },
    { updatedAt: '2026-11-06' },
    { deletedAt: 'bad' },
  ];
  for (const fields of invalid)
    assert.throws(
      () => validateConsoleScripts([{ ...script(), ...fields }], companies),
      Error,
      JSON.stringify(fields).slice(0, 200),
    );
  assert.throws(() => validateConsoleScripts([script(), script()], companies), /duplicate/);
  assert.throws(() => validateConsoleScripts([null], companies), /object/);
});

test('search matches all tokens across title, description, platform and code', () => {
  const value = script({ title: 'ค้นหา Facebook links', description: 'Read only example' });
  assert.equal(scriptMatchesQuery(value, 'FACEBOOK queryselectorall'), true);
  assert.equal(scriptMatchesQuery(value, 'ค้นหา only'), true);
  assert.equal(scriptMatchesQuery(value, '   '), true);
  assert.equal(scriptMatchesQuery(value, 'Facebook absent'), false);
});

test('Trash retains restorable scripts and prunes only at the 30-day boundary', () => {
  const source = createEmptyWorkspace();
  source.scripts = [
    script({ id: 'active' }),
    script({ id: 'recent', deletedAt: '2026-10-07T03:45:00.001Z' }),
    script({ id: 'expired', deletedAt: '2026-10-07T03:45:00.000Z' }),
  ];
  const before = structuredClone(source);
  const pruned = pruneTrash(source, now);
  assert.deepEqual(
    pruned.scripts?.map((item) => item.id),
    ['active', 'recent'],
  );
  assert.deepEqual(source, before);
  assert.equal(pruned.scripts?.[1].code, source.scripts[1].code);
  const restored = deserializeWorkspace(
    serializeWorkspace({
      ...pruned,
      scripts: pruned.scripts?.map(({ deletedAt: _deleted, ...item }) => item),
    }),
  );
  assert.ok(restored.scripts?.every((item) => !item.deletedAt));
});

test('repository commits and reloads snippets while rejecting stale edits', async () => {
  const values = new Map<string, string>();
  const storage: WorkspaceStorage = {
    getItem: (key) => values.get(key) ?? null,
    setItem: (key, value) => {
      values.set(key, value);
    },
  };
  const first = new LocalWorkspaceRepository(storage, null);
  const second = new LocalWorkspaceRepository(storage, null);
  const initial = await first.load();
  const stale = await second.load();
  const saved = await first.commit({
    workspace: { ...initial.workspace, scripts: [script()] },
    expectedRevision: initial.revision,
    operationId: 'save-script',
  });
  assert.deepEqual((await second.load()).workspace.scripts, saved.workspace.scripts);
  await assert.rejects(
    second.commit({
      workspace: { ...stale.workspace, scripts: [script({ code: 'overwritten' })] },
      expectedRevision: stale.revision,
      operationId: 'stale-script',
    }),
    WorkspaceRevisionConflict,
  );
  assert.equal((await first.load()).workspace.scripts?.[0].code, script().code);
});
