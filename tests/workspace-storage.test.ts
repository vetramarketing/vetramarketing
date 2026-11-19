import assert from 'node:assert/strict';
import test from 'node:test';
import { createSampleWorkspace } from '../src/lib/data';
import {
  deserializeWorkspace,
  LEGACY_WORKSPACE_KEY,
  PREVIOUS_WORKSPACE_KEY,
  OLDER_WORKSPACE_KEY,
  V3_WORKSPACE_KEY,
  V2_WORKSPACE_KEY,
  serializeWorkspace,
  WORKSPACE_KEY,
} from '../src/lib/workspace-storage';

const sample = () => createSampleWorkspace(new Date('2026-10-16T10:00:00Z'));
const legacySample = () => {
  const workspace = sample();
  return {
    ...workspace,
    posts: workspace.posts.map((post) => ({
      ...post,
      metrics: post.viewers === null ? [] : [{ date: '2026-10-16', viewers: post.viewers }],
    })),
  };
};

test('v3 history collapses to the latest dated total, including corrections and zero', () => {
  const base = serializeWorkspace({
    ...sample(),
    posts: sample().posts.filter((post) => post.status === 'published'),
  });
  for (const total of [0, 883]) {
    const legacy = {
      ...base,
      version: 3,
      posts: base.posts.slice(0, 1).map(({ viewers, ...post }) => ({
        ...post,
        metrics: [
          { date: '2026-10-17', viewers: total },
          { date: '2026-10-16', viewers: 1200 },
        ],
      })),
    };
    const before = structuredClone(legacy);
    const restored = deserializeWorkspace(legacy);
    assert.equal(restored.posts[0].viewers, total);
    assert.equal('metrics' in restored.posts[0], false);
    const stored = serializeWorkspace(restored);
    assert.equal(stored.posts[0].viewers, total);
    assert.equal('metrics' in stored.posts[0], false);
    assert.deepEqual(legacy, before);
  }
});

test('v1 and v2 backups migrate published posts only while preserving identity and readings', () => {
  const legacy = legacySample();
  legacy.sample = false;
  const v2 = {
    ...legacy,
    version: 2,
    posts: legacy.posts.map(({ title, content, status, scheduledAt, ...post }) => post),
  };
  const published = legacy.posts.filter((post) => post.publishedAt);

  for (const backup of [legacy, v2]) {
    const migrated = deserializeWorkspace(backup);
    const stored = serializeWorkspace(migrated);
    assert.equal(stored.version, 12);
    assert.equal(stored.posts.length, published.length);
    assert.deepEqual(
      stored.posts.map((post) => post.id),
      published.map((post) => post.id),
    );
    for (let index = 0; index < stored.posts.length; index += 1) {
      const post = stored.posts[index];
      assert.equal(post.publishedAt, published[index].publishedAt);
      assert.equal(post.viewers, published[index].viewers);
      assert.equal('metrics' in post, false);
      assert.equal(post.groupId, published[index].groupId);
      for (const removed of ['title', 'content', 'status', 'scheduledAt'])
        assert.equal(removed in post, false, `${removed} leaked into storage`);
    }
    assert.ok(migrated.posts.every((post) => !('status' in post)));
  }
  assert.equal(legacy.posts.length, 12, 'legacy data remains unchanged');
  assert.equal(WORKSPACE_KEY, 'vetra-marketing.workspace.v12');
  assert.equal(PREVIOUS_WORKSPACE_KEY, 'vetra-marketing.workspace.v5');
  assert.equal(OLDER_WORKSPACE_KEY, 'vetra-marketing.workspace.v4');
  assert.equal(V3_WORKSPACE_KEY, 'vetra-marketing.workspace.v3');
  assert.equal(V2_WORKSPACE_KEY, 'vetra-marketing.workspace.v2');
  assert.equal(LEGACY_WORKSPACE_KEY, 'vetra-marketing.workspace.v1');
});

test('current backups round trip and reject invalid or unpublished data', () => {
  const source = legacySample();
  source.sample = false;
  const workspace = deserializeWorkspace(source);
  const saved = serializeWorkspace(workspace);
  assert.deepEqual(serializeWorkspace(deserializeWorkspace(saved)), saved);
  assert.ok(
    saved.posts.some((post) => !post.url),
    'existing posts without links remain recoverable',
  );

  const brokenDate = structuredClone(saved);
  brokenDate.posts[0].publishedAt = 'not-a-date';
  assert.throws(() => deserializeWorkspace(brokenDate));

  const unpublished = structuredClone(saved);
  unpublished.posts[0].publishedAt = '';
  assert.equal(deserializeWorkspace(unpublished).posts[0].publishedAt, '');

  const legacyFields = structuredClone(saved);
  Object.assign(legacyFields.posts[0], { status: 'published', content: 'old copy' });
  assert.throws(() => deserializeWorkspace(legacyFields), /removed post fields/);

  const draft = sample();
  assert.throws(() => serializeWorkspace(draft), /Only published posts/);
});

test('current backups require script and order collections instead of silently dropping them', () => {
  const workspace = deserializeWorkspace(legacySample());
  const saved = serializeWorkspace(workspace);
  for (const scripts of [undefined, null, {}])
    assert.throws(() => deserializeWorkspace({ ...saved, scripts }), /scripts collection/);
  for (const orders of [undefined, null, {}])
    assert.throws(() => deserializeWorkspace({ ...saved, orders }), /orders collection/);
  const { scripts: _scripts, ...legacy } = saved;
  assert.deepEqual(deserializeWorkspace({ ...legacy, version: 8 }).scripts, []);
});

test('current saves preserve a Pending status, known publication date, and optional comments', () => {
  const source = deserializeWorkspace(
    serializeWorkspace({
      ...sample(),
      sample: false,
      posts: sample().posts.filter((post) => post.status === 'published'),
    }),
  );
  const originalDate = source.posts[0].publishedAt;
  source.posts[0].publicationStatus = 'pending';
  source.posts[0].commentCount = 0;
  const saved = serializeWorkspace(source);
  const restored = deserializeWorkspace(saved);
  assert.equal(restored.posts[0].publicationStatus, 'pending');
  assert.equal(restored.posts[0].publishedAt, originalDate);
  assert.equal(restored.posts[0].commentCount, 0);
  const olderV8 = structuredClone(saved) as typeof saved;
  delete olderV8.posts[0].commentCount;
  assert.equal(deserializeWorkspace(olderV8).posts[0].commentCount, null);
});

test('loading a workspace names only generated group placeholders from the directory', () => {
  const source = serializeWorkspace({
    ...sample(),
    sample: false,
    posts: sample().posts.filter((post) => post.status === 'published'),
  });
  source.groups[0].facebookId = '878540877111439';
  source.groups[0].name = 'Facebook group 878540877111439';
  source.groups[1].facebookId = '823815689319182';
  source.groups[1].name = 'My team name';

  const restored = deserializeWorkspace(source);
  assert.equal(restored.groups[0].name, 'กลุ่มชาวลำลูกกา');
  assert.equal(restored.groups[1].name, 'My team name');
  assert.equal(source.groups[0].name, 'Facebook group 878540877111439');
  assert.equal(serializeWorkspace(restored).groups[0].name, 'กลุ่มชาวลำลูกกา');
});

test('sample migrations omit untouched built-in posts but preserve real identified edits', () => {
  const legacy = legacySample();
  legacy.posts[0].url = 'https://example.com/a-real-post';
  legacy.posts.push({
    ...legacy.posts[1],
    id: 'user-added-post',
    url: 'https://example.com/another-real-post',
  });
  const v2 = {
    ...legacy,
    version: 2,
    posts: legacy.posts.map(({ title, content, status, scheduledAt, ...post }) => post),
  };
  const v3 = { ...v2, version: 3 };

  for (const backup of [legacy, v2, v3]) {
    const migrated = deserializeWorkspace(backup);
    assert.deepEqual(
      migrated.posts.map((post) => post.id),
      ['sample-1', 'user-added-post'],
    );
    assert.equal(migrated.posts[0].url, 'https://example.com/a-real-post');
    assert.equal(migrated.sample, false);
    assert.equal(serializeWorkspace(migrated).posts.length, 2);
    assert.equal(serializeWorkspace(migrated).sample, false);
  }
  assert.equal(legacy.posts.length, 13, 'the source backup is not modified');
});

test('a date cannot promote a legacy draft to a published active record', () => {
  const legacy = legacySample();
  legacy.sample = false;
  const draft = legacy.posts.find((post) => post.status === 'draft')!;
  draft.publishedAt = '2026-10-15T07:00:00.000Z';
  const expectedIds = legacy.posts
    .filter((post) => post.status === 'published')
    .map((post) => post.id);
  assert.deepEqual(
    deserializeWorkspace(legacy).posts.map((post) => post.id),
    expectedIds,
  );

  const v2WithStatus = {
    ...legacy,
    version: 2,
    posts: legacy.posts.map(({ title, content, scheduledAt, ...post }) => post),
  };
  assert.deepEqual(
    deserializeWorkspace(v2WithStatus).posts.map((post) => post.id),
    expectedIds,
  );

  const active = deserializeWorkspace(legacy);
  active.posts[0].status = 'draft';
  active.posts[0].viewers = null;
  assert.throws(() => serializeWorkspace(active), /Only published posts/);
  assert.equal(draft.status, 'draft', 'migration does not alter the recovery copy');
});

test('current backups preserve explicit and absent product links without legacy name backfill', () => {
  const source = serializeWorkspace({
    ...sample(),
    sample: false,
    posts: sample().posts.filter((post) => post.status === 'published'),
  });
  source.products = [
    { id: 'current-product', name: source.posts[0].product, imageUrl: '', sortOrder: 0 },
    { id: 'renamed-product', name: 'Renamed catalog product', imageUrl: '', sortOrder: 1 },
  ];
  source.posts[1].productId = 'renamed-product';
  const copy = structuredClone(source);
  const restored = deserializeWorkspace(source);
  assert.equal(restored.posts[0].productId, undefined);
  assert.equal(restored.posts[1].productId, 'renamed-product');
  assert.equal(restored.posts[1].product, source.posts[1].product);
  assert.deepEqual(source, copy);
  const invalid = structuredClone(source);
  invalid.products[1].imageUrl = 'javascript:bad()';
  assert.throws(() => deserializeWorkspace(invalid), /Product image URL/);
});
