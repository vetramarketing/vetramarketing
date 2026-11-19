import assert from 'node:assert/strict';
import test from 'node:test';
import { exportPostsCsv, previewPostsCsv } from '../src/lib/csv';
import { createEmptyWorkspace } from '../src/lib/data';

test('CSV keeps an explicit zero comments count distinct from an unknown count', () => {
  const workspace = createEmptyWorkspace();
  const preview = previewPostsCsv(
    'Product,Complete URL (auto),Comments\nHoney,https://example.com/post-a,0\nTea,https://example.com/post-b,',
    workspace,
    'vetra',
  );
  assert.deepEqual(preview.errors, []);
  assert.deepEqual(
    preview.posts.map((post) => post.commentCount),
    [0, null],
  );

  const exported = exportPostsCsv({ ...workspace, posts: preview.posts });
  const restored = previewPostsCsv(exported, workspace, 'vetra');
  assert.deepEqual(restored.errors, []);
  assert.deepEqual(
    restored.posts.map((post) => post.commentCount),
    [0, null],
  );
});

test('CSV rejects fractional and negative comments counts', () => {
  const preview = previewPostsCsv(
    'Product,Complete URL (auto),Comments\nHoney,https://example.com/post-a,-1\nTea,https://example.com/post-b,1.5',
    createEmptyWorkspace(),
    'vetra',
  );
  assert.equal(preview.posts.length, 0);
  assert.equal(preview.errors.length, 2);
  assert.ok(preview.errors.every((message) => message.includes('Comments')));
});
