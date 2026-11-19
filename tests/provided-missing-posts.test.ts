import assert from 'node:assert/strict';
import test from 'node:test';
import { createEmptyWorkspace } from '../src/lib/data';
import {
  addProvidedMissingPosts,
  ensureProvidedMissingPosts,
  providedMissingPosts,
} from '../src/lib/provided-missing-posts';
import { knownFacebookGroupName } from '../src/lib/facebook-group-directory';
import {
  deserializeWorkspace,
  serializeWorkspace,
  WORKSPACE_KEY,
} from '../src/lib/workspace-storage';
import { LocalWorkspaceRepository } from '../src/lib/workspace-repository';

test('adds both supplied posts with the matched names, publication times and latest totals', () => {
  const original = createEmptyWorkspace();
  const updated = addProvidedMissingPosts(original);
  assert.equal(original.posts.length, 0);
  assert.equal(updated.posts.length, 2);
  for (const supplied of providedMissingPosts) {
    const post = updated.posts.find((item) => item.facebookPostId === supplied.postId)!;
    const group = updated.groups.find((item) => item.id === post.groupId)!;
    assert.equal(group.name, knownFacebookGroupName(supplied.groupId));
    assert.equal(group.facebookId, supplied.groupId);
    assert.equal(post.url, supplied.url);
    assert.equal(post.publishedAt, new Date(supplied.publishedAtIct).toISOString());
    assert.equal(post.viewers, supplied.viewers);
    assert.equal(post.product, 'น้ำผึ้งดอกกาแฟ ESHAN 320g');
  }
  assert.deepEqual(
    deserializeWorkspace(serializeWorkspace(updated)).posts,
    updated.posts.map((post) => ({ ...post, commentCount: null })),
  );
  assert.equal(addProvidedMissingPosts(updated), updated);
});

test('existing post and group edits survive; a failed write can be retried', async () => {
  const existing = addProvidedMissingPosts(createEmptyWorkspace());
  existing.appliedDataUpdates = [];
  existing.posts = [{ ...existing.posts[0], viewers: 99, product: 'Edited product' }];
  existing.groups[0].name = 'Edited group';
  const values = new Map([[WORKSPACE_KEY, JSON.stringify(serializeWorkspace(existing))]]);
  let fail = true;
  const repository = new LocalWorkspaceRepository({
    getItem: (key) => values.get(key) ?? null,
    setItem: (key, value) => {
      if (fail) throw new Error('Quota');
      values.set(key, value);
    },
  });
  const initial = await repository.load();
  const raw = values.get(WORKSPACE_KEY);
  await assert.rejects(ensureProvidedMissingPosts(repository, initial));
  assert.equal(values.get(WORKSPACE_KEY), raw);
  fail = false;
  const saved = await ensureProvidedMissingPosts(repository, initial);
  assert.equal(saved.workspace.posts.length, 2);
  assert.equal(saved.workspace.posts[0].viewers, 99);
  assert.equal(saved.workspace.posts[0].product, 'Edited product');
  assert.equal(saved.workspace.groups[0].name, 'Edited group');
  assert.equal((await ensureProvidedMissingPosts(repository, saved)).revision, saved.revision);
});
