import assert from 'node:assert/strict';
import test from 'node:test';
import { createEmptyWorkspace } from '../src/lib/data';
import {
  addProvidedPostLinks,
  ensureProvidedPostLinks,
  PROVIDED_POST_LINKS_UPDATE,
  providedPostLinks,
} from '../src/lib/provided-post-links';
import {
  serializeWorkspace,
  deserializeWorkspace,
  WORKSPACE_KEY,
} from '../src/lib/workspace-storage';
import { LocalWorkspaceRepository } from '../src/lib/workspace-repository';
import { exportPostsCsv, previewPostsCsv } from '../src/lib/csv';

test('supplied links create 70 unique published posts with 44 unknown dates and no pending posts', () => {
  const workspace = addProvidedPostLinks(createEmptyWorkspace());
  assert.equal(providedPostLinks.length, 70);
  assert.equal(workspace.posts.length, 70);
  assert.equal(new Set(workspace.posts.map((post) => post.facebookPostId)).size, 70);
  assert.equal(workspace.posts.filter((post) => !post.publishedAt).length, 44);
  assert.equal(workspace.posts.filter((post) => post.viewers === null).length, 44);
  assert.ok(
    workspace.posts.every(
      (post) => !('status' in post) && post.product === 'น้ำผึ้งดอกกาแฟ ESHAN 320g',
    ),
  );
  assert.ok(
    workspace.posts.every(
      (post) => !['2909933032704543', '3704155876400919'].includes(post.facebookPostId),
    ),
  );
  assert.equal(
    workspace.posts.find((post) => post.facebookPostId === '1441014217530766')?.viewers,
    883,
  );
  const saved = serializeWorkspace(workspace);
  assert.deepEqual(serializeWorkspace(deserializeWorkspace(saved)), saved);
  const csv = previewPostsCsv(exportPostsCsv(workspace), createEmptyWorkspace(), 'vetra');
  assert.deepEqual(csv.errors, []);
  assert.equal(csv.posts.length, 70);
  assert.equal(csv.posts.filter((post) => !post.publishedAt).length, 44);
});

test('existing edits and Trash records survive deduplication by ID or URL', () => {
  const seed = addProvidedPostLinks(createEmptyWorkspace());
  const original = { ...seed, appliedDataUpdates: [], posts: seed.posts.slice(0, 26) };
  original.posts[0] = {
    ...original.posts[0],
    viewers: 9999,
    product: 'Edited',
    deletedAt: new Date().toISOString(),
  };
  original.posts[1] = {
    ...original.posts[1],
    facebookPostId: '',
    url: original.posts[1].url.replace('/posts/', '/permalink/'),
  };
  const result = addProvidedPostLinks(original);
  assert.equal(result.posts.length, 70);
  assert.deepEqual(result.posts.slice(0, 26), original.posts);
  const deletedLater = { ...result, posts: [] };
  assert.equal(addProvidedPostLinks(deletedLater), deletedLater);
});

test('import failure preserves data and stale snapshots retry without losing concurrent edits', async () => {
  const values = new Map<string, string>();
  let fail = false;
  const repository = new LocalWorkspaceRepository({
    getItem: (key) => values.get(key) ?? null,
    setItem: (key, value) => {
      if (fail) throw new Error('Quota');
      values.set(key, value);
    },
  });
  const initial = await repository.load();
  const raw = values.get(WORKSPACE_KEY);
  fail = true;
  await assert.rejects(ensureProvidedPostLinks(repository, initial));
  assert.equal(values.get(WORKSPACE_KEY), raw);
  fail = false;
  const changed = structuredClone(initial.workspace);
  changed.companies[0].name = 'Edited store';
  await repository.commit({
    workspace: changed,
    expectedRevision: initial.revision,
    operationId: 'edit',
  });
  const saved = await ensureProvidedPostLinks(repository, initial);
  assert.equal(saved.workspace.posts.length, 70);
  assert.equal(saved.workspace.companies[0].name, 'Edited store');
  assert.ok(saved.workspace.appliedDataUpdates?.includes(PROVIDED_POST_LINKS_UPDATE));
  assert.equal((await ensureProvidedPostLinks(repository, saved)).revision, saved.revision);
});
