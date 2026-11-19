import assert from 'node:assert/strict';
import test from 'node:test';
import { createEmptyWorkspace, reportingDate, validateWorkspace } from '../src/lib/data';
import { formatCalendarDate } from '../src/lib/calendar';
import { previewPostsCsv } from '../src/lib/csv';
import { buildPostSearchIndex, createPostSearchMatcher } from '../src/lib/post-search';
import { matchesPostStatusFilter, publicPostUrl, sortPosts } from '../src/lib/post-tools';
import { providedSamplePostsCsv } from '../src/lib/provided-sample-posts';
import { addProvidedProducts } from '../src/lib/provided-products';
import { addProvidedPostLinks } from '../src/lib/provided-post-links';
import { addProvidedMissingPosts } from '../src/lib/provided-missing-posts';
import { addProvidedMetaUnmatchedPosts } from '../src/lib/provided-meta-unmatched-posts';
import { addProvidedMetaRemaining } from '../src/lib/provided-meta-remaining';
import { applyProvidedMetaUpdate } from '../src/lib/provided-meta-update';
import type { Post, Workspace } from '../src/lib/types';

function post(overrides: Partial<Post> = {}): Post {
  return {
    id: 'record-one',
    companyId: 'vetra',
    groupId: 'group-one',
    product: 'น้ำผึ้งดอกกาแฟ Original Honey',
    productId: 'product-one',
    destinationId: 'destination-one',
    platform: 'facebook',
    publishedAt: '2026-10-11T18:05:00.000Z',
    facebookPostId: '144101421753076612345',
    url: '',
    viewers: 1234,
    commentCount: 0,
    color: '#263b4b',
    ...overrides,
  };
}

function fixture(): Workspace {
  const workspace = createEmptyWorkspace();
  workspace.products.push({
    id: 'product-one',
    name: 'ESHAN 320g New name',
    imageUrl: '',
    sortOrder: 0,
  });
  workspace.groups.push({
    id: 'group-one',
    companyId: 'vetra',
    name: 'คนรักกาแฟ Coffee Lovers',
    facebookId: '878540877111439123456',
    category: '',
    notes: '',
  });
  workspace.destinations!.push({
    id: 'destination-one',
    companyId: 'vetra',
    name: 'Coffee community',
    platform: 'facebook',
    kind: 'group',
    externalId: 'coffee-community',
    groupId: 'group-one',
  });
  workspace.posts.push(
    post(),
    post({
      id: 'other',
      productId: undefined,
      product: 'Tea',
      groupId: '',
      destinationId: undefined,
      facebookPostId: '',
      url: '',
      publishedAt: '',
      viewers: null,
      commentCount: null,
    }),
  );
  return workspace;
}

function search(workspace: Workspace, query: string): string[] {
  return workspace.posts
    .filter(createPostSearchMatcher(buildPostSearchIndex(workspace), query))
    .map((post) => post.id);
}

test('search combines words across linked and saved names, independent of order and case', () => {
  const workspace = fixture();
  for (const query of [
    'COFFEE eshan STORE',
    '320g คนรักกาแฟ',
    'Original New name',
    'น้ำผึ้งดอกกาแฟ VETRA',
    'coffee-community honey',
  ])
    assert.deepEqual(search(workspace, query), ['record-one'], query);
  assert.deepEqual(search(workspace, 'ESHAN unrelated'), []);
  assert.deepEqual(search(workspace, 'Tea Coffee'), []);
});

test('normalization accepts pasted spacing and equivalent Unicode without removing Thai marks', () => {
  const workspace = fixture();
  assert.deepEqual(search(workspace, '  ＥＳＨＡＮ\t320g\nVETRA\u00a0STORE  '), ['record-one']);
  assert.deepEqual(search(workspace, 'น้ำ\u200bผึ้งดอกกาแฟ'), ['record-one']);
  workspace.posts[0].product = 'ป่า café';
  workspace.posts[0].productId = undefined;
  assert.deepEqual(search(workspace, 'cafe\u0301'), ['record-one']);
  assert.deepEqual(search(workspace, 'ป้า'), []);
  assert.deepEqual(search(workspace, 'ป่า'), ['record-one']);
  assert.deepEqual(search(workspace, '[.*]'), []);
});

test('full-length IDs and equivalent Facebook permalinks work without a saved URL', () => {
  const workspace = fixture();
  for (const query of [
    '144101421753076612345',
    '878540877111439123456',
    'record-one',
    'https://m.facebook.com/groups/878540877111439123456/permalink/144101421753076612345/?fbclid=test',
    'ESHAN https://www.facebook.com/groups/878540877111439123456/?multi_permalinks=144101421753076612345',
  ])
    assert.deepEqual(search(workspace, query), ['record-one'], query);
  assert.deepEqual(search(workspace, '144101421753076612346'), []);
});

test('page and other-platform URLs retain meaningful identity while ignoring tracking', () => {
  const workspace = fixture();
  workspace.posts[0] = post({
    groupId: '',
    destinationId: undefined,
    url: 'https://www.facebook.com/story.php?story_fbid=123456&id=998877&fbclid=old',
  });
  assert.deepEqual(
    search(workspace, 'https://m.facebook.com/story.php?id=998877&story_fbid=123456&fbclid=new'),
    ['record-one'],
  );
  assert.deepEqual(
    search(workspace, 'https://facebook.com/story.php?id=998878&story_fbid=123456'),
    [],
  );
  workspace.posts[0] = post({
    platform: 'tiktok',
    groupId: '',
    destinationId: undefined,
    url: 'https://www.tiktok.com/@eshan/video/987654?utm_source=old',
  });
  assert.deepEqual(search(workspace, 'https://www.tiktok.com/@eshan/video/987654?utm_source=new'), [
    'record-one',
  ]);
});

test('publication dates use Bangkok calendar days, never the previous UTC day', () => {
  const workspace = fixture();
  for (const query of ['12/10/2026', '2026-10-12', '12/10/2026 01:05'])
    assert.deepEqual(search(workspace, query), ['record-one']);
  assert.deepEqual(search(workspace, '11/10/2026'), []);
  assert.deepEqual(search(workspace, '2026-10-11'), []);
  workspace.posts[0].publishedAt = 'invalid';
  assert.doesNotThrow(() => buildPostSearchIndex(workspace));
});

test('provisional Meta rows remain individually searchable without inventing dates or links', () => {
  const workspace = fixture();
  workspace.posts = [
    post({
      id: 'row-88',
      groupId: '',
      destinationId: undefined,
      facebookPostId: '',
      publishedAt: '',
      publicationStatus: 'published',
      metaSourceRow: 88,
      metaGroupName: 'ชื่อเดิมของกลุ่ม',
      metaGroupKey: 'promoinsider',
      metaPublishedLabel: '15 ต.ค. เวลา 18:24',
    }),
    post({
      id: 'row-89',
      groupId: '',
      destinationId: undefined,
      facebookPostId: '',
      publishedAt: '',
      metaSourceRow: 89,
      metaGroupKey: 'promoinsider',
    }),
  ];
  assert.deepEqual(search(workspace, 'Meta row 88'), ['row-88']);
  assert.deepEqual(search(workspace, 'แถว Meta 89'), ['row-89']);
  assert.deepEqual(search(workspace, 'promoinsider'), ['row-88', 'row-89']);
  assert.deepEqual(search(workspace, 'ชื่อเดิมของกลุ่ม 18:24'), ['row-88']);
  assert.deepEqual(search(workspace, '2026'), []);
  assert.deepEqual(search(workspace, 'published'), []);
  assert.deepEqual(search(workspace, 'รอดำเนินการ'), ['row-88', 'row-89']);
  assert.deepEqual(search(workspace, 'https://facebook.com'), []);
});

test('visible platform, status, pin and known metrics are searchable; unknown counts stay unknown', () => {
  const workspace = fixture();
  workspace.posts[0].pinned = true;
  for (const query of [
    'Facebook published',
    'เผยแพร่แล้ว',
    'pinned',
    'ปักหมุด',
    'Viewers 1,234',
    'ผู้ชม 1234',
    'comments 0',
    'ความคิดเห็น 0',
  ])
    assert.deepEqual(search(workspace, query), ['record-one'], query);
  assert.deepEqual(search(workspace, 'Tea viewers'), []);
  assert.deepEqual(search(workspace, 'Tea comments'), []);
});

test('blank searches, missing relations, renamed catalogs, and Trash preserve records and ordering', () => {
  const workspace = fixture();
  workspace.posts.push(post({ id: 'trashed', deletedAt: '2026-10-29T00:00:00Z' }));
  assert.deepEqual(search(workspace, ''), ['record-one', 'other']);
  assert.deepEqual(search(workspace, '\n \u200b\t'), ['record-one', 'other']);
  const before = structuredClone(workspace);
  search(workspace, 'ESHAN');
  assert.deepEqual(workspace, before);
  workspace.products[0].name = 'Renamed jar';
  assert.deepEqual(search(workspace, 'Renamed'), ['record-one']);
  workspace.groups = [];
  workspace.destinations = undefined;
  workspace.products = [];
  assert.deepEqual(search(workspace, 'Original Honey'), ['record-one']);
  assert.deepEqual(search(workspace, 'no link'), ['record-one', 'other']);
});

test('supplied post and Meta datasets can all be found by their actual names, IDs, dates and source rows', () => {
  const initial = addProvidedProducts(createEmptyWorkspace());
  const preview = previewPostsCsv(providedSamplePostsCsv(), initial, 'vetra');
  assert.deepEqual(preview.errors, []);
  let workspace: Workspace = {
    ...initial,
    posts: preview.posts,
    groups: [...initial.groups, ...preview.groups],
  };
  workspace = addProvidedPostLinks(workspace);
  workspace = addProvidedMissingPosts(workspace);
  workspace = addProvidedMetaUnmatchedPosts(workspace);
  workspace = addProvidedMetaRemaining(workspace);
  workspace = validateWorkspace(applyProvidedMetaUpdate(workspace).workspace);
  const before = structuredClone(workspace);
  const index = buildPostSearchIndex(workspace);
  const groups = new Map(workspace.groups.map((group) => [group.id, group]));
  for (const post of workspace.posts) {
    if (post.publishedAt)
      assert.equal(
        createPostSearchMatcher(index, formatCalendarDate(reportingDate(post.publishedAt)))(post),
        true,
      );
    for (const query of [
      post.product,
      post.facebookPostId,
      post.metaGroupKey,
      post.metaGroupName,
      post.metaPublishedLabel,
      post.url,
      post.metaSourceRow ? `Meta row ${post.metaSourceRow}` : '',
      groups.get(post.groupId)?.name,
    ].filter((value): value is string => Boolean(value))) {
      assert.equal(createPostSearchMatcher(index, query)(post), true, `${post.id}: ${query}`);
    }
  }
  const matches = createPostSearchMatcher(index, 'ESHAN VETRA');
  const normal = workspace.posts.filter(
    (post) =>
      matchesPostStatusFilter(
        post,
        Boolean(publicPostUrl(post, groups.get(post.groupId)?.facebookId ?? '')),
        'normal',
      ) && matches(post),
  );
  assert.ok(normal.length > 0);
  assert.ok(normal.length < workspace.posts.length);
  assert.ok(normal.every((post) => post.publishedAt));
  assert.deepEqual(
    sortPosts(normal, 'recent', 'en', workspace).map((post) => post.id),
    sortPosts(normal, 'recent', 'th', workspace).map((post) => post.id),
  );
  assert.deepEqual(workspace, before);
});
