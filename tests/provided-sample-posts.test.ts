import assert from 'node:assert/strict';
import test from 'node:test';
import { createEmptyWorkspace, validateWorkspace } from '../src/lib/data';
import { exportPostsCsv, previewPostsCsv } from '../src/lib/csv';
import { providedSamplePosts, providedSamplePostsCsv } from '../src/lib/provided-sample-posts';
import { deserializeWorkspace, serializeWorkspace } from '../src/lib/workspace-storage';

test('the supplied sample adds 26 distinct published Facebook posts with accurate ICT times and one Viewers total', () => {
  const preview = previewPostsCsv(providedSamplePostsCsv(), createEmptyWorkspace(), 'vetra');
  assert.deepEqual(preview.errors, []);
  assert.equal(preview.skipped, 0);
  assert.equal(preview.posts.length, 26);
  assert.equal(preview.groups.length, 26);
  assert.equal(new Set(preview.posts.map((post) => post.facebookPostId)).size, 26);
  const sourceById = new Map(providedSamplePosts.map((post) => [post.postId, post]));
  for (const post of preview.posts) {
    const source = sourceById.get(post.facebookPostId);
    assert.ok(source);
    assert.equal(
      post.publishedAt,
      new Date(source.publishedAtIct.replace(' ', 'T') + ':00+07:00').toISOString(),
    );
    assert.equal(
      post.url,
      `https://www.facebook.com/groups/${source.group}/posts/${source.postId}/`,
    );
    assert.equal(post.viewers, source.viewers);
    const group = preview.groups.find((item) => item.id === post.groupId);
    assert.ok(group);
    assert.equal(group.facebookId, source.group === 'halalclub' ? '' : source.group);
  }
  assert.equal(preview.groups.find((group) => group.name === 'Halal ฮาลาล')?.facebookId, '');
  assert.equal(
    preview.posts.find((post) => post.facebookPostId === '1441014217530766')?.viewers,
    612,
  );
  assert.equal(preview.posts.filter((post) => post.viewers === null).length, 4);
  const workspace = validateWorkspace({
    ...createEmptyWorkspace(),
    groups: preview.groups,
    posts: preview.posts,
  });
  assert.equal(deserializeWorkspace(serializeWorkspace(workspace)).posts.length, 26);
  const roundtrip = previewPostsCsv(exportPostsCsv(workspace), createEmptyWorkspace(), 'vetra');
  assert.deepEqual(roundtrip.errors, []);
  assert.deepEqual(
    roundtrip.posts.find((post) => post.facebookPostId === '1441014217530766')?.viewers,
    612,
  );
});

test('sample import can omit existing post IDs without changing other rows', () => {
  const result = previewPostsCsv(
    providedSamplePostsCsv(new Set(['1441014217530766', '28824965000503522'])),
    createEmptyWorkspace(),
    'vetra',
  );
  assert.deepEqual(result.errors, []);
  assert.equal(result.posts.length, 24);
  assert.ok(!result.posts.some((post) => post.facebookPostId === '1441014217530766'));
  assert.ok(!result.posts.some((post) => post.facebookPostId === '28824965000503522'));
});

test('reloading the supplied sample skips posts already imported', () => {
  const first = previewPostsCsv(providedSamplePostsCsv(), createEmptyWorkspace(), 'vetra');
  const workspace = {
    ...createEmptyWorkspace(),
    groups: first.groups,
    posts: first.posts,
  };
  const second = previewPostsCsv(providedSamplePostsCsv(), workspace, 'vetra');
  assert.deepEqual(second.errors, []);
  assert.equal(second.posts.length, 0);
  assert.equal(second.groups.length, 0);
  assert.equal(second.skipped, 26);
});
