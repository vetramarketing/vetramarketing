import assert from 'node:assert/strict';
import test from 'node:test';
import {
  canonicalPostUrl,
  createEmptyWorkspace,
  createSampleWorkspace,
  latestViewers,
  pruneTrash,
  validateWorkspace,
} from '../src/lib/data';
import { exportPostsCsv, parseCsv, previewPostsCsv } from '../src/lib/csv';
import { postPublicationStatus } from '../src/lib/post-tools';
import type { Post, Workspace } from '../src/lib/types';

const now = new Date('2026-10-16T06:00:00.000Z');
const fixture = () => createSampleWorkspace(now);

test('sample workspace is valid, marked as sample, with no invented Facebook destinations', () => {
  const workspace = validateWorkspace(fixture());
  assert.equal(workspace.sample, true);
  assert.equal(workspace.companies.length, 3);
  assert.equal(workspace.posts.length, 12);
  assert.ok(workspace.groups.length >= 6);
  assert.ok(workspace.posts.every((post) => !post.url && !post.facebookPostId));
  assert.equal(validateWorkspace(createEmptyWorkspace()).sample, false);
});

test('Facebook IDs preserve all digits and reject unsafe or scientific notation IDs', () => {
  const groupId = '123456789012345678901234567890';
  const postId = '987654321098765432109876543210';
  assert.equal(
    canonicalPostUrl(groupId, postId),
    `https://www.facebook.com/groups/${groupId}/posts/${postId}/`,
  );
  for (const invalid of ['', '1e+21', '../123', '123/45', '-12', '1'.repeat(41)])
    assert.equal(canonicalPostUrl(invalid, postId), '');
});

test('latest Viewers uses the single stored total', () => {
  const post = fixture().posts[0];
  assert.equal(latestViewers({ ...post, viewers: 460 }), 460);
  assert.equal(latestViewers({ ...post, viewers: null }), 0);
});

test('trash restores group references within 30 days and expires without deleting its posts', () => {
  const workspace = fixture();
  workspace.groups[0].deletedAt = '2026-09-16T06:00:00.000Z';
  workspace.groups[1].deletedAt = '2026-09-16T06:00:00.001Z';
  workspace.posts[0].deletedAt = '2026-09-16T06:00:00.000Z';
  const pruned = pruneTrash(workspace, now);
  assert.ok(!pruned.groups.some((group) => group.id === 'g-living'));
  assert.ok(pruned.groups.some((group) => group.id === 'g-coffee'));
  assert.ok(!pruned.posts.some((post) => post.id === 'sample-1'));
  assert.equal(pruned.posts.find((post) => post.id === 'sample-2')?.groupId, '');
  assert.equal(workspace.posts[1].groupId, 'g-living');
  assert.doesNotThrow(() => validateWorkspace(pruned));
});

test('expired groups preserve derived permalinks for active and restorable posts', () => {
  const workspace = fixture();
  const group = workspace.groups.find((item) => item.id === 'g-living')!;
  group.facebookId = '123456789012345678901234';
  group.deletedAt = '2026-09-16T06:00:00.000Z';
  const activePost = workspace.posts.find((post) => post.id === 'sample-2')!;
  const trashedPost = workspace.posts.find((post) => post.id === 'sample-7')!;
  activePost.facebookPostId = '987654321098765432109876';
  trashedPost.facebookPostId = '567891234567891234567891';
  trashedPost.deletedAt = '2026-10-10T06:00:00.000Z';
  const explicitUrl = 'https://www.facebook.com/groups/123/posts/456/?ref=share';
  workspace.posts.push({ ...activePost, id: 'saved-url', url: explicitUrl });

  const pruned = pruneTrash(workspace, now);
  for (const original of [activePost, trashedPost]) {
    const retained = pruned.posts.find((post) => post.id === original.id)!;
    assert.equal(retained.groupId, '');
    assert.equal(retained.url, canonicalPostUrl(group.facebookId, original.facebookPostId));
    assert.equal(retained.deletedAt, original.deletedAt);
    assert.equal(original.groupId, group.id);
    assert.equal(original.url, '');
  }
  assert.equal(pruned.posts.find((post) => post.id === 'saved-url')?.url, explicitUrl);
  assert.ok(!pruned.groups.some((item) => item.id === group.id));
  assert.doesNotThrow(() => validateWorkspace(pruned));
});

test('workspace validation rejects invalid dates, unsafe links, duplicate IDs and broken relationships', () => {
  const mutations: ((workspace: Workspace) => void)[] = [
    (w) => {
      w.posts[0].url = 'http://example.com/post';
    },
    (w) => {
      w.posts[0].url = 'javascript:alert(1)';
    },
    (w) => {
      w.posts[0].url = 'https://user:password@example.com';
    },
    (w) => {
      w.posts[0].url = 'data:text/html,test';
    },
    (w) => {
      w.posts[0].publishedAt = '2026-02-31';
    },
    (w) => {
      w.posts[0].publishedAt = '2026-10-16T24:01:00Z';
    },
    (w) => {
      w.posts[0].color = 'red;display:none';
    },
    (w) => {
      w.posts[0].viewers = Number.MAX_SAFE_INTEGER + 1;
    },
    (w) => {
      w.posts[0].viewers = -1;
    },
    (w) => {
      w.posts[0].commentCount = -1;
    },
    (w) => {
      w.posts[0].commentCount = 1.5;
    },
    (w) => {
      w.posts[0].groupId = 'g-craft';
    },
    (w) => {
      w.posts[0].status = 'unknown' as Post['status'];
    },
    (w) => {
      w.posts[1].id = w.posts[0].id;
    },
  ];
  for (const mutate of mutations) {
    const workspace = fixture();
    mutate(workspace);
    assert.throws(() => validateWorkspace(workspace));
  }
});

test('unknown publication dates stay blank and are treated as pending; drafts are rejected', () => {
  const published = fixture();
  published.posts[0].publishedAt = '';
  const validated = validateWorkspace(published);
  assert.equal(validated.posts[0].publishedAt, '');
  assert.equal(postPublicationStatus(validated.posts[0]), 'pending');
  const draft = fixture();
  draft.posts[0].status = 'draft';
  assert.throws(() => validateWorkspace(draft), /published posts/);
});

test('an explicitly Pending post retains a known publication date and stays Pending', () => {
  const workspace = fixture();
  const originalDate = workspace.posts[0].publishedAt;
  workspace.posts[0].publicationStatus = 'pending';
  const validated = validateWorkspace(workspace);
  assert.equal(validated.posts[0].publishedAt, originalDate);
  assert.equal(postPublicationStatus(validated.posts[0]), 'pending');
  assert.equal(validated.posts[0].viewers, workspace.posts[0].viewers);
});

test('missing comment count is unknown; zero is a valid recorded count', () => {
  const workspace = fixture();
  delete workspace.posts[0].commentCount;
  assert.equal(validateWorkspace(workspace).posts[0].commentCount, null);
  workspace.posts[0].commentCount = 0;
  assert.equal(validateWorkspace(workspace).posts[0].commentCount, 0);
});

test('pin validation defaults older posts to unpinned and rejects non-boolean values', () => {
  const older = fixture();
  delete older.posts[0].pinned;
  assert.equal(validateWorkspace(older).posts[0].pinned, false);
  older.posts[0].pinned = true;
  assert.equal(validateWorkspace(older).posts[0].pinned, true);
  older.posts[0].pinned = 'true' as unknown as boolean;
  assert.throws(() => validateWorkspace(older), /pin/i);
});

test('CSV parser handles multiline content and escaped quotes; malformed files fail visibly', () => {
  assert.deepEqual(
    parseCsv('\uFEFFTitle,Content\r\n"A, title","Line one\n""quoted"" line two"\r\n'),
    [
      ['Title', 'Content'],
      ['A, title', 'Line one\n"quoted" line two'],
    ],
  );
  assert.throws(() => parseCsv('Title,Content\n"Unclosed,field'));
  assert.throws(() => parseCsv('Title,Content\n"title"bad,field'));
  assert.throws(() => parseCsv('Title,Content\nBad"quote,field'));
  assert.deepEqual(parseCsv('Title\tContent\nHello\tWorld'), [
    ['Title', 'Content'],
    ['Hello', 'World'],
  ]);
});

test('semicolon and tab imports ignore commas inside quoted headers', () => {
  for (const separator of [';', '\t']) {
    const workspace = createEmptyWorkspace();
    const csv = `Product${separator}URL${separator}"Internal, temporary, note"\nHoney${separator}https://example.com/published-post${separator}ignored`;
    const preview = previewPostsCsv(csv, workspace, 'vetra');

    assert.deepEqual(preview.errors, []);
    assert.equal(preview.posts.length, 1);
    assert.equal(preview.posts[0].product, 'Honey');
    assert.equal(preview.posts[0].url, 'https://example.com/published-post');
    assert.equal(workspace.posts.length, 0, 'preview does not change saved data');
  }
});

test('CSV name matching links products only within the imported company', () => {
  const workspace = fixture();
  workspace.posts = [];
  workspace.products = [
    { id: 'vetra-honey', name: 'Honey', imageUrl: '', companyIds: ['vetra'], sortOrder: 0 },
    { id: 'olive-honey', name: 'Honey', imageUrl: '', companyIds: ['olive'], sortOrder: 1 },
  ];
  const preview = previewPostsCsv(
    'Company ID,Product,Complete URL (auto)\nvetra,Honey,https://example.com/vetra-honey\nolive,Honey,https://example.com/olive-honey\nkin,Honey,https://example.com/kin-honey',
    workspace,
    'vetra',
  );
  assert.deepEqual(preview.errors, []);
  assert.deepEqual(
    preview.posts.map((post) => post.productId),
    ['vetra-honey', 'olive-honey', undefined],
  );
});

test('CSV company headers and legacy store aliases resolve the same company without changing source names', () => {
  const workspace = fixture();
  workspace.posts = [];
  const company = workspace.companies.find((item) => item.id === 'olive')!;
  const originalName = company.name;
  for (const header of ['Company ID', 'Store ID', 'รหัสบริษัท', 'รหัสร้านค้า']) {
    const preview = previewPostsCsv(
      `${header},Product,URL\n${company.id},Honey,https://example.com/header-id`,
      workspace,
      'vetra',
    );
    assert.deepEqual(preview.errors, [], header);
    assert.equal(preview.posts[0].companyId, company.id, header);
  }
  for (const header of [
    'Company',
    'Company name',
    'Store',
    'Store name',
    'ชื่อบริษัท',
    'ชื่อร้านค้า',
  ]) {
    const preview = previewPostsCsv(
      `${header},Product,URL\n${company.name},Honey,https://example.com/header-name`,
      workspace,
      'vetra',
    );
    assert.deepEqual(preview.errors, [], header);
    assert.equal(preview.posts[0].companyId, company.id, header);
  }
  assert.equal(company.name, originalName);
});

test('CSV imports can recognize a legacy product after an earlier explicit link', () => {
  const workspace = createEmptyWorkspace();
  workspace.products.push({ id: 'legacy-honey', name: 'Honey', imageUrl: '', sortOrder: 0 });
  const preview = previewPostsCsv(
    'Product,Product ID,Complete URL (auto)\nHoney,legacy-honey,https://example.com/first\nHoney,,https://example.com/second',
    workspace,
    'vetra',
  );
  assert.deepEqual(preview.errors, []);
  assert.deepEqual(
    preview.posts.map((post) => post.productId),
    ['legacy-honey', 'legacy-honey'],
  );
});

test('tracker import preserves long IDs, blank measurements, ICT dates and deduplicates URLs', () => {
  const workspace = createEmptyWorkspace();
  const text =
    '#,Facebook group,Viewers,Posted at (ICT),Group ID,Post ID,Complete URL (auto)\n1,Test community,,15/10/2026 14:30,123456789012345678901234,987654321098765432109876,\n2,Test community,50,15/10/2026 14:30,123456789012345678901234,987654321098765432109876,\n3,Second community,0,16/10/2569 10:00,456789123456789123456789,567891234567891234567891,';
  const result = previewPostsCsv(text, workspace, 'vetra');
  assert.deepEqual(result.errors, []);
  assert.equal(result.skipped, 1);
  assert.equal(result.posts.length, 2);
  assert.equal(result.groups.length, 2);
  assert.equal(result.posts[0].viewers, null);
  assert.equal(result.posts[1].viewers, 0);
  assert.equal(result.posts[0].publishedAt, '2026-10-15T07:30:00.000Z');
  assert.equal(result.posts[1].publishedAt, '2026-10-16T03:00:00.000Z');
  assert.equal(result.posts[0].facebookPostId, '987654321098765432109876');
  assert.equal(workspace.posts.length, 0);
  assert.equal(workspace.groups.length, 0);
  assert.doesNotThrow(() =>
    validateWorkspace({ ...workspace, posts: result.posts, groups: result.groups }),
  );
});

test('CSV import fills a missing group name from the supplied ID directory', () => {
  const result = previewPostsCsv(
    'Group ID,Post ID,Published at (ICT)\n878540877111439,1441014217530766,16/10/2026 10:00',
    createEmptyWorkspace(),
    'vetra',
  );
  assert.deepEqual(result.errors, []);
  assert.equal(result.groups[0]?.name, 'กลุ่มชาวลำลูกกา');
});

test('downloaded template aliases import correctly and keep only total Viewers', () => {
  const text =
    'title,content,product,platform,status,group,group_id,post_id,url,published_at,scheduled_at,viewers,measured_at\nA title,A caption,Product,facebook,published,Community,123456789012345678,987654321098765432,,2026-10-15 14:00,,250,2026-10-15';
  const result = previewPostsCsv(text, createEmptyWorkspace(), 'vetra');
  assert.deepEqual(result.errors, []);
  assert.equal(result.posts.length, 1);
  assert.equal(result.groups[0].name, 'Community');
  assert.equal(result.groups[0].facebookId, '123456789012345678');
  assert.equal(result.posts[0].facebookPostId, '987654321098765432');
  assert.equal(result.posts[0].publishedAt, '2026-10-15T07:00:00.000Z');
  assert.equal(result.posts[0].viewers, 250);
  const roundtrip = previewPostsCsv(
    exportPostsCsv({ ...createEmptyWorkspace(), posts: result.posts, groups: result.groups }),
    createEmptyWorkspace(),
    'vetra',
  );
  assert.deepEqual(roundtrip.errors, []);
  assert.equal(roundtrip.posts[0].viewers, result.posts[0].viewers);
});

test('Views and ambiguous Thai view totals never become Viewers', () => {
  for (const header of ['Views', 'ยอดเข้าชม']) {
    const result = previewPostsCsv(
      `title,content,published_at,url,${header}\nA post,Keep this caption,2026-10-15,https://example.com/post,999`,
      createEmptyWorkspace(),
      'vetra',
    );
    assert.equal(result.posts.length, 1);
    assert.equal('content' in result.posts[0], false);
    assert.equal(result.posts[0].viewers, null);
    assert.equal(result.errors.length, 1);
    assert.match(result.errors[0], /Import note:.*was not imported as Viewers/);
    assert.match(result.errors[0], /valid content rows can still be imported/);
  }
});

test('explicit English and Thai Viewers columns remain distinct from Views', () => {
  for (const header of ['Viewers', 'ผู้ชม', 'จำนวนผู้ชม']) {
    const result = previewPostsCsv(
      `title,status,published_at,url,measured_at,Views,${header}\nA post,published,2026-10-15,https://example.com/post,2026-10-15,999,250`,
      createEmptyWorkspace(),
      'vetra',
    );
    assert.deepEqual(result.errors, []);
    assert.equal(result.posts[0].viewers, 250);
  }
});

test('record ID aliases preserve identity while tracker row numbers stay separate', () => {
  const result = previewPostsCsv(
    'id,#,title,post_id,group_id,published_at\nfixture-post-1,42,A post,987654321098765432,123456789012345678,2026-10-15',
    createEmptyWorkspace(),
    'vetra',
  );
  assert.deepEqual(result.errors, []);
  assert.equal(result.posts[0].id, 'fixture-post-1');
  assert.equal(result.posts[0].facebookPostId, '987654321098765432');
});

test('CSV accepts unknown publication dates but rejects unlinked posts', () => {
  const text =
    'title,published_at,url,viewers\nNo publication,,https://example.com/one,\nNo link,2026-10-15,,50';
  const result = previewPostsCsv(text, createEmptyWorkspace(), 'vetra');
  assert.equal(result.posts.length, 1);
  assert.equal(result.posts[0].publishedAt, '');
  assert.equal(result.groups.length, 0);
  assert.equal(result.errors.length, 1);
  assert.match(result.errors[0], /HTTPS post URL or both Facebook Group ID and Post ID/);
});

test('older CSV files import as unpinned and invalid pin values are rejected', () => {
  const workspace = createEmptyWorkspace();
  const legacy = previewPostsCsv(
    'Record ID,Complete URL (auto)\nlegacy,https://example.com/post',
    workspace,
    'vetra',
  );
  assert.deepEqual(legacy.errors, []);
  assert.equal(legacy.posts[0].pinned, false);

  const invalid = previewPostsCsv(
    'Record ID,Complete URL (auto),Pinned\nbad,https://example.com/post,maybe',
    workspace,
    'vetra',
  );
  assert.equal(invalid.posts.length, 0);
  assert.equal(invalid.errors.length, 1);
  assert.match(invalid.errors[0], /pinned/i);
});

test('CSV exports omit removed fields and preserve IDs and current Viewers through re-import', () => {
  const workspace = fixture();
  workspace.posts = [workspace.posts[0]];
  workspace.posts[0].pinned = true;
  workspace.posts[0].title = '=HYPERLINK("https://example.com")';
  workspace.posts[0].content = '\'A note\nWith, commas and "quotes".';
  workspace.groups.find((group) => group.id === workspace.posts[0].groupId)!.facebookId =
    '123456789012345678901234';
  workspace.posts[0].facebookPostId = '987654321098765432109876';
  const csv = exportPostsCsv(workspace);
  const headers = parseCsv(csv)[0];
  assert.ok(headers.includes('Company ID'));
  assert.ok(headers.includes('Company'));
  assert.ok(!headers.includes('Store ID'));
  assert.ok(!headers.includes('Store'));
  assert.ok(headers.includes('Published at (ICT)'));
  assert.ok(headers.includes('Pinned'));
  for (const removed of [
    'Title',
    'Content',
    'Status',
    'Scheduled at (ICT)',
    'Measured at (ICT)',
    'Viewers/day',
    'Metrics JSON',
  ])
    assert.ok(!headers.includes(removed), `${removed} leaked into CSV`);
  assert.ok(!csv.includes('HYPERLINK'));
  assert.ok(!csv.includes('A note'));
  assert.ok(!csv.includes('Scheduled at'));
  assert.ok(!csv.includes('"Status"'));
  assert.ok(csv.includes('"\'123456789012345678901234"'));
  const target = { ...workspace, posts: [], groups: [] };
  const preview = previewPostsCsv(csv, target, 'vetra');
  assert.deepEqual(preview.errors, []);
  assert.equal(preview.posts.length, 1);
  assert.equal(preview.posts[0].product, workspace.posts[0].product);
  assert.equal('content' in preview.posts[0], false);
  assert.equal(preview.posts[0].publishedAt, workspace.posts[0].publishedAt);
  assert.equal(preview.posts[0].viewers, workspace.posts[0].viewers);
  assert.equal(preview.posts[0].pinned, true);
  assert.equal(preview.posts[0].facebookPostId, workspace.posts[0].facebookPostId);
  const repeated = previewPostsCsv(
    csv,
    { ...target, posts: preview.posts, groups: preview.groups },
    'vetra',
  );
  assert.equal(repeated.skipped, 1);
});

test('CSV round trip keeps distinct Meta rows with no post link and their publication states', () => {
  const workspace = createEmptyWorkspace();
  workspace.groups.push({
    id: 'group-meta',
    companyId: 'vetra',
    name: 'Example group',
    facebookId: '123456789',
    category: '',
    notes: '',
  });
  const common = {
    companyId: 'vetra',
    groupId: 'group-meta',
    destinationId: 'group-meta',
    product: '',
    platform: 'facebook' as const,
    publishedAt: '',
    facebookPostId: '',
    url: '',
    viewers: 1,
    metaGroupName: 'Example group',
    metaGroupKey: '123456789',
    color: '#263b4b',
  };
  workspace.posts.push(
    {
      ...common,
      id: 'meta-row-86',
      publicationStatus: 'pending',
      metaSourceRow: 86,
    },
    {
      ...common,
      id: 'meta-row-88',
      publicationStatus: 'published',
      metaSourceRow: 88,
      metaPublishedLabel: '15 ต.ค. เวลา 18:24',
    },
  );

  const csv = exportPostsCsv(workspace);
  const preview = previewPostsCsv(csv, createEmptyWorkspace(), 'vetra');
  assert.deepEqual(preview.errors, []);
  assert.equal(preview.posts.length, 2);
  assert.deepEqual(
    preview.posts.map((post) => [
      post.id,
      post.publicationStatus ?? 'published',
      post.metaSourceRow,
      post.metaPublishedLabel ?? '',
      post.metaGroupKey,
    ]),
    [
      ['meta-row-86', 'pending', 86, '', '123456789'],
      ['meta-row-88', 'pending', 88, '15 ต.ค. เวลา 18:24', '123456789'],
    ],
  );
  assert.equal(workspace.posts[1].publicationStatus, 'published');
  const repeated = previewPostsCsv(
    csv,
    { ...createEmptyWorkspace(), groups: preview.groups, posts: preview.posts },
    'vetra',
  );
  assert.equal(repeated.skipped, 2);
});

test('new Pending group and Page records without links survive CSV round trip', () => {
  const workspace = createEmptyWorkspace();
  workspace.groups.push({
    id: 'pending-group',
    companyId: 'vetra',
    name: 'Pending community',
    facebookId: '123456789',
    category: '',
    notes: '',
  });
  for (const [id, groupId] of [
    ['pending-group-post', 'pending-group'],
    ['pending-page-post', ''],
  ]) {
    workspace.posts.push({
      id,
      companyId: 'vetra',
      groupId,
      product: 'Awaiting approval',
      platform: 'facebook',
      publicationStatus: 'pending',
      publishedAt: '',
      facebookPostId: '',
      url: '',
      viewers: null,
      color: '#263b4b',
    });
  }

  const csv = exportPostsCsv(workspace);
  const preview = previewPostsCsv(csv, createEmptyWorkspace(), 'vetra');
  assert.deepEqual(preview.errors, []);
  assert.deepEqual(
    preview.posts.map(({ id, publicationStatus, publishedAt, url, viewers }) => ({
      id,
      publicationStatus,
      publishedAt,
      url,
      viewers,
    })),
    workspace.posts.map(({ id, publicationStatus, publishedAt, url, viewers }) => ({
      id,
      publicationStatus,
      publishedAt,
      url,
      viewers,
    })),
  );
  assert.equal(preview.posts[1].groupId, '');
  const restored = {
    ...createEmptyWorkspace(),
    groups: preview.groups,
    posts: preview.posts,
  };
  assert.equal(validateWorkspace(restored).posts.length, 2);
  assert.equal(previewPostsCsv(csv, restored, 'vetra').skipped, 2);
});

test('CSV round trip keeps a known publication date on an explicitly Pending post', () => {
  const workspace = createEmptyWorkspace();
  workspace.posts.push({
    id: 'dated-pending',
    companyId: 'vetra',
    groupId: '',
    product: 'QA',
    platform: 'facebook',
    publicationStatus: 'pending',
    publishedAt: '2026-10-15T07:20:00.000Z',
    facebookPostId: '',
    url: 'https://example.com/post',
    viewers: null,
    color: '#263b4b',
  });
  const preview = previewPostsCsv(exportPostsCsv(workspace), createEmptyWorkspace(), 'vetra');
  assert.deepEqual(preview.errors, []);
  assert.equal(preview.posts[0].publicationStatus, 'pending');
  assert.equal(preview.posts[0].publishedAt, workspace.posts[0].publishedAt);
});

test('CSV export includes published records only, including when older data still has drafts', () => {
  const workspace = fixture();
  const exported = parseCsv(exportPostsCsv(workspace));
  const recordIndex = exported[0].indexOf('Record ID');
  const actualIds = exported.slice(1).map((row) => row[recordIndex]);
  const expectedIds = workspace.posts.filter((post) => post.publishedAt).map((post) => post.id);
  assert.deepEqual(actualIds, expectedIds);
});

test('CSV rejects invalid IDs, mismatched URL IDs, unsafe URLs, invalid viewers and dates without creating groups', () => {
  const workspace = createEmptyWorkspace();
  const text =
    'Facebook group,Group ID,Post ID,Complete URL (auto),Viewers,Posted at (ICT)\nA,1e+21,234,,,\nB,123,234,javascript:alert(1),,\nC,123,234,https://www.facebook.com/groups/123/posts/999/,,\nD,123,234,,1.5,\nE,123,234,,50,31/02/2026';
  const result = previewPostsCsv(text, workspace, 'vetra');
  assert.equal(result.posts.length, 0);
  assert.equal(result.groups.length, 0);
  assert.equal(result.errors.length, 5);
});

test('existing and incoming Facebook URL variants deduplicate', () => {
  const workspace = fixture();
  workspace.posts = [workspace.posts[0]];
  workspace.posts[0].url = 'https://m.facebook.com/groups/123/permalink/456/?ref=share';
  const result = previewPostsCsv(
    'Title,Published at (ICT),Complete URL (auto)\nA,2026-10-15,https://www.facebook.com/groups/123/posts/456/',
    workspace,
    'vetra',
  );
  assert.equal(result.skipped, 1);
  assert.equal(result.posts.length, 0);
});
