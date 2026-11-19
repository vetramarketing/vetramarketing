import assert from 'node:assert/strict';
import test from 'node:test';
import { createEmptyWorkspace } from '../src/lib/data';
import { convertFacebookPendingPostUrl } from '../src/lib/facebook-post-url';
import { newDuplicatePair, normalizedPostUrl, postIdentityKeys } from '../src/lib/post-identity';
import { reviewPostLink } from '../src/lib/post-link-review';
import { PostConflictError, preparePostSave } from '../src/lib/post-save';
import type { Group, Post, Workspace } from '../src/lib/types';

function group(id: string, facebookId: string): Group {
  return {
    id,
    companyId: 'vetra',
    name: `Group ${facebookId}`,
    facebookId,
    category: '',
    notes: '',
  };
}

function post(overrides: Partial<Post> = {}): Post {
  return {
    id: 'candidate',
    companyId: 'vetra',
    groupId: 'group-123',
    product: 'Coffee Blossom Honey',
    platform: 'facebook',
    publishedAt: '',
    facebookPostId: '',
    url: '',
    viewers: null,
    color: '#263b4b',
    ...overrides,
  };
}

function workspace(groups: Group[], posts: Post[]): Workspace {
  return { ...createEmptyWorkspace(), groups, posts };
}

test('review finds the active record across link variants even if a trashed copy comes first', () => {
  const tracked = post({
    id: 'tracked',
    facebookPostId: '456',
    url: 'https://www.facebook.com/groups/123/posts/456/',
  });
  const trashed = { ...tracked, id: 'trashed', deletedAt: '2026-10-17T00:00:00Z' };
  const data = workspace([group('group-123', '123')], [trashed, tracked]);

  for (const url of [
    'https://m.facebook.com/groups/123/permalink/456/?fbclid=share',
    'https://www.facebook.com/groups/123/?multi_permalinks=456&ref=share',
  ]) {
    const result = reviewPostLink(data, post({ id: 'new-record', url }));
    assert.equal(result.exactMatch?.id, tracked.id);
    assert.deepEqual(result.possibleMetaRows, []);
  }

  const ownEdit = reviewPostLink(data, { ...tracked, url: tracked.url });
  assert.equal(ownEdit.exactMatch, null);
});

test('same-group linkless Meta rows are suggestions, never an automatic exact match', () => {
  const meta86 = post({
    id: 'provided-meta-row-86',
    publicationStatus: 'pending',
    metaSourceRow: 86,
    metaGroupKey: '123',
  });
  const meta117 = post({
    id: 'provided-meta-row-117',
    publicationStatus: 'pending',
    metaSourceRow: 117,
    metaGroupKey: '123',
  });
  const otherGroup = post({
    id: 'provided-meta-row-95',
    groupId: 'group-999',
    metaSourceRow: 95,
    metaGroupKey: '999',
  });
  const trashed = post({
    id: 'provided-meta-row-96',
    metaSourceRow: 96,
    metaGroupKey: '123',
    deletedAt: '2026-10-17T00:00:00Z',
  });
  const linked = post({
    id: 'linked',
    facebookPostId: '789',
    url: 'https://www.facebook.com/groups/123/posts/789/',
  });
  const data = workspace(
    [group('group-123', '123'), group('group-999', '999')],
    [meta86, meta117, otherGroup, trashed, linked],
  );

  const result = reviewPostLink(
    data,
    post({ id: 'new-record', url: 'https://www.facebook.com/groups/123/posts/456/' }),
  );
  assert.equal(result.exactMatch, null);
  assert.deepEqual(
    result.possibleMetaRows.map((item) => item.id),
    [meta86.id, meta117.id],
  );

  const edit = reviewPostLink(data, {
    ...meta86,
    url: 'https://www.facebook.com/groups/123/posts/456/',
  });
  assert.deepEqual(
    edit.possibleMetaRows.map((item) => item.id),
    [meta117.id],
  );
});

test('pending group context can identify exact and provisional matches before the group is saved', () => {
  const pendingGroup = group('unsaved-group', '123');
  const tracked = post({ id: 'tracked', facebookPostId: '456', url: '' });
  const provisional = post({
    id: 'provided-meta-row-86',
    groupId: '',
    publicationStatus: 'pending',
    metaSourceRow: 86,
    metaGroupKey: '123',
  });
  const data = workspace([group('group-123', '123')], [tracked, provisional]);

  const result = reviewPostLink(
    data,
    post({ id: 'new-record', groupId: pendingGroup.id, facebookPostId: '456' }),
    pendingGroup,
  );
  assert.equal(result.exactMatch?.id, tracked.id);
  assert.deepEqual(
    result.possibleMetaRows.map((item) => item.id),
    [provisional.id],
  );
});

test('a page URL does not suggest the group from a provisional row being edited', () => {
  const provisional = post({
    id: 'provided-meta-row-86',
    metaSourceRow: 86,
    metaGroupKey: '123',
  });
  const data = workspace([group('group-123', '123')], [provisional]);
  const result = reviewPostLink(data, {
    ...provisional,
    groupId: '',
    url: 'https://www.facebook.com/examplepage/posts/789',
  });
  assert.equal(result.exactMatch, null);
  assert.deepEqual(result.possibleMetaRows, []);
});

test('a Facebook group slug link suggests only matching linkless Meta rows', () => {
  const provisional = post({
    id: 'provided-meta-row-90',
    groupId: '',
    metaSourceRow: 90,
    metaGroupKey: 'promoinsider',
  });
  const data = workspace([], [provisional]);
  const result = reviewPostLink(
    data,
    post({
      id: 'new-record',
      groupId: '',
      url: 'https://www.facebook.com/groups/promoinsider/posts/789/',
    }),
  );
  assert.deepEqual(
    result.possibleMetaRows.map((item) => item.id),
    [provisional.id],
  );
});

test('handle post links share an identity across case, host, tracking, and share formats', () => {
  const canonical = 'https://www.facebook.com/groups/designg/posts/1810899433450636/';
  const tracked = post({ id: 'tracked-handle', groupId: '', url: canonical });
  const data = workspace([], [tracked]);

  for (const url of [
    canonical,
    'https://m.facebook.com/groups/DesignG/permalink/1810899433450636/?fbclid=share#comments',
    'https://web.facebook.com/groups/DESIGNG/posts/1810899433450636?ref=share&utm_source=copy',
    'https://facebook.com/groups/DesignG/?multi_permalinks=1810899433450636&ref=share',
  ]) {
    const candidate = post({ id: 'new-record', groupId: '', url });
    assert.equal(normalizedPostUrl(url), canonical);
    assert.equal(reviewPostLink(data, candidate).exactMatch?.id, tracked.id);
    assert.throws(
      () => preparePostSave(data, candidate, null),
      (error: unknown) => error instanceof PostConflictError && error.reason === 'existing-post',
    );
  }
});

test('different handle posts retain distinct nonempty identities and can both be saved', () => {
  const tracked = post({
    id: 'tracked-handle',
    groupId: '',
    url: 'https://www.facebook.com/groups/designg/posts/1810899433450636/',
  });
  const data = workspace([], [tracked]);
  for (const url of [
    'https://www.facebook.com/groups/designg/posts/1810899433450637/',
    'https://www.facebook.com/groups/anothergroup/posts/1810899433450636/',
  ]) {
    const candidate = post({ id: 'new-record', groupId: '', url });
    assert.ok(normalizedPostUrl(url));
    assert.equal(postIdentityKeys(candidate, data).has('url:'), false);
    assert.equal(reviewPostLink(data, candidate).exactMatch, null);
    const saved = preparePostSave(data, candidate, null);
    assert.equal(saved.posts.length, 2);
    assert.equal(newDuplicatePair(data, saved), null);
  }
});

test('handle post identity preserves Trash replacement and blocks restoring an active duplicate', () => {
  const trashed = post({
    id: 'trashed-handle',
    groupId: '',
    url: 'https://www.facebook.com/groups/designg/posts/1810899433450636/',
    deletedAt: '2026-10-17T00:00:00Z',
  });
  const data = workspace([], [trashed]);
  const candidate = post({
    id: 'replacement',
    groupId: '',
    url: 'https://m.facebook.com/groups/DesignG/?multi_permalinks=1810899433450636',
  });
  assert.equal(reviewPostLink(data, candidate).exactMatch, null);
  const saved = preparePostSave(data, candidate, null);
  assert.equal(newDuplicatePair(data, saved), null);
  assert.equal(saved.posts.find((item) => item.id === trashed.id)?.deletedAt, trashed.deletedAt);
  const restored = {
    ...saved,
    posts: saved.posts.map((item) =>
      item.id === trashed.id ? { ...item, deletedAt: undefined } : item,
    ),
  };
  assert.deepEqual(new Set(newDuplicatePair(saved, restored)), new Set([trashed.id, candidate.id]));
});

test('pending URLs do not identify published URLs until intentionally converted', () => {
  for (const groupKey of ['123', 'designg']) {
    const publishedUrl = `https://www.facebook.com/groups/${groupKey}/posts/1810899433450636/`;
    const pendingUrl = `https://www.facebook.com/groups/${groupKey}/pending_posts/1810899433450636/`;
    const tracked = post({ id: 'published', groupId: '', url: publishedUrl });
    const data = workspace([], [tracked]);
    const candidate = post({ id: 'pending', groupId: '', url: pendingUrl });
    assert.notEqual(normalizedPostUrl(pendingUrl), normalizedPostUrl(publishedUrl));
    assert.equal(reviewPostLink(data, candidate).exactMatch, null);
    const convertedUrl = convertFacebookPendingPostUrl(pendingUrl);
    assert.equal(convertedUrl, publishedUrl);
    assert.equal(
      reviewPostLink(data, { ...candidate, url: convertedUrl ?? '' }).exactMatch?.id,
      tracked.id,
    );
  }
});
