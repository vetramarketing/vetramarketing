import assert from 'node:assert/strict';
import test from 'node:test';
import { postEditorSnapshot, type PostEditorFields } from '../src/lib/post-editor-snapshot';

const fields: PostEditorFields = {
  companyId: 'vetra',
  product: 'Honey',
  groupId: 'coffee',
  platform: 'facebook',
  postType: 'group',
  publicationStatus: 'published',
  facebookGroupId: '123',
  publishedAt: '2026-10-16T09:00',
  facebookPostId: '12345678901234567890',
  url: '',
  color: '#4969d7',
  viewers: '14',
  comments: '',
};

test('raw edits remain dirty even when save normalization would discard them', () => {
  const initial = postEditorSnapshot(fields);
  assert.notEqual(postEditorSnapshot({ ...fields, product: `${fields.product} ` }), initial);
  assert.notEqual(postEditorSnapshot({ ...fields, url: ' ' }), initial);
  assert.notEqual(postEditorSnapshot({ ...fields, postType: 'page' }), initial);
  assert.notEqual(postEditorSnapshot({ ...fields, publicationStatus: 'pending' }), initial);
  assert.notEqual(postEditorSnapshot({ ...fields, facebookGroupId: '124' }), initial);
  assert.notEqual(postEditorSnapshot({ ...fields, viewers: '014' }), initial);
});

test('changing or clearing the Viewers total counts as an edit', () => {
  const initial = postEditorSnapshot(fields);
  assert.notEqual(postEditorSnapshot({ ...fields, viewers: '' }), initial);
  assert.notEqual(postEditorSnapshot({ ...fields, viewers: '15' }), initial);
});

test('adding or clearing a comments total counts as an edit', () => {
  const initial = postEditorSnapshot(fields);
  assert.notEqual(postEditorSnapshot({ ...fields, comments: '0' }), initial);
  assert.notEqual(postEditorSnapshot({ ...fields, comments: '12' }), initial);
});

test('restoring the original raw values clears the dirty state', () => {
  const edited = { ...fields, product: 'A different product' };
  assert.notEqual(postEditorSnapshot(edited), postEditorSnapshot(fields));
  assert.equal(
    postEditorSnapshot({ ...edited, product: fields.product }),
    postEditorSnapshot(fields),
  );
});
