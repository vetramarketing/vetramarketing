import assert from 'node:assert/strict';
import test from 'node:test';
import { createEmptyWorkspace, pruneTrash, validateWorkspace } from '../src/lib/data';
import {
  addProvidedMetaUnmatchedPosts,
  PROVIDED_META_UNMATCHED_POSTS_UPDATE,
  providedMetaUnmatchedPosts,
} from '../src/lib/provided-meta-unmatched-posts';
import { addProvidedProducts, ESHAN_PRODUCT } from '../src/lib/provided-products';
import { deserializeWorkspace, serializeWorkspace } from '../src/lib/workspace-storage';

test('supplied Meta rows become distinct provisional posts with exact source totals', () => {
  const result = validateWorkspace(
    addProvidedMetaUnmatchedPosts(addProvidedProducts(createEmptyWorkspace())),
  );
  assert.equal(providedMetaUnmatchedPosts.length, 35);
  assert.equal(result.posts.length, 35);
  assert.equal(result.posts.filter((post) => post.publicationStatus === 'pending').length, 13);
  assert.equal(result.posts.filter((post) => post.publicationStatus === 'published').length, 22);
  assert.equal(result.posts.find((post) => post.metaSourceRow === 35)?.viewers, 28);
  assert.equal(result.posts.find((post) => post.metaSourceRow === 69)?.viewers, 9);
  assert.equal(result.posts.find((post) => post.metaSourceRow === 75)?.viewers, 6);
  assert.ok(
    result.posts
      .filter((post) => (post.metaSourceRow ?? 0) >= 86)
      .every((post) => post.viewers === 1),
  );
  assert.ok(result.posts.every((post) => post.url === '' && post.facebookPostId === ''));
  assert.ok(result.posts.every((post) => post.publishedAt === ''));
  assert.ok(result.posts.every((post) => post.productId === ESHAN_PRODUCT.id));
  assert.equal(
    result.posts.find((post) => post.metaSourceRow === 88)?.metaPublishedLabel,
    '15 ต.ค. เวลา 18:24',
  );
  assert.equal(
    result.posts.find((post) => post.metaSourceRow === 86)?.metaPublishedLabel,
    undefined,
  );

  const sameGroup = result.posts.filter((post) => post.metaGroupKey === '1899598603545611');
  assert.deepEqual(
    sameGroup.map((post) => post.metaSourceRow),
    [86, 117],
  );
  assert.notEqual(sameGroup[0].id, sameGroup[1].id);
  assert.equal(result.groups.filter((group) => group.facebookId === '1899598603545611').length, 1);
});

test('provisional Meta fields survive storage and later group removal', () => {
  const workspace = addProvidedMetaUnmatchedPosts(createEmptyWorkspace());
  const roundTrip = deserializeWorkspace(serializeWorkspace(workspace));
  assert.equal(
    roundTrip.posts.find((post) => post.metaSourceRow === 90)?.metaGroupKey,
    'promoinsider',
  );
  assert.equal(
    roundTrip.posts.find((post) => post.metaSourceRow === 86)?.publicationStatus,
    'pending',
  );

  const original = roundTrip.posts.find((post) => post.metaSourceRow === 86)!;
  const group = roundTrip.groups.find((item) => item.id === original.groupId)!;
  group.deletedAt = '2026-09-01T00:00:00Z';
  const pruned = validateWorkspace(pruneTrash(roundTrip, new Date('2026-10-18T00:00:00Z')));
  const retained = pruned.posts.find((post) => post.metaSourceRow === 86)!;
  assert.equal(retained.groupId, '');
  assert.equal(retained.metaGroupKey, '1899598603545611');
  assert.equal(retained.metaGroupName, 'ชาวลำลูกกา');
  assert.equal(retained.publicationStatus, 'pending');
});

test('one-time marker preserves later edits and deletion without re-adding rows', () => {
  const seeded = addProvidedMetaUnmatchedPosts(createEmptyWorkspace());
  assert.ok(seeded.appliedDataUpdates?.includes(PROVIDED_META_UNMATCHED_POSTS_UPDATE));
  const changed = {
    ...seeded,
    posts: seeded.posts
      .filter((post) => post.metaSourceRow !== 35)
      .map((post) => (post.metaSourceRow === 88 ? { ...post, viewers: 42 } : post)),
  };
  assert.equal(addProvidedMetaUnmatchedPosts(changed), changed);
  assert.equal(changed.posts.find((post) => post.metaSourceRow === 88)?.viewers, 42);
  assert.equal(
    changed.posts.some((post) => post.metaSourceRow === 35),
    false,
  );
});

test('Pending retains a known date while unscoped Meta labels are rejected', () => {
  const source = addProvidedMetaUnmatchedPosts(createEmptyWorkspace());
  const pendingDate = structuredClone(source);
  pendingDate.posts.find((post) => post.metaSourceRow === 35)!.publishedAt = '2026-10-15T00:00:00Z';
  const validated = validateWorkspace(pendingDate);
  assert.equal(
    validated.posts.find((post) => post.metaSourceRow === 35)?.publishedAt,
    '2026-10-15T00:00:00Z',
  );
  assert.equal(
    validated.posts.find((post) => post.metaSourceRow === 35)?.publicationStatus,
    'pending',
  );
  const unscopedLabel = structuredClone(source);
  delete unscopedLabel.posts[0].metaSourceRow;
  assert.throws(() => validateWorkspace(unscopedLabel), /source row/);
  const unsafeGroupKey = structuredClone(source);
  unsafeGroupKey.posts[0].metaGroupKey = '../other-path';
  assert.throws(() => validateWorkspace(unsafeGroupKey), /group key/);
});
