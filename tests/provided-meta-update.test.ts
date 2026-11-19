import assert from 'node:assert/strict';
import test from 'node:test';
import { createEmptyWorkspace } from '../src/lib/data';
import { addProvidedMissingPosts } from '../src/lib/provided-missing-posts';
import {
  applyProvidedMetaUpdate,
  ensureProvidedMetaUpdate,
  PROVIDED_META_UPDATE,
  providedMetaReadings,
} from '../src/lib/provided-meta-update';
import { addProvidedPostLinks } from '../src/lib/provided-post-links';
import { addProvidedProducts, assignCurrentPostsToEshan } from '../src/lib/provided-products';
import { applyProvidedViewerUpdates } from '../src/lib/provided-viewers-update';
import { renameVetraCompany } from '../src/lib/company-name-update';
import { LocalWorkspaceRepository } from '../src/lib/workspace-repository';

function earlierWorkspace() {
  return addProvidedMissingPosts(
    applyProvidedViewerUpdates(
      addProvidedPostLinks(
        assignCurrentPostsToEshan(addProvidedProducts(renameVetraCompany(createEmptyWorkspace()))),
      ),
    ),
  );
}

test('all 72 identified posts receive the latest Viewers, and 44 unknown dates are filled', () => {
  const earlier = earlierWorkspace();
  const original = structuredClone(earlier);
  const result = applyProvidedMetaUpdate(earlier);
  assert.equal(providedMetaReadings.length, 72);
  assert.equal(new Set(providedMetaReadings.map((item) => item.postId)).size, 72);
  assert.equal(result.viewersUpdated, 60);
  assert.equal(result.datesFilled, 44);
  assert.equal(result.conflicts, 0);
  assert.equal(result.unmatched, 0);
  assert.ok(result.workspace.appliedDataUpdates?.includes(PROVIDED_META_UPDATE));
  for (const reading of providedMetaReadings) {
    const post = result.workspace.posts.find((item) => item.facebookPostId === reading.postId);
    assert.ok(post, reading.postId);
    assert.equal(post.viewers, reading.viewers);
    assert.equal(post.publishedAt, reading.publishedAt);
    const before = earlier.posts.find((item) => item.id === post.id)!;
    assert.deepEqual({ ...post, viewers: before.viewers, publishedAt: before.publishedAt }, before);
  }
  assert.deepEqual(earlier, original);
  assert.equal(applyProvidedMetaUpdate(result.workspace).workspace, result.workspace);
});

test('manual values and dates survive, while a safe field on the same post can still update', () => {
  const earlier = earlierWorkspace();
  const first = earlier.posts[0];
  const laterDate = '2026-10-16T02:00:00.000Z';
  const customized = {
    ...earlier,
    posts: earlier.posts.map((post) =>
      post.id === first.id
        ? { ...post, viewers: 2000, publishedAt: laterDate, pinned: true }
        : post,
    ),
  };
  const result = applyProvidedMetaUpdate(customized);
  const preserved = result.workspace.posts.find((post) => post.id === first.id)!;
  assert.equal(preserved.viewers, 2000);
  assert.equal(preserved.publishedAt, laterDate);
  assert.equal(preserved.pinned, true);
  assert.equal(result.conflicts, 1);
  const second = earlier.posts.find((post) => !post.publishedAt)!;
  const partlyCustomized = {
    ...earlier,
    posts: earlier.posts.map((post) => (post.id === second.id ? { ...post, viewers: 2000 } : post)),
  };
  const partlyUpdated = applyProvidedMetaUpdate(partlyCustomized);
  const secondAfter = partlyUpdated.workspace.posts.find((post) => post.id === second.id)!;
  assert.equal(secondAfter.viewers, 2000);
  assert.ok(secondAfter.publishedAt);
});

test('deleted, ambiguous, or changed-identity posts are not updated', () => {
  const earlier = earlierWorkspace();
  const [deleted, changed, duplicate] = earlier.posts;
  const modified = {
    ...earlier,
    posts: [
      ...earlier.posts.map((post) =>
        post.id === deleted.id
          ? { ...post, deletedAt: '2026-10-17T00:00:00.000Z' }
          : post.id === changed.id
            ? { ...post, url: 'https://www.facebook.com/groups/other/posts/123/' }
            : post,
      ),
      { ...duplicate, id: 'duplicate-for-review' },
    ],
  };
  const result = applyProvidedMetaUpdate(modified);
  assert.equal(result.unmatched, 3);
  assert.equal(
    result.workspace.posts.find((post) => post.id === deleted.id)?.viewers,
    deleted.viewers,
  );
  assert.equal(
    result.workspace.posts.find((post) => post.id === changed.id)?.viewers,
    changed.viewers,
  );
  assert.equal(
    result.workspace.posts.find((post) => post.id === duplicate.id)?.viewers,
    duplicate.viewers,
  );
});

test('the one-time update persists and remains idempotent after a repository reload', async () => {
  const values = new Map<string, string>();
  const repository = new LocalWorkspaceRepository({
    getItem: (key) => values.get(key) ?? null,
    setItem: (key, value) => {
      values.set(key, value);
    },
  });
  const first = await repository.recover(earlierWorkspace());
  const saved = await ensureProvidedMetaUpdate(repository, first);
  const loaded = await repository.load();
  assert.equal(loaded.revision, saved.revision);
  assert.equal(loaded.workspace.posts[0].viewers, 967);
  assert.equal((await ensureProvidedMetaUpdate(repository, loaded)).revision, saved.revision);
});
