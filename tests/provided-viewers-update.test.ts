import assert from 'node:assert/strict';
import test from 'node:test';
import { createEmptyWorkspace } from '../src/lib/data';
import { addProvidedPostLinks } from '../src/lib/provided-post-links';
import {
  applyProvidedViewerUpdates,
  ensureProvidedViewerUpdates,
  providedViewerUpdates,
} from '../src/lib/provided-viewers-update';
import { LocalWorkspaceRepository } from '../src/lib/workspace-repository';
import {
  WORKSPACE_KEY,
  serializeWorkspace,
  deserializeWorkspace,
} from '../src/lib/workspace-storage';

test('updates all 70 matched totals and no other post data, preserving unknown dates', () => {
  const workspace = addProvidedPostLinks(createEmptyWorkspace());
  const original = structuredClone(workspace);
  const result = applyProvidedViewerUpdates(workspace);
  assert.equal(providedViewerUpdates.length, 70);
  assert.equal(new Set(providedViewerUpdates.map((row) => row.postId)).size, 70);
  for (const post of result.posts) {
    const reading = providedViewerUpdates.find((row) => row.postId === post.facebookPostId)!;
    assert.ok(Number.isSafeInteger(reading.viewers) && reading.viewers >= 0);
    assert.deepEqual(post, {
      ...workspace.posts.find((item) => item.id === post.id),
      viewers: reading.viewers,
    });
  }
  assert.equal(
    result.posts.find((post) => post.facebookPostId === '1441014217530766')?.viewers,
    907,
  );
  assert.equal(
    result.posts.find((post) => post.facebookPostId === '1656569912710418')?.viewers,
    595,
  );
  assert.equal(result.posts.filter((post) => !post.publishedAt).length, 44);
  assert.deepEqual(workspace, original);
  const restored = deserializeWorkspace(serializeWorkspace(result));
  restored.posts[0].viewers = 12345;
  assert.equal(applyProvidedViewerUpdates(restored), restored);
});

test('ambiguous, trashed, and conflicting group matches remain untouched', () => {
  const workspace = addProvidedPostLinks(createEmptyWorkspace());
  const [a, b, c] = workspace.posts;
  workspace.posts = [
    a,
    { ...a, id: 'duplicate' },
    { ...b, deletedAt: new Date().toISOString() },
    { ...c, url: c.url.replace(/groups\/[^/]+/, 'groups/999') },
  ];
  assert.deepEqual(applyProvidedViewerUpdates(workspace).posts, workspace.posts);
});

test('repository update survives conflicts and failed writes without losing saved data', async () => {
  const values = new Map([
    [
      WORKSPACE_KEY,
      JSON.stringify(serializeWorkspace(addProvidedPostLinks(createEmptyWorkspace()))),
    ],
  ]);
  let fail = false;
  const repository = new LocalWorkspaceRepository({
    getItem: (key) => values.get(key) ?? null,
    setItem: (key, value) => {
      if (fail) throw new Error('Quota');
      values.set(key, value);
    },
  });
  const initial = await repository.load();
  const original = values.get(WORKSPACE_KEY);
  fail = true;
  await assert.rejects(ensureProvidedViewerUpdates(repository, initial));
  assert.equal(values.get(WORKSPACE_KEY), original);
  fail = false;
  const edited = structuredClone(initial.workspace);
  edited.posts[0].product = 'User edit';
  await repository.commit({
    workspace: edited,
    expectedRevision: initial.revision,
    operationId: 'edit',
  });
  const updated = await ensureProvidedViewerUpdates(repository, initial);
  assert.equal(updated.workspace.posts[0].product, 'User edit');
  assert.equal(updated.workspace.posts[0].viewers, 907);
  assert.equal((await ensureProvidedViewerUpdates(repository, updated)).revision, updated.revision);
});
