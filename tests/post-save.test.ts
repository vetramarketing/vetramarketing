import assert from 'node:assert/strict';
import test from 'node:test';
import { createEmptyWorkspace } from '../src/lib/data';
import { PostConflictError, preparePostSave, type PostConflictReason } from '../src/lib/post-save';
import type { Post, Workspace } from '../src/lib/types';

function post(overrides: Partial<Post> = {}): Post {
  return {
    id: 'post-one',
    companyId: 'vetra',
    groupId: '',
    title: 'The original title',
    content: 'The original caption',
    product: 'Coffee Blossom Honey',
    platform: 'facebook',
    status: 'published',
    scheduledAt: '',
    publishedAt: '2026-10-15T03:00:00Z',
    facebookPostId: '123456789012345678901234',
    url: 'https://www.facebook.com/groups/123/posts/456/',
    viewers: 100,
    color: '#263b4b',
    ...overrides,
  };
}

function workspace(posts: Post[]): Workspace {
  return { ...createEmptyWorkspace(), posts };
}

function conflict(reason: PostConflictReason) {
  return (error: unknown) => {
    assert.ok(error instanceof PostConflictError);
    assert.equal(error.code, 'POST_CONFLICT');
    assert.equal(error.reason, reason);
    return true;
  };
}

test('an existing edit merges into latest data while retaining unrelated posts, companies, and groups', () => {
  const baseline = post();
  const other = post({
    id: 'post-two',
    title: 'Changed in another tab',
    facebookPostId: '222',
    url: 'https://www.facebook.com/groups/123/posts/222/',
  });
  const added = post({
    id: 'post-three',
    facebookPostId: '333',
    url: 'https://www.facebook.com/groups/123/posts/333/',
  });
  const latest = workspace([other, structuredClone(baseline), added]);
  latest.companies[0].description = 'Updated store details from another tab';
  latest.groups = [
    {
      id: 'new-group',
      companyId: 'vetra',
      name: 'New group',
      facebookId: '123',
      category: '',
      notes: '',
    },
  ];
  const result = preparePostSave(latest, { ...baseline, title: 'My editor change' }, baseline);
  assert.deepEqual(
    result.posts.map((item) => item.id),
    ['post-two', 'post-one', 'post-three'],
  );
  assert.equal(result.posts[1].title, 'My editor change');
  assert.equal(result.posts[0], other);
  assert.equal(result.posts[2], added);
  assert.equal(result.companies, latest.companies);
  assert.equal(result.groups, latest.groups);
  assert.equal(result.sample, latest.sample);
});

test('another tab changing the Viewers total blocks a stale save', () => {
  const baseline = post();
  for (const viewers of [null, 150]) {
    assert.throws(
      () =>
        preparePostSave(
          workspace([post({ viewers })]),
          { ...baseline, title: 'Stale edit' },
          baseline,
        ),
      conflict('changed'),
    );
  }
});

test('every editable record field is protected against concurrent changes', () => {
  const baseline = post();
  const changes: Partial<Post>[] = [
    { product: 'Another product' },
    { companyId: 'another-store' },
    { groupId: 'another-group' },
    { platform: 'instagram' },
    { publishedAt: '2026-10-15T03:01:00Z' },
    { facebookPostId: '99999999999999999999' },
    { url: 'https://www.facebook.com/groups/123/posts/789/' },
    { publicationStatus: 'pending' },
    { metaSourceRow: 86 },
    { metaPublishedLabel: '15 ต.ค. เวลา 18:24' },
    { metaGroupName: 'Example group' },
    { metaGroupKey: '123' },
    { pinned: true },
    { color: '#ffffff' },
  ];
  for (const change of changes) {
    assert.throws(
      () => preparePostSave(workspace([post(change)]), baseline, baseline),
      conflict('changed'),
    );
  }
});

test('editing stale post details cannot silently overwrite a pin changed in another tab', () => {
  const baseline = post({ pinned: false });
  const latest = workspace([post({ pinned: true })]);
  assert.throws(
    () => preparePostSave(latest, { ...baseline, viewers: 125 }, baseline),
    conflict('changed'),
  );
  assert.equal(latest.posts[0].pinned, true);
});

test('missing or trashed posts cannot be recreated by saving a stale editor', () => {
  const baseline = post();
  assert.throws(() => preparePostSave(workspace([]), baseline, baseline), conflict('removed'));
  assert.throws(
    () =>
      preparePostSave(workspace([post({ deletedAt: '2026-10-16T06:00:00Z' })]), baseline, baseline),
    conflict('removed'),
  );
});

test('JSON property ordering and absent optional fields do not cause false conflicts', () => {
  const baseline = post();
  const reordered = Object.fromEntries(Object.entries(baseline).reverse()) as unknown as Post;
  reordered.deletedAt = undefined;
  const result = preparePostSave(workspace([reordered]), { ...baseline, title: 'Saved' }, baseline);
  assert.equal(result.posts[0].title, 'Saved');
});

test('new records prepend to the latest workspace for null and empty-ID draft baselines', () => {
  const existing = post({ title: 'Latest version from another tab' });
  const latest = workspace([existing]);
  const fresh = post({
    id: 'brand-new',
    facebookPostId: '999',
    url: 'https://www.facebook.com/groups/123/posts/999/',
  });
  for (const baseline of [null, post({ id: '' })]) {
    const result = preparePostSave(latest, fresh, baseline);
    assert.deepEqual(
      result.posts.map((item) => item.id),
      ['brand-new', 'post-one'],
    );
    assert.equal(result.posts[1], existing);
    assert.equal(result.companies, latest.companies);
    assert.equal(result.groups, latest.groups);
  }
});

test('new IDs cannot collide with either active or trashed records', () => {
  for (const deletedAt of [undefined, '2026-10-16T06:00:00Z']) {
    const latest = workspace([post({ deletedAt })]);
    assert.throws(() => preparePostSave(latest, post(), null), conflict('duplicate'));
  }
  assert.throws(
    () => preparePostSave(workspace([]), post({ id: '' }), null),
    conflict('missing-id'),
  );
  assert.throws(
    () => preparePostSave(workspace([post()]), post({ id: 'different-record' }), post()),
    conflict('identity'),
  );
});

test('manual entry rejects an existing Facebook post across ID and permalink formats', () => {
  const latest = workspace([
    post({ id: 'tracked', groupId: 'group-123', facebookPostId: '456', url: '' }),
  ]);
  latest.groups = [
    {
      id: 'group-123',
      companyId: 'vetra',
      name: 'Community',
      facebookId: '123',
      category: '',
      notes: '',
    },
  ];
  const duplicate = post({
    id: 'new-record',
    groupId: '',
    facebookPostId: '',
    url: 'https://m.facebook.com/groups/123/permalink/456/?fbclid=tracking',
  });
  assert.throws(() => preparePostSave(latest, duplicate, null), conflict('existing-post'));

  const fromIds = post({ id: 'new-record', groupId: 'group-123', facebookPostId: '456', url: '' });
  latest.posts[0] = post({
    id: 'tracked',
    groupId: '',
    facebookPostId: '',
    url: 'https://www.facebook.com/groups/123/posts/456/#comments',
  });
  assert.throws(() => preparePostSave(latest, fromIds, null), conflict('existing-post'));
});

test('group share links identify the same post as a posts URL even without saved IDs', () => {
  const latest = workspace([
    post({
      id: 'tracked',
      groupId: '',
      facebookPostId: '',
      url: 'https://www.facebook.com/groups/123/?multi_permalinks=456&ref=share',
    }),
  ]);
  const duplicate = post({
    id: 'new-record',
    groupId: '',
    facebookPostId: '',
    url: 'https://m.facebook.com/groups/123/posts/456/',
  });
  assert.throws(() => preparePostSave(latest, duplicate, null), conflict('existing-post'));
});

test('manual entry can replace a trashed record without modifying it', () => {
  const original = post({
    id: 'tracked',
    platform: 'instagram',
    facebookPostId: '',
    url: 'https://www.instagram.com/p/ABC123/?utm_source=share#comments',
    deletedAt: '2026-10-16T06:00:00Z',
  });
  const duplicate = post({
    id: 'new-record',
    platform: 'instagram',
    facebookPostId: '',
    url: 'https://instagram.com/p/ABC123?utm_source=share',
  });
  const saved = preparePostSave(workspace([original]), duplicate, null);
  assert.deepEqual(saved.posts, [duplicate, original]);
});

test('editing a post can retain its identity but cannot change it to another tracked post', () => {
  const original = post({ id: 'one' });
  const other = post({
    id: 'two',
    facebookPostId: '789',
    url: 'https://www.facebook.com/groups/123/posts/789/',
  });
  const latest = workspace([original, other]);
  const updated = preparePostSave(
    latest,
    {
      ...original,
      product: 'New product',
      viewers: 120,
    },
    original,
  );
  assert.equal(updated.posts[0].product, 'New product');
  assert.throws(
    () => preparePostSave(latest, { ...original, url: other.url }, original),
    conflict('existing-post'),
  );
});

test('adding a link to a provisional Meta row rejects an already tracked post without changing either record', () => {
  const provisional = post({
    id: 'provided-meta-row-86',
    groupId: 'group-123',
    publishedAt: '',
    facebookPostId: '',
    url: '',
    viewers: 1,
    publicationStatus: 'pending',
    metaSourceRow: 86,
    metaGroupKey: '123',
    metaGroupName: 'Community',
  });
  const tracked = post({
    id: 'already-tracked',
    groupId: 'group-123',
    facebookPostId: '456',
    url: 'https://www.facebook.com/groups/123/posts/456/',
  });
  const latest = workspace([provisional, tracked]);
  const unchanged = structuredClone(latest);
  latest.groups = [
    {
      id: 'group-123',
      companyId: 'vetra',
      name: 'Community',
      facebookId: '123',
      category: '',
      notes: '',
    },
  ];
  unchanged.groups = structuredClone(latest.groups);

  assert.throws(
    () =>
      preparePostSave(
        latest,
        {
          ...provisional,
          publicationStatus: 'published',
          facebookPostId: '456',
          url: 'https://m.facebook.com/groups/123/permalink/456/?fbclid=share',
        },
        provisional,
      ),
    conflict('existing-post'),
  );
  assert.deepEqual(latest, unchanged);
});

test('same group alone does not merge distinct posts, even when more than one Meta row is provisional', () => {
  const first = post({
    id: 'provided-meta-row-86',
    groupId: 'group-123',
    publishedAt: '',
    facebookPostId: '',
    url: '',
    publicationStatus: 'pending',
    metaSourceRow: 86,
    metaGroupKey: '123',
  });
  const second = { ...first, id: 'provided-meta-row-117', metaSourceRow: 117 };
  const latest = workspace([first, second]);
  latest.groups = [
    {
      id: 'group-123',
      companyId: 'vetra',
      name: 'Community',
      facebookId: '123',
      category: '',
      notes: '',
    },
  ];

  const linked = preparePostSave(
    latest,
    {
      ...first,
      publicationStatus: 'published',
      facebookPostId: '456',
      url: 'https://www.facebook.com/groups/123/posts/456/',
    },
    first,
  );
  assert.equal(linked.posts.length, 2);
  assert.equal(linked.posts[0].id, first.id);
  assert.equal(linked.posts[0].facebookPostId, '456');
  assert.deepEqual(linked.posts[1], second);

  const differentPost = post({
    id: 'new-record',
    groupId: 'group-123',
    facebookPostId: '789',
    url: 'https://www.facebook.com/groups/123/posts/789/',
  });
  const added = preparePostSave(linked, differentPost, null);
  assert.deepEqual(
    added.posts.map((item) => item.id),
    ['new-record', first.id, second.id],
  );
  assert.throws(
    () =>
      preparePostSave(
        linked,
        { ...second, url: 'https://www.facebook.com/groups/123/permalink/456/' },
        second,
      ),
    conflict('existing-post'),
  );
});

test('successful and rejected saves leave all source records and arrays untouched', () => {
  const baseline = post();
  const edited = post({ title: 'My new title' });
  const latest = workspace([post()]);
  const sources = structuredClone({ baseline, edited, latest });
  const result = preparePostSave(latest, edited, baseline);
  assert.deepEqual({ baseline, edited, latest }, sources);
  assert.notEqual(result, latest);
  assert.notEqual(result.posts, latest.posts);
  assert.notEqual(result.posts[0], edited);
  assert.equal(result.posts[0].viewers, edited.viewers);
  const changed = workspace([post({ product: 'Another product' })]);
  const changedSnapshot = structuredClone(changed);
  assert.throws(() => preparePostSave(changed, edited, baseline), conflict('changed'));
  assert.deepEqual(changed, changedSnapshot);
});
