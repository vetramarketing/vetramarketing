import assert from 'node:assert/strict';
import test from 'node:test';
import { createEmptyWorkspace, latestViewers, validateWorkspace } from '../src/lib/data';
import { previewPostsCsv } from '../src/lib/csv';
import { addProvidedLatestReadings } from '../src/lib/provided-latest-readings';
import { providedSamplePostsCsv } from '../src/lib/provided-sample-posts';
import { deserializeWorkspace, serializeWorkspace } from '../src/lib/workspace-storage';

function sampleWorkspace() {
  const preview = previewPostsCsv(providedSamplePostsCsv(), createEmptyWorkspace(), 'vetra');
  assert.deepEqual(preview.errors, []);
  return {
    ...createEmptyWorkspace(),
    groups: preview.groups,
    posts: preview.posts,
  };
}

test('replaces earlier totals for all 26 supplied posts and keeps only current totals', () => {
  const initial = sampleWorkspace();
  const original = initial.posts.map((post) => post.viewers);
  const result = addProvidedLatestReadings(initial);
  assert.deepEqual(
    [result.added, result.alreadyPresent, result.missing, result.conflicts],
    [25, 1, 0, 0],
  );
  assert.equal(
    result.workspace.posts.reduce((sum, post) => sum + latestViewers(post), 0),
    3993,
  );
  assert.equal(
    result.workspace.posts.find((post) => post.facebookPostId === '1441014217530766')?.viewers,
    883,
  );
  assert.deepEqual(
    initial.posts.map((post) => post.viewers),
    original,
  );
  const stored = serializeWorkspace(validateWorkspace(result.workspace));
  assert.equal(stored.version, 12);
  assert.ok(stored.posts.every((post) => !('metrics' in post)));
  const roundtrip = deserializeWorkspace(stored);
  assert.equal(
    roundtrip.posts.reduce((sum, post) => sum + latestViewers(post), 0),
    3993,
  );
  assert.deepEqual(addProvidedLatestReadings(roundtrip), {
    workspace: roundtrip,
    added: 0,
    alreadyPresent: 26,
    missing: 0,
    conflicts: 0,
  });
});

test('keeps custom totals and ignores mismatched or deleted posts', () => {
  const initial = sampleWorkspace();
  const [first, second, third] = initial.posts;
  const changed = {
    ...initial,
    posts: initial.posts.map((post) =>
      post.id === first.id
        ? { ...post, viewers: 900 }
        : post.id === second.id
          ? { ...post, publishedAt: '2026-10-12T00:00:00Z' }
          : post.id === third.id
            ? { ...post, deletedAt: '2026-10-17T00:00:00Z' }
            : post,
    ),
  };
  const result = addProvidedLatestReadings(changed);
  assert.deepEqual(
    [result.added, result.alreadyPresent, result.missing, result.conflicts],
    [22, 1, 2, 1],
  );
  assert.equal(result.workspace.posts.find((post) => post.id === first.id)?.viewers, 900);
  assert.deepEqual(
    result.workspace.posts.find((post) => post.id === second.id),
    changed.posts[1],
  );
  assert.deepEqual(
    result.workspace.posts.find((post) => post.id === third.id),
    changed.posts[2],
  );
  assert.equal(initial.posts[0].viewers, 612);
});
