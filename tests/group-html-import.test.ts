import assert from 'node:assert/strict';
import test from 'node:test';
import { createEmptyWorkspace, validateWorkspace } from '../src/lib/data';
import { facebookGroupUrl } from '../src/lib/facebook-group-link';
import {
  applyGroupHtmlImport,
  MAX_GROUP_HTML_BYTES,
  previewGroupHtmlImport,
} from '../src/lib/group-html-import';
import type { Group, Post, Workspace } from '../src/lib/types';

const link = (key: string, name: string) =>
  `<a href="https://www.facebook.com/groups/${key}/">${name}</a>`;
const card = (key: string, name: string) => `<div role="listitem">
  <a href="https://www.facebook.com/groups/${key}/"><svg aria-label="${name}"></svg></a>
  ${link(key, name)}
  <a href="https://www.facebook.com/groups/${key}/" aria-label="ดูกลุ่ม"><span>ดูกลุ่ม</span></a>
</div>`;
const savedGroup = (overrides: Partial<Group> = {}): Group => ({
  id: 'existing',
  companyId: 'vetra',
  name: 'Old name',
  facebookId: '123',
  category: 'Custom category',
  notes: 'Preserve posting instructions',
  ...overrides,
});
function workspace(...groups: Group[]): Workspace {
  return { ...createEmptyWorkspace(), groups };
}
function aliasPost(groupId: string, url: string, overrides: Partial<Post> = {}): Post {
  return {
    id: 'post',
    companyId: 'vetra',
    groupId,
    product: '',
    platform: 'facebook',
    publishedAt: '',
    facebookPostId: '',
    url,
    viewers: null,
    color: '#000000',
    ...overrides,
  };
}

test('joined-group cards deduplicate their image, name and view links and preserve Thai and entities', () => {
  const source = `<div><h2>กลุ่มทั้งหมดที่คุณเข้าร่วม (2)</h2><div role="list">${card('123', 'กลุ่มกาแฟ &amp; เพื่อน &#x1F600;')}${card('Coffee.Club', 'Coffee &copy; Club')}<div role="listitem"></div></div></div>`;
  const before = workspace();
  const preview = previewGroupHtmlImport(source, before, 'vetra');
  assert.equal(preview.found, 2);
  assert.equal(preview.changes.length, 2);
  assert.deepEqual(preview.issues, []);
  assert.equal(preview.changes[0].name, 'กลุ่มกาแฟ & เพื่อน 😀');
  assert.equal(preview.changes[1].name, 'Coffee © Club');
  const result = validateWorkspace(applyGroupHtmlImport(before, preview));
  assert.equal(result.groups[0].facebookId, '123');
  assert.equal(result.groups[1].facebookId, '');
  assert.equal(facebookGroupUrl(result.groups[1]), 'https://www.facebook.com/groups/coffee.club/');
  assert.ok(result.groups.every((group) => group.category === '' && group.companyId === 'vetra'));
  assert.equal(result.destinations?.length, 2);
  assert.equal(before.groups.length, 0);
  assert.equal(applyGroupHtmlImport(result, preview), result);
});

test('only changed names update and custom group data, internal IDs, posts and unrelated groups stay intact', () => {
  const before = workspace(
    savedGroup(),
    savedGroup({ id: 'other', facebookId: '456', name: 'Keep' }),
  );
  before.posts = [aliasPost('existing', 'https://www.facebook.com/groups/123/posts/999/')];
  const original = structuredClone(before);
  const preview = previewGroupHtmlImport(
    card('123', 'New name') + card('456', 'Keep'),
    before,
    'vetra',
  );
  assert.deepEqual(preview.changes, [
    {
      kind: 'update',
      key: '123',
      name: 'New name',
      url: 'https://www.facebook.com/groups/123/',
      existingId: 'existing',
      previousName: 'Old name',
    },
  ]);
  assert.equal(preview.unchanged, 1);
  const after = applyGroupHtmlImport(before, preview);
  assert.deepEqual(before, original);
  assert.deepEqual(after.groups[0], { ...original.groups[0], name: 'New name' });
  assert.equal(after.groups[1], before.groups[1]);
  assert.equal(after.posts, before.posts);
  assert.equal(after.companies, before.companies);
  assert.equal(applyGroupHtmlImport(after, preview), after);
  assert.equal(previewGroupHtmlImport(card('123', 'New name'), after, 'vetra').changes.length, 0);
});

test('matching stays within the selected company and never matches names alone', () => {
  const before = workspace(savedGroup({ companyId: 'second', name: 'Shared name' }));
  before.companies.push({ ...before.companies[0], id: 'second', name: 'Second company' });
  const preview = previewGroupHtmlImport(
    card('123', 'Shared name') + card('999', 'Shared name'),
    before,
    'vetra',
  );
  assert.deepEqual(
    preview.changes.map((change) => change.kind),
    ['add', 'add'],
  );
  const after = applyGroupHtmlImport(before, preview);
  assert.equal(after.groups.length, 3);
  assert.equal(after.groups[0], before.groups[0]);
});

test('numeric ID, named notes and linked post aliases match one existing identity without changing IDs', () => {
  const before = workspace(
    savedGroup({ notes: 'Instructions\nhttps://www.facebook.com/groups/Coffee.Club/' }),
  );
  before.posts = [aliasPost('existing', 'https://www.facebook.com/groups/other-handle/posts/999/')];
  const preview = previewGroupHtmlImport(
    card('123', 'Updated') + card('coffee.club', 'Updated') + card('other-handle', 'Updated'),
    before,
    'vetra',
  );
  assert.equal(preview.found, 3);
  assert.equal(preview.changes.length, 1);
  assert.deepEqual(preview.issues, []);
  const after = applyGroupHtmlImport(before, preview);
  assert.deepEqual(after.groups, [{ ...before.groups[0], name: 'Updated' }]);
});

test('source aliases with different names do not choose an arbitrary winner', () => {
  const before = workspace(savedGroup({ notes: 'https://www.facebook.com/groups/club/' }));
  const preview = previewGroupHtmlImport(
    card('123', 'First') + card('club', 'Second'),
    before,
    'vetra',
  );
  assert.equal(preview.changes.length, 0);
  assert.equal(preview.issues.length, 2);
  assert.ok(preview.issues.every(({ reason }) => reason.includes('same saved group')));
});

test('different numeric group IDs in notes or linked posts cannot alias the saved numeric ID', () => {
  for (const source of ['notes', 'post']) {
    const before = workspace(
      savedGroup({
        notes:
          source === 'notes'
            ? 'Compare https://www.facebook.com/groups/999/'
            : 'Preserve posting instructions',
      }),
    );
    if (source === 'post')
      before.posts = [aliasPost('existing', 'https://www.facebook.com/groups/999/posts/555/')];
    const original = structuredClone(before);
    const preview = previewGroupHtmlImport(card('999', 'A different group'), before, 'vetra');
    assert.equal(preview.changes.length, 1);
    assert.equal(preview.changes[0].kind, 'add');
    assert.equal(preview.changes[0].key, '999');
    assert.deepEqual(preview.issues, []);
    const after = applyGroupHtmlImport(before, preview);
    assert.equal(after.groups.length, 2);
    assert.deepEqual(after.groups[0], original.groups[0]);
    assert.equal(after.groups[1].facebookId, '999');
    assert.equal(after.groups[1].name, 'A different group');
    assert.deepEqual(before, original);
  }
});

test('repeated captures are deduplicated, while conflicting source names need review', () => {
  const source =
    card('123', 'First') + card('123', 'First') + card('456', 'Other') + card('456', 'Conflict');
  const preview = previewGroupHtmlImport(source, workspace(), 'vetra');
  assert.equal(preview.found, 2);
  assert.equal(preview.changes.length, 1);
  assert.equal(preview.issues[0].reason, 'Conflicting group names were found for this link.');
});

test('a conflicting captured alias also blocks another link to the same saved group', () => {
  const before = workspace(savedGroup({ notes: 'https://www.facebook.com/groups/club/' }));
  const preview = previewGroupHtmlImport(
    card('123', 'First') + card('123', 'Conflict') + card('club', 'First'),
    before,
    'vetra',
  );
  assert.equal(preview.changes.length, 0);
  assert.equal(preview.issues.length, 2);
  assert.equal(applyGroupHtmlImport(before, preview), before);
});

test('matching Trash is skipped and duplicate active or mixed identities are ambiguous', () => {
  const trashed = savedGroup({ deletedAt: '2026-11-07T00:00:00.000Z' });
  const before = workspace(trashed);
  const preview = previewGroupHtmlImport(card('123', 'New'), before, 'vetra');
  assert.equal(preview.changes.length, 0);
  assert.equal(preview.issues[0].reason, 'This group is in Trash. Restore it before importing.');
  assert.equal(applyGroupHtmlImport(before, preview), before);
  for (const deletedAt of [undefined, trashed.deletedAt]) {
    const duplicate = workspace(savedGroup(), savedGroup({ id: 'duplicate', deletedAt }));
    const ambiguous = previewGroupHtmlImport(card('123', 'New'), duplicate, 'vetra');
    assert.equal(ambiguous.changes.length, 0);
    assert.equal(ambiguous.issues[0].reason, 'More than one saved group matches this link.');
  }
});

test('relative URLs, supported mobile hosts, single quotes and tracking parameters are accepted', () => {
  const source = `<a href='/groups/123/?ref=feed'> A <span>Thai</span> name </a>
  <a href="https://m.facebook.com/groups/456/?foo=a&amp;b=c">Mobile</a>
  <a href="//www.facebook.com/groups/club_name/">Named</a>`;
  const preview = previewGroupHtmlImport(source, workspace(), 'vetra');
  assert.deepEqual(
    preview.changes.map(({ key, name }) => [key, name]),
    [
      ['123', 'A Thai name'],
      ['456', 'Mobile'],
      ['club_name', 'Named'],
    ],
  );
});

test('unsafe or unrelated links and inactive HTML cannot contribute imported groups', () => {
  const ignored = [
    '<script>' + card('900', 'Script') + '</script>',
    '<style>' + card('901', 'Style') + '</style>',
    '<template>' + card('902', 'Template') + '</template>',
    '<noscript>' + card('903', 'Noscript') + '</noscript>',
    '<!--' + card('904', 'Comment') + '-->',
    '<div hidden>' + card('905', 'Hidden') + '</div>',
    '<div aria-hidden="true">' + card('906', 'Hidden') + '</div>',
    '<a href="javascript:alert(1)">JS</a>',
    '<a href="https://facebook.com.evil.test/groups/907/">Spoof</a>',
    '<a href="https://www.facebook.com@evil.test/groups/908/">Credentials</a>',
    '<a href="https://evil@www.facebook.com/groups/909/">Credentials</a>',
    '<a href="https://www.facebook.com:444/groups/910/">Port</a>',
    '<a href="https://www.facebook.com/groups/911/posts/123/">Post</a>',
    '<a href="https://www.facebook.com/groups/912/?multi_permalinks=456">Post</a>',
    '<a href="https://www.facebook.com/groups/913/?story_fbid=456">Post</a>',
    '<a href="/groups/discover/">Discover</a>',
    '<a href="/groups/joins/">Your groups</a>',
    '<a href="/groups/' + '9'.repeat(41) + '/">Too long</a>',
  ].join('');
  const preview = previewGroupHtmlImport(ignored + card('123', 'Valid'), workspace(), 'vetra');
  assert.equal(preview.found, 1);
  assert.equal(preview.changes[0].name, 'Valid');
});

test('image-only and action-only groups are issues rather than invented titles; blank placeholders are ignored', () => {
  const source = `<div role="listitem"></div><a href="/groups/123/"><img alt="Do not infer"></a><a href="/groups/123/">View group</a>`;
  const preview = previewGroupHtmlImport(source, workspace(), 'vetra');
  assert.equal(preview.found, 1);
  assert.equal(preview.changes.length, 0);
  assert.equal(preview.issues[0].reason, 'No group name was found for this link.');
});

test('incomplete captured markup still parses a real title without executing event handlers', () => {
  const preview = previewGroupHtmlImport(
    '<div><a onclick="throw new Error()" href="/groups/123/">ไทย &amp; friends',
    workspace(),
    'vetra',
  );
  assert.equal(preview.changes[0].name, 'ไทย & friends');
});

test('invalid and oversized group names need review without truncation', () => {
  const preview = previewGroupHtmlImport(
    card('123', 'ก'.repeat(201)) + card('456', 'Name\u0007'),
    workspace(),
    'vetra',
  );
  assert.equal(preview.changes.length, 0);
  assert.deepEqual(
    preview.issues.map(({ reason }) => reason),
    [
      'Group name is longer than 200 characters.',
      'Group name contains unsupported control characters.',
    ],
  );
});

test('empty, unrelated and oversize sources and an invalid company are rejected', () => {
  const before = workspace();
  assert.throws(() => previewGroupHtmlImport('', before, 'vetra'), /Paste the Facebook/);
  assert.throws(
    () => previewGroupHtmlImport('<div>no groups</div>', before, 'vetra'),
    /No Facebook/,
  );
  assert.throws(
    () => previewGroupHtmlImport(card('123', 'Name'), before, 'all'),
    /Choose an existing company/,
  );
  assert.throws(
    () => previewGroupHtmlImport('x'.repeat(MAX_GROUP_HTML_BYTES + 1), before, 'vetra'),
    /too large/,
  );
  assert.throws(
    () =>
      previewGroupHtmlImport('ก'.repeat(Math.floor(MAX_GROUP_HTML_BYTES / 3) + 1), before, 'vetra'),
    /too large/,
  );
});

test('group count and catalog capacity limits do not erase existing data or prevent safe updates', () => {
  const source = Array.from({ length: 10001 }, (_, i) => link(String(i + 1), 'Group')).join('');
  assert.throws(() => previewGroupHtmlImport(source, workspace(), 'vetra'), /too many groups/);
  const before = workspace(
    ...Array.from({ length: 10000 }, (_, i) =>
      savedGroup({ id: `g-${i}`, facebookId: String(i + 1) }),
    ),
  );
  const preview = previewGroupHtmlImport(
    card('1', 'Changed') + card('10001', 'New'),
    before,
    'vetra',
  );
  assert.equal(preview.changes.length, 1);
  assert.equal(preview.changes[0].kind, 'update');
  assert.equal(preview.issues[0].reason, 'Group catalog is full (10,000 maximum).');
  const after = applyGroupHtmlImport(before, preview);
  assert.equal(after.groups.length, 10000);
  assert.equal(after.groups[0].name, 'Changed');
});

test('applying a stale preview rejects changed names, changed identity, deleted or removed groups', () => {
  const before = workspace(savedGroup());
  const preview = previewGroupHtmlImport(card('123', 'Reviewed'), before, 'vetra');
  for (const groups of [
    [savedGroup({ name: 'Concurrent edit' })],
    [savedGroup({ facebookId: '456' })],
    [savedGroup({ deletedAt: '2026-11-07T00:00:00.000Z' })],
    [],
  ])
    assert.throws(() => applyGroupHtmlImport({ ...before, groups }, preview), /preview is stale/);
});

test('applying stale additions rejects concurrent changes or Trash and rechecks remaining capacity', () => {
  const before = workspace();
  const preview = previewGroupHtmlImport(card('123', 'New'), before, 'vetra');
  assert.throws(() => applyGroupHtmlImport(workspace(savedGroup()), preview), /preview is stale/);
  assert.throws(
    () =>
      applyGroupHtmlImport(
        workspace(savedGroup({ name: 'New', deletedAt: '2026-11-07T00:00:00.000Z' })),
        preview,
      ),
    /preview is stale/,
  );
  const full = workspace(
    ...Array.from({ length: 10000 }, (_, i) =>
      savedGroup({ id: `g-${i}`, facebookId: String(i + 1000) }),
    ),
  );
  assert.throws(() => applyGroupHtmlImport(full, preview), /catalog is full/);
  assert.equal(full.groups.length, 10000);
});

test('apply rejects tampered URL, company or duplicate changes and preserves the original on failure', () => {
  const before = workspace();
  const preview = previewGroupHtmlImport(card('123', 'New'), before, 'vetra');
  assert.throws(
    () => applyGroupHtmlImport(before, { ...preview, companyId: 'missing' }),
    /existing company/,
  );
  assert.throws(
    () =>
      applyGroupHtmlImport(before, {
        ...preview,
        changes: [{ ...preview.changes[0], url: 'https://evil.test/groups/123/' }],
      }),
    /preview is stale/,
  );
  assert.throws(
    () =>
      applyGroupHtmlImport(before, {
        ...preview,
        changes: [...preview.changes, ...preview.changes],
      }),
    /preview is stale/,
  );
  assert.equal(before.groups.length, 0);
});
