import assert from 'node:assert/strict';
import test from 'node:test';
import { createEmptyWorkspace } from '../src/lib/data';
import {
  applyMetaViewersUpdate,
  previewMetaViewersUpdate,
  type MetaUpdatePreview,
} from '../src/lib/meta-viewers-import';
import type { Post, Workspace } from '../src/lib/types';

const groupId = '878540877111439';
const facebookPostId = '1441014217530766';
const link = `https://www.facebook.com/groups/${groupId}/posts/${facebookPostId}/`;

function workspace(
  publishedAt = '2026-10-11T03:19:00.000Z',
  viewers: number | null = 10,
): Workspace {
  const empty = createEmptyWorkspace();
  const post: Post = {
    id: 'post-1',
    companyId: 'vetra',
    groupId: 'group-1',
    product: 'Honey',
    platform: 'facebook',
    publishedAt,
    facebookPostId,
    url: link,
    viewers,
    pinned: true,
    color: '#aabbcc',
  };
  return {
    ...empty,
    groups: [
      {
        id: 'group-1',
        companyId: 'vetra',
        name: 'กลุ่มชาวลำลูกกา',
        facebookId: groupId,
        category: '',
        notes: '',
      },
    ],
    posts: [post],
  };
}

function metaRow({
  name = 'กลุ่มชาวลำลูกกา',
  date = '11 ต.ค. เวลา 10:19',
  viewers = '12',
  comments = '',
  href = '',
  column = 5,
}: {
  name?: string;
  date?: string;
  viewers?: string;
  comments?: string;
  href?: string;
  column?: number;
} = {}): string {
  const cells = Array.from({ length: 14 }, (_, index) => {
    const number = index + 1;
    if (number === 2)
      return (
        `<td aria-colindex="2">${href ? `<a href="${href}">Post</a>` : ''}` +
        `<h2>Honey offer</h2><div><span>${name}&nbsp;•&nbsp;${date}</span></div></td>`
      );
    return `<td aria-colindex="${number === 5 ? column : number}">${number === 5 ? viewers : number === 9 ? comments : ''}</td>`;
  });
  return `<tr role="row">${cells.join('')}</tr>`;
}

test('matches a unique group name and known ICT publication minute, changing only Viewers', () => {
  const before = workspace();
  const copy = structuredClone(before);
  const preview = previewMetaViewersUpdate(
    `<tbody>${metaRow({ viewers: '1,234' })}</tbody>`,
    before,
  );
  assert.equal(preview.sourceRows, 1);
  assert.equal(preview.changes.length, 1);
  assert.equal(preview.changes[0].oldViewers, 10);
  assert.equal(preview.changes[0].newViewers, 1234);
  assert.equal(preview.changes[0].newPublishedAt, before.posts[0].publishedAt);
  assert.equal(preview.issues.length, 0);
  const result = applyMetaViewersUpdate(before, preview);
  assert.equal(result.posts[0].viewers, 1234);
  assert.equal(result.posts[0].pinned, true);
  assert.equal(result.posts[0].product, 'Honey');
  assert.deepEqual(before, copy);
});

test('a full HTML table ignores header rows and previews only post rows', () => {
  const preview = previewMetaViewersUpdate(
    `<table><thead><tr><th>Post</th><th>Viewers</th></tr></thead><tbody>${metaRow()}</tbody></table>`,
    workspace(),
  );
  assert.equal(preview.sourceRows, 1);
  assert.equal(preview.changes.length, 1);
  assert.equal(preview.issues.length, 0);
});

test('the source minute does not erase more precise saved publication seconds', () => {
  const before = workspace('2026-10-11T03:19:37.000Z');
  const preview = previewMetaViewersUpdate(`<tbody>${metaRow({ viewers: '12' })}</tbody>`, before, {
    publicationYear: 2026,
  });
  assert.equal(preview.changes.length, 1);
  assert.equal(preview.changes[0].newPublishedAt, '2026-10-11T03:19:37.000Z');
});

test('a supplied publication year disambiguates otherwise identical group dates and minutes', () => {
  const before = workspace();
  before.posts.push({
    ...before.posts[0],
    id: 'previous-year',
    facebookPostId: '222',
    url: `https://www.facebook.com/groups/${groupId}/posts/222/`,
    publishedAt: '2025-10-11T03:19:00.000Z',
  });
  const source = `<tbody>${metaRow({ viewers: '55' })}</tbody>`;
  assert.equal(previewMetaViewersUpdate(source, before).issues[0].kind, 'ambiguous');
  const preview = previewMetaViewersUpdate(source, before, { publicationYear: 2026 });
  assert.deepEqual(
    preview.changes.map((change) => change.postId),
    ['post-1'],
  );
  assert.equal(preview.issues.length, 0);
  assert.equal(
    previewMetaViewersUpdate(source, before, { publicationYear: 2027 }).issues[0].kind,
    'unmatched',
  );
  const wrongYearLink = previewMetaViewersUpdate(
    `<tbody>${metaRow({ href: before.posts[1].url })}</tbody>`,
    before,
    { publicationYear: 2026 },
  );
  assert.equal(wrongYearLink.changes.length, 0);
  assert.match(wrongYearLink.issues[0].reason, /Published date conflicts with the saved date/);
});

test('an exact group post link can match an unknown date, but only an explicit year fills it', () => {
  const before = workspace('', null);
  const html = `<tbody>${metaRow({ href: link, viewers: '80' })}</tbody>`;
  const noYear = previewMetaViewersUpdate(html, before);
  assert.equal(noYear.changes.length, 1);
  assert.equal(noYear.changes[0].newPublishedAt, '');
  assert.ok(noYear.warnings.some((warning) => warning.includes('publication year')));
  const withYear = previewMetaViewersUpdate(html, before, { publicationYear: 2026 });
  assert.equal(withYear.changes[0].newPublishedAt, '2026-10-11T03:19:00.000Z');
  assert.equal(
    applyMetaViewersUpdate(before, withYear).posts[0].publishedAt,
    '2026-10-11T03:19:00.000Z',
  );
});

test('a group label alone cannot match an unknown-date post or a Page row', () => {
  const before = workspace('');
  const html = `<tbody>${metaRow()}${metaRow({ name: 'เผยแพร่แล้ว' })}</tbody>`;
  const preview = previewMetaViewersUpdate(html, before, { publicationYear: 2026 });
  assert.equal(preview.changes.length, 0);
  assert.deepEqual(
    preview.issues.map((issue) => issue.kind),
    ['unmatched', 'unmatched'],
  );
});

test('an unknown capture date keeps relative “today” unresolved', () => {
  const before = workspace();
  const withoutLink = previewMetaViewersUpdate(
    `<tbody>${metaRow({ date: 'วันนี้ เวลา 10:19' })}</tbody>`,
    before,
    { capturedOn: null, publicationYear: 2026 },
  );
  assert.equal(withoutLink.changes.length, 0);
  assert.match(withoutLink.issues[0].reason, /capture date or assign a post link to this row/);
  assert.ok(withoutLink.warnings.some((warning) => warning.includes('today')));
  const withLink = previewMetaViewersUpdate(
    `<tbody>${metaRow({ date: 'วันนี้ เวลา 10:19', href: link })}</tbody>`,
    before,
    { capturedOn: null, publicationYear: 2026 },
  );
  assert.equal(withLink.changes.length, 1);
  assert.equal(withLink.changes[0].newPublishedAt, before.posts[0].publishedAt);
});

test('an unknown capture date keeps Thai “yesterday” unresolved', () => {
  const preview = previewMetaViewersUpdate(
    `<tbody>${metaRow({ date: 'เมื่อวานนี้ เวลา 10:19' })}</tbody>`,
    workspace(),
    { capturedOn: null, publicationYear: 2026 },
  );
  assert.equal(preview.changes.length, 0);
  assert.equal(preview.issues[0].kind, 'invalid');
  assert.match(preview.issues[0].reason, /Relative date/);
  assert.ok(preview.warnings.some((warning) => warning.includes('Relative dates')));
});

test('relative rows in the same group retain their times for manual assignment', () => {
  const html = `<tbody>${metaRow({ date: 'เมื่อวานนี้ เวลา 20:30', viewers: '55' })}${metaRow({ date: 'เมื่อวานนี้ เวลา 15:30', viewers: '1' })}</tbody>`;
  const preview = previewMetaViewersUpdate(html, workspace(), { capturedOn: null });
  assert.equal(preview.issues.length, 2);
  assert.match(preview.issues[0].label, /20:30/);
  assert.match(preview.issues[1].label, /15:30/);
  assert.deepEqual(
    preview.issues.map((issue) => issue.viewers),
    [55, 1],
  );
});

test('today and yesterday default to the current Bangkok calendar date at the ICT midnight boundary', (t) => {
  t.mock.timers.enable({ apis: ['Date'], now: new Date('2025-12-31T18:30:00.000Z') });
  // It is January 1 at 01:30 in Bangkok, while UTC is still December 31.
  const before = workspace('2025-12-31T17:19:37.000Z'); // January 1 at 00:19 ICT
  before.posts.push({
    ...before.posts[0],
    id: 'yesterday-post',
    facebookPostId: '222',
    url: `https://www.facebook.com/groups/${groupId}/posts/222/`,
    publishedAt: '2025-12-30T17:19:00.000Z', // December 31 at 00:19 ICT
  });
  const preview = previewMetaViewersUpdate(
    `<tbody>${metaRow({ date: 'today at 00:19', viewers: '55' })}${metaRow({ date: 'yesterday at 00:19', viewers: '18' })}</tbody>`,
    before,
  );
  assert.deepEqual(
    preview.changes.map((change) => change.postId),
    ['post-1', 'yesterday-post'],
  );
  assert.equal(preview.issues.length, 0);
  assert.deepEqual(
    applyMetaViewersUpdate(before, preview).posts.map((post) => post.viewers),
    [55, 18],
  );
});

test('a historical capture date overrides today while null opts out of date inference', (t) => {
  t.mock.timers.enable({ apis: ['Date'], now: new Date('2026-10-18T18:30:00.000Z') });
  const before = workspace('2026-10-12T03:19:00.000Z');
  const source = `<tbody>${metaRow({ date: 'วันนี้ เวลา 10:19', viewers: '55' })}</tbody>`;
  const live = previewMetaViewersUpdate(source, before);
  assert.equal(live.changes.length, 0);
  assert.equal(live.issues[0].kind, 'unmatched');

  const historical = previewMetaViewersUpdate(source, before, { capturedOn: '2026-10-12' });
  assert.deepEqual(
    historical.changes.map((change) => change.postId),
    ['post-1'],
  );
  assert.equal(historical.issues.length, 0);

  const unknown = previewMetaViewersUpdate(source, before, { capturedOn: null });
  assert.equal(unknown.changes.length, 0);
  assert.equal(unknown.issues[0].kind, 'invalid');
  assert.match(unknown.issues[0].reason, /capture date or assign a post link/);
});

test('a confirmed capture day matches today by group and exact ICT date and minute', () => {
  const before = workspace('2026-10-12T03:19:37.000Z');
  before.posts.push({
    ...before.posts[0],
    id: 'previous-day',
    facebookPostId: '222',
    url: `https://www.facebook.com/groups/${groupId}/posts/222/`,
    publishedAt: '2026-10-11T03:19:00.000Z',
  });
  before.posts.push({
    ...before.posts[0],
    id: 'previous-year',
    facebookPostId: '333',
    url: `https://www.facebook.com/groups/${groupId}/posts/333/`,
    publishedAt: '2025-10-12T03:19:00.000Z',
  });
  const preview = previewMetaViewersUpdate(
    `<tbody>${metaRow({ date: 'วันนี้ เวลา 10:19', viewers: '55' })}</tbody>`,
    before,
    { capturedOn: '2026-10-12' },
  );
  assert.deepEqual(
    preview.changes.map((change) => change.postId),
    ['post-1'],
  );
  assert.equal(preview.changes[0].newPublishedAt, '2026-10-12T03:19:37.000Z');
  assert.equal(preview.issues.length, 0);
  assert.equal(applyMetaViewersUpdate(before, preview).posts[0].viewers, 55);
});

test('yesterday resolves across the year boundary in Thai and English', () => {
  const before = workspace('2025-12-31T13:30:00.000Z'); // 20:30 ICT
  for (const date of ['เมื่อวานนี้ เวลา 20:30', 'yesterday at 20:30']) {
    const preview = previewMetaViewersUpdate(
      `<tbody>${metaRow({ date, viewers: '55' })}</tbody>`,
      before,
      { capturedOn: '2026-01-01', publicationYear: 2026 },
    );
    assert.deepEqual(
      preview.changes.map((change) => change.postId),
      ['post-1'],
    );
    assert.equal(preview.changes[0].newPublishedAt, before.posts[0].publishedAt);
    assert.equal(preview.issues.length, 0);
  }
});

test('English today and yesterday select separate posts in the same group', () => {
  const before = workspace('2026-10-12T03:19:00.000Z');
  before.posts.push({
    ...before.posts[0],
    id: 'previous-day',
    facebookPostId: '222',
    url: `https://www.facebook.com/groups/${groupId}/posts/222/`,
    publishedAt: '2026-10-11T03:19:00.000Z',
  });
  const preview = previewMetaViewersUpdate(
    `<tbody>${metaRow({ date: 'today at 10:19', viewers: '55' })}${metaRow({ date: 'yesterday at 10:19', viewers: '18' })}</tbody>`,
    before,
    { capturedOn: '2026-10-12' },
  );
  assert.deepEqual(
    preview.changes.map((change) => change.postId),
    ['post-1', 'previous-day'],
  );
  assert.equal(preview.issues.length, 0);
});

test('a wrong capture day never guesses a relative row match', () => {
  const before = workspace();
  const source = `<tbody>${metaRow({ date: 'เมื่อวานนี้ เวลา 10:19', viewers: '55' })}</tbody>`;
  const withoutLink = previewMetaViewersUpdate(source, before, { capturedOn: '2026-10-13' });
  assert.equal(withoutLink.changes.length, 0);
  assert.equal(withoutLink.issues[0].kind, 'unmatched');
  const withLink = previewMetaViewersUpdate(
    `<tbody>${metaRow({ date: 'เมื่อวานนี้ เวลา 10:19', viewers: '55', href: link })}</tbody>`,
    before,
    { capturedOn: '2026-10-13' },
  );
  assert.equal(withLink.changes.length, 0);
  assert.match(withLink.issues[0].reason, /Published date conflicts with the saved date/);
});

test('an exact link can fill a blank publication date from a confirmed relative day', () => {
  const before = workspace('', null);
  const preview = previewMetaViewersUpdate(
    `<tbody>${metaRow({ date: 'เมื่อวานนี้ เวลา 10:19', viewers: '55', href: link })}</tbody>`,
    before,
    { capturedOn: '2026-10-12' },
  );
  assert.equal(preview.changes[0].newPublishedAt, '2026-10-11T03:19:00.000Z');
  assert.equal(
    applyMetaViewersUpdate(before, preview).posts[0].publishedAt,
    '2026-10-11T03:19:00.000Z',
  );
});

test('two posts with the same exact relative publication minute remain ambiguous', () => {
  const before = workspace();
  before.posts.push({
    ...before.posts[0],
    id: 'second-post',
    facebookPostId: '222',
    url: `https://www.facebook.com/groups/${groupId}/posts/222/`,
  });
  const preview = previewMetaViewersUpdate(
    `<tbody>${metaRow({ date: 'เมื่อวานนี้ เวลา 10:19' })}</tbody>`,
    before,
    { capturedOn: '2026-10-12' },
  );
  assert.equal(preview.changes.length, 0);
  assert.equal(preview.issues[0].kind, 'ambiguous');
});

test('date-first matching rejects a conflicting known group ID but accepts a unique minute when a name is shared', () => {
  const source = `<tbody>${metaRow({ date: 'เมื่อวานนี้ เวลา 10:19' })}</tbody>`;
  const differentUrlGroup = workspace();
  differentUrlGroup.posts[0].url = `https://www.facebook.com/groups/999/posts/${facebookPostId}/`;
  const conflicting = previewMetaViewersUpdate(source, differentUrlGroup, {
    capturedOn: '2026-10-12',
  });
  assert.equal(conflicting.changes.length, 0);
  assert.equal(conflicting.issues[0].kind, 'invalid');
  assert.match(conflicting.issues[0].reason, /different known Facebook group/);

  const duplicateName = workspace();
  duplicateName.groups.push({
    ...duplicateName.groups[0],
    id: 'group-2',
    facebookId: '999',
  });
  const ambiguousGroup = previewMetaViewersUpdate(source, duplicateName, {
    capturedOn: '2026-10-12',
  });
  assert.deepEqual(
    ambiguousGroup.changes.map((change) => change.postId),
    ['post-1'],
  );
  assert.equal(ambiguousGroup.issues.length, 0);
});

test('a renamed group still matches its post by unique ICT publication minute', () => {
  const before = workspace();
  const source = `<tbody>${metaRow({ name: 'A newly renamed group', viewers: '41' })}</tbody>`;
  const preview = previewMetaViewersUpdate(source, before);
  assert.deepEqual(
    preview.changes.map((change) => change.postId),
    ['post-1'],
  );
  assert.equal(preview.issues.length, 0);
  const after = applyMetaViewersUpdate(before, preview);
  assert.equal(after.posts[0].viewers, 41);
  assert.equal(after.groups[0].name, before.groups[0].name);
});

test('a reviewed Meta row updates Comments, including a decrease to zero', () => {
  const before = workspace();
  before.posts[0].commentCount = 7;
  const preview = previewMetaViewersUpdate(
    `<tbody>${metaRow({ viewers: '10', comments: '0' })}</tbody>`,
    before,
  );
  assert.equal(preview.changes.length, 1);
  assert.equal(preview.changes[0].oldCommentCount, 7);
  assert.equal(preview.changes[0].newCommentCount, 0);
  assert.equal(preview.changes[0].oldViewers, preview.changes[0].newViewers);
  const after = applyMetaViewersUpdate(before, preview);
  assert.equal(after.posts[0].commentCount, 0);
  assert.equal(after.posts[0].viewers, 10);
  assert.throws(
    () =>
      applyMetaViewersUpdate(
        { ...before, posts: [{ ...before.posts[0], commentCount: 8 }] },
        preview,
      ),
    /changed since preview/,
  );
});

test('missing or invalid Comments source cells preserve the saved count', () => {
  const before = workspace();
  before.posts[0].commentCount = 7;
  for (const comments of ['', '—', '1.5']) {
    const preview = previewMetaViewersUpdate(
      `<tbody>${metaRow({ viewers: '12', comments })}</tbody>`,
      before,
    );
    assert.equal(preview.changes[0].newCommentCount, undefined);
    assert.equal(applyMetaViewersUpdate(before, preview).posts[0].commentCount, 7);
  }
  const noCommentHeader = previewMetaViewersUpdate(
    `<table><thead><tr><th aria-colindex="5">Viewers</th><th aria-colindex="9">Shares</th></tr></thead><tbody>${metaRow({ viewers: '12', comments: '99' })}</tbody></table>`,
    before,
  );
  assert.equal(noCommentHeader.changes[0].newCommentCount, undefined);
  assert.equal(applyMetaViewersUpdate(before, noCommentHeader).posts[0].commentCount, 7);
});

test('the named Thai Comments header permits exact count import from a full table', () => {
  const before = workspace();
  const html =
    '<table><thead><tr><th aria-colindex="5">ผู้ชม</th><th aria-colindex="9">ความคิดเห็น</th></tr></thead>' +
    `<tbody>${metaRow({ viewers: '10', comments: '1,234' })}</tbody></table>`;
  const preview = previewMetaViewersUpdate(html, before);
  assert.equal(preview.changes.length, 1);
  assert.equal(preview.changes[0].newCommentCount, 1234);
  assert.equal(applyMetaViewersUpdate(before, preview).posts[0].commentCount, 1234);
});

test('the exact link disambiguates a same-minute collision across groups', () => {
  const before = workspace();
  const otherGroupId = '999';
  const otherLink = `https://www.facebook.com/groups/${otherGroupId}/posts/222/`;
  before.groups.push({
    ...before.groups[0],
    id: 'group-2',
    name: 'Another group',
    facebookId: otherGroupId,
  });
  before.posts.push({
    ...before.posts[0],
    id: 'post-2',
    groupId: 'group-2',
    facebookPostId: '222',
    url: otherLink,
  });
  const source = `<tbody>${metaRow({ name: 'A renamed group', viewers: '50' })}</tbody>`;
  const ambiguous = previewMetaViewersUpdate(source, before);
  assert.equal(ambiguous.changes.length, 0);
  assert.equal(ambiguous.issues[0].kind, 'ambiguous');

  const linked = previewMetaViewersUpdate(
    `<tbody>${metaRow({ name: 'A renamed group', viewers: '50', href: otherLink })}</tbody>`,
    before,
  );
  assert.deepEqual(
    linked.changes.map((change) => change.postId),
    ['post-2'],
  );
  assert.equal(linked.issues.length, 0);
});

test('an explicit link cannot override the post uniquely identified by a different publication minute', () => {
  const before = workspace();
  const otherLink = `https://www.facebook.com/groups/${groupId}/posts/222/`;
  before.posts.push({
    ...before.posts[0],
    id: 'post-2',
    facebookPostId: '222',
    url: otherLink,
    publishedAt: '2026-10-11T03:20:00.000Z',
  });
  const preview = previewMetaViewersUpdate(
    `<tbody>${metaRow({ href: otherLink, viewers: '50' })}</tbody>`,
    before,
  );
  assert.equal(preview.changes.length, 0);
  assert.equal(preview.issues[0].kind, 'invalid');
  assert.match(preview.issues[0].reason, /Published date conflicts/);
});

test('capture dates and source dates must be valid and chronologically consistent', () => {
  const source = `<tbody>${metaRow({ href: link })}</tbody>`;
  for (const capturedOn of ['', '2026-2-03', '2026-02-30', '2026-00-12'])
    assert.throws(
      () => previewMetaViewersUpdate(source, workspace(), { capturedOn }),
      /valid YYYY-MM-DD date in Thailand time/,
    );
  assert.throws(
    () => previewMetaViewersUpdate(source, workspace(), { capturedOn: '2099-01-01' }),
    /cannot be in the future/,
  );
  const afterCapture = previewMetaViewersUpdate(
    `<tbody>${metaRow({ href: link, date: '11 ต.ค. 2026 เวลา 10:19' })}</tbody>`,
    workspace(),
    { capturedOn: '2026-10-10' },
  );
  assert.equal(afterCapture.changes.length, 0);
  assert.match(afterCapture.issues[0].reason, /after the Meta table capture date/);
});

test('a reviewed post link matches a relative-date row without inventing its calendar date', () => {
  const before = workspace('', null);
  const source = `<tbody>${metaRow({ date: 'เมื่อวานนี้ เวลา 10:19', viewers: '80' })}</tbody>`;
  const preview = previewMetaViewersUpdate(source, before, {
    capturedOn: null,
    publicationYear: 2026,
    rowPostLinks: { 1: `${link}?rdid=example#` },
  });
  assert.equal(preview.changes.length, 1);
  assert.equal(preview.changes[0].newViewers, 80);
  assert.equal(preview.changes[0].newPublishedAt, '');
  assert.equal(preview.issues.length, 0);
  assert.deepEqual(applyMetaViewersUpdate(before, preview).posts[0].viewers, 80);
});

test('reviewed links cannot swap two same-group relative-time rows', () => {
  const before = workspace('2026-10-11T13:30:00.000Z', null); // 20:30 ICT
  const secondLink = `https://www.facebook.com/groups/${groupId}/posts/222/`;
  before.posts.push({
    ...before.posts[0],
    id: 'post-2',
    facebookPostId: '222',
    url: secondLink,
    publishedAt: '2026-10-11T08:30:00.000Z', // 15:30 ICT
  });
  const source = `<tbody>${metaRow({ date: 'เมื่อวานนี้ เวลา 20:30', viewers: '55' })}${metaRow({ date: 'เมื่อวานนี้ เวลา 15:30', viewers: '1' })}</tbody>`;

  const correct = previewMetaViewersUpdate(source, before, {
    capturedOn: null,
    rowPostLinks: { 1: link, 2: secondLink },
  });
  assert.equal(correct.changes.length, 2);
  assert.equal(correct.issues.length, 0);
  assert.deepEqual(
    correct.changes.map((change) => change.newPublishedAt),
    before.posts.map((post) => post.publishedAt),
  );

  const swapped = previewMetaViewersUpdate(source, before, {
    capturedOn: null,
    rowPostLinks: { 1: secondLink, 2: link },
  });
  assert.equal(swapped.changes.length, 0);
  assert.deepEqual(
    swapped.issues.map((issue) => [issue.row, issue.kind]),
    [
      [1, 'invalid'],
      [2, 'invalid'],
    ],
  );
  assert.ok(swapped.issues.every((issue) => /Published date conflicts/.test(issue.reason)));
});

test('a reviewed link can identify a tracked post from its URL when its separate post ID is blank', () => {
  const before = workspace('', null);
  before.posts[0].facebookPostId = '';
  const preview = previewMetaViewersUpdate(
    `<tbody>${metaRow({ date: 'เมื่อวานนี้ เวลา 10:19', viewers: '80' })}</tbody>`,
    before,
    { capturedOn: null, rowPostLinks: { 1: link } },
  );
  assert.equal(preview.changes.length, 1);
  assert.equal(preview.changes[0].postId, 'post-1');
});

test('reviewed row links must be valid and refer to an existing one-based source row', () => {
  const source = `<tbody>${metaRow()}</tbody>`;
  const invalidMappings: unknown[] = [
    { 0: link },
    { 2: link },
    { '01': link },
    { 1: 'https://facebook.com/groups/878540877111439/' },
    { 1: 'https://example.com/groups/878540877111439/posts/1441014217530766/' },
  ];
  for (const rowPostLinks of invalidMappings) {
    assert.throws(() =>
      previewMetaViewersUpdate(source, workspace(), {
        rowPostLinks: rowPostLinks as Record<number, string>,
      }),
    );
  }
});

test('a reviewed link cannot contradict an exact source link or a known source group', () => {
  const wrongPost = `https://www.facebook.com/groups/${groupId}/posts/999/`;
  const sourceLink = previewMetaViewersUpdate(
    `<tbody>${metaRow({ href: link })}</tbody>`,
    workspace(),
    { rowPostLinks: { 1: wrongPost } },
  );
  assert.equal(sourceLink.changes.length, 0);
  assert.match(sourceLink.issues[0].reason, /conflicts with a link in the Meta row/);
  const knownGroup = previewMetaViewersUpdate(
    `<tbody>${metaRow({ name: 'เมนูอาหาร', date: 'เมื่อวานนี้ เวลา 10:19' })}</tbody>`,
    workspace(),
    { capturedOn: null, rowPostLinks: { 1: link } },
  );
  assert.equal(knownGroup.changes.length, 0);
  assert.match(knownGroup.issues[0].reason, /different known Facebook group/);
});

test('reviewed links keep pending, invalid Viewers, lower-total, and duplicate protections', () => {
  const before = workspace();
  const relative = (viewers: string) => metaRow({ date: 'เมื่อวานนี้ เวลา 10:19', viewers });
  const pending = previewMetaViewersUpdate(
    `<tbody>${metaRow({ date: 'รอดำเนินการ', viewers: '80' })}</tbody>`,
    before,
    { rowPostLinks: { 1: link } },
  );
  assert.equal(pending.changes.length, 0);
  assert.match(pending.issues[0].reason, /pending in Meta/);
  const invalid = previewMetaViewersUpdate(`<tbody>${relative('12.5')}</tbody>`, before, {
    capturedOn: null,
    rowPostLinks: { 1: link },
  });
  assert.equal(invalid.changes.length, 0);
  assert.equal(invalid.issues[0].viewers, null);
  const lower = previewMetaViewersUpdate(`<tbody>${relative('9')}</tbody>`, before, {
    capturedOn: null,
    rowPostLinks: { 1: link },
  });
  assert.equal(lower.changes.length, 0);
  assert.equal(lower.issues[0].viewers, 9);
  assert.match(lower.issues[0].reason, /lower/);
  const duplicate = previewMetaViewersUpdate(
    `<tbody>${relative('12')}${relative('13')}</tbody>`,
    before,
    {
      capturedOn: null,
      rowPostLinks: { 1: link, 2: link },
    },
  );
  assert.equal(duplicate.changes.length, 0);
  assert.deepEqual(
    duplicate.issues.map((issue) => issue.kind),
    ['duplicate', 'duplicate'],
  );
  assert.deepEqual(
    duplicate.issues.map((issue) => issue.viewers),
    [12, 13],
  );
});

test('pending Meta rows never update Viewers or make a valid duplicate look ambiguous', () => {
  const html = `<tbody>${metaRow({ date: 'รอดำเนินการ', href: link, viewers: '90' })}${metaRow({ viewers: '12', href: link })}</tbody>`;
  const preview = previewMetaViewersUpdate(html, workspace());
  assert.equal(preview.changes.length, 1);
  assert.equal(preview.changes[0].row, 2);
  assert.equal(preview.issues[0].row, 1);
  assert.equal(preview.issues[0].kind, 'invalid');
  assert.match(preview.issues[0].reason, /pending in Meta/);
  assert.ok(preview.warnings.some((warning) => warning.includes('Pending rows')));
});

test('a tracked pending record is excluded from matching and cannot accept a stale preview', () => {
  const before = workspace();
  const html = `<tbody>${metaRow({ href: link, viewers: '12' })}</tbody>`;
  const preview = previewMetaViewersUpdate(html, before);
  const pending: Workspace = {
    ...before,
    posts: [{ ...before.posts[0], publishedAt: '', publicationStatus: 'pending' }],
  };
  const pendingPreview = previewMetaViewersUpdate(html, pending);
  assert.equal(pendingPreview.changes.length, 0);
  assert.equal(pendingPreview.issues[0].kind, 'unmatched');
  assert.throws(() => applyMetaViewersUpdate(pending, preview), /changed since preview/);
});

test('multiple posts with the same group and minute are ambiguous', () => {
  const before = workspace();
  before.posts.push({
    ...before.posts[0],
    id: 'post-2',
    facebookPostId: '222',
    url: `https://www.facebook.com/groups/${groupId}/posts/222/`,
  });
  const preview = previewMetaViewersUpdate(`<tbody>${metaRow()}</tbody>`, before);
  assert.equal(preview.changes.length, 0);
  assert.equal(preview.issues[0].kind, 'ambiguous');
});

test('duplicate rows, lower totals, and conflicting dates never silently update', () => {
  const before = workspace();
  const duplicate = previewMetaViewersUpdate(`<tbody>${metaRow()}${metaRow()}</tbody>`, before);
  assert.equal(duplicate.changes.length, 0);
  assert.deepEqual(
    duplicate.issues.map((issue) => issue.kind),
    ['duplicate', 'duplicate'],
  );
  const conflictingDuplicate = previewMetaViewersUpdate(
    `<tbody>${metaRow({ viewers: '12' })}${metaRow({ viewers: '9' })}</tbody>`,
    before,
  );
  assert.equal(conflictingDuplicate.changes.length, 0);
  assert.deepEqual(
    conflictingDuplicate.issues.map((issue) => issue.kind),
    ['duplicate', 'duplicate'],
  );
  const lower = previewMetaViewersUpdate(`<tbody>${metaRow({ viewers: '9' })}</tbody>`, before);
  assert.equal(lower.changes.length, 0);
  assert.match(lower.issues[0].reason, /lower/);
  const conflictingDate = previewMetaViewersUpdate(
    `<tbody>${metaRow({ href: link, date: '12 ต.ค. เวลา 10:19' })}</tbody>`,
    before,
    { publicationYear: 2026 },
  );
  assert.equal(conflictingDate.changes.length, 0);
  assert.match(conflictingDate.issues[0].reason, /conflicts/);
});

test('invalid Viewers and changed data are rejected', () => {
  const before = workspace();
  const invalid = previewMetaViewersUpdate(
    `<tbody>${metaRow({ viewers: '12.5' })}</tbody>`,
    before,
  );
  assert.equal(invalid.changes.length, 0);
  assert.equal(invalid.issues[0].kind, 'invalid');
  const missingColumn = previewMetaViewersUpdate(
    `<tbody>${metaRow({ column: 6 })}</tbody>`,
    before,
  );
  assert.equal(missingColumn.issues[0].kind, 'invalid');
  const preview = previewMetaViewersUpdate(`<tbody>${metaRow()}</tbody>`, before);
  assert.throws(
    () =>
      applyMetaViewersUpdate({ ...before, posts: [{ ...before.posts[0], viewers: 11 }] }, preview),
    /changed since preview/,
  );
  assert.throws(() => previewMetaViewersUpdate('<p>not a table</p>', before), /No Meta table rows/);
  const future = previewMetaViewersUpdate(
    `<tbody>${metaRow({ href: link, date: '11 ต.ค. เวลา 10:19' })}</tbody>`,
    workspace('', 0),
    { publicationYear: 2099 },
  );
  assert.equal(future.changes.length, 0);
  assert.match(future.issues[0].reason, /future/);
});

test('HTML is treated as text and never rendered or executed', () => {
  const before = workspace();
  const html = `<tbody>${metaRow({ name: '<script>bad()</script>กลุ่มชาวลำลูกกา' })}</tbody>`;
  const preview = previewMetaViewersUpdate(html, before);
  assert.equal(preview.changes.length, 1);
  assert.equal(preview.changes[0].label, 'กลุ่มชาวลำลูกกา');
});

test('bulk Meta application validates every reviewed record before returning any changes', () => {
  const before = workspace();
  before.posts = Array.from({ length: 300 }, (_, index) => ({
    ...before.posts[0],
    id: `post-${index}`,
    facebookPostId: String(index + 1),
    url: `https://www.facebook.com/groups/${groupId}/posts/${index + 1}/`,
  }));
  const copy = structuredClone(before);
  const preview: MetaUpdatePreview = {
    sourceRows: 2,
    unchanged: [],
    issues: [],
    warnings: [],
    changes: [before.posts[0], before.posts[299]].map((post, index) => ({
      row: index + 1,
      label: 'Reviewed post',
      postId: post.id,
      oldViewers: post.viewers,
      newViewers: 12,
      oldCommentCount: null,
      newCommentCount: 0,
      oldPublishedAt: post.publishedAt,
      newPublishedAt: post.publishedAt,
    })),
  };
  const result = applyMetaViewersUpdate(before, preview);
  assert.equal(result.posts[0].viewers, 12);
  assert.equal(result.posts[299].commentCount, 0);
  assert.equal(result.posts[150], before.posts[150]);
  assert.deepEqual(
    result.posts.map((post) => post.id),
    before.posts.map((post) => post.id),
  );
  assert.deepEqual(before, copy);
  preview.changes[1].oldViewers = 9;
  assert.throws(() => applyMetaViewersUpdate(before, preview), /changed since preview/);
  assert.deepEqual(before, copy);
});
