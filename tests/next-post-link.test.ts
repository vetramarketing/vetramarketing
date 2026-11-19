import assert from 'node:assert/strict';
import test from 'node:test';
import { selectNextPostLink } from '../src/lib/next-post-link';
import type { DailyPostClicks } from '../src/lib/post-clicks';
import type { Group, Post } from '../src/lib/types';

const now = new Date('2026-11-08T05:00:00.000Z');
const day = '2026-11-08';
const group: Group = {
  id: 'group',
  companyId: 'company',
  name: 'Group',
  facebookId: '187964837981399',
  category: '',
  notes: '',
};
function post(id: string, overrides: Partial<Post> = {}): Post {
  return {
    id,
    companyId: 'company',
    groupId: group.id,
    product: id,
    platform: 'facebook',
    publishedAt: '2026-11-07T05:00:00.000Z',
    facebookPostId: '',
    url: `https://www.facebook.com/groups/designg/posts/${id}/`,
    viewers: null,
    color: '#263b4b',
    ...overrides,
  };
}
const clicks = (counts: Record<string, number> = {}): DailyPostClicks => ({ day, counts });

test('selects the lowest current-day count within the supplied visible order', () => {
  const posts = [post('first'), post('second'), post('third')];
  const result = selectNextPostLink(posts, [group], clicks({ first: 4, second: 1, third: 2 }), now);
  assert.strictEqual(result?.post, posts[1]);
  assert.equal(result?.url, posts[1].url);
});

test('equal lowest counts keep the first eligible post in the current sort order', () => {
  const posts = [post('high'), post('z-last-alphabetically'), post('a-first-alphabetically')];
  const counts = clicks({ high: 3, 'z-last-alphabetically': 1, 'a-first-alphabetically': 1 });
  assert.strictEqual(selectNextPostLink(posts, [group], counts, now)?.post, posts[1]);
  const reversed = [...posts].reverse();
  assert.strictEqual(selectNextPostLink(reversed, [group], counts, now)?.post, reversed[0]);
});

test('missing counts are zero and tie with explicit zero counts', () => {
  const posts = [post('visited'), post('missing'), post('zero')];
  assert.strictEqual(
    selectNextPostLink(posts, [group], clicks({ visited: 1, zero: 0 }), now)?.post,
    posts[1],
  );
});

test('all missing, all zero, or equal positive counts select the first eligible row', () => {
  const posts = [post('first'), post('second'), post('third')];
  const cases: Record<string, number>[] = [
    {},
    { first: 0, second: 0, third: 0 },
    { first: 5, second: 5, third: 5 },
  ];
  for (const counts of cases) {
    assert.strictEqual(selectNextPostLink(posts, [group], clicks(counts), now)?.post, posts[0]);
  }
});

test('only supplied filtered posts are candidates and excluded click counts are not read', () => {
  const visible = [post('visible-second'), post('visible-first')];
  const counts = { 'visible-second': 2, 'visible-first': 2 };
  Object.defineProperty(counts, 'filtered-out', {
    enumerable: true,
    get() {
      assert.fail('The selector must not inspect filtered-out click counts');
    },
  });
  assert.strictEqual(selectNextPostLink(visible, [group], clicks(counts), now)?.post, visible[0]);
});

test('a Bangkok day change resets selection without reading stale click counts', () => {
  const posts = [post('first'), post('second')];
  const yesterday = { day: '2026-11-07', counts: { first: 5, second: 1 } };
  assert.strictEqual(
    selectNextPostLink(posts, [group], yesterday, new Date('2026-11-07T16:59:59.999Z'))?.post,
    posts[1],
  );
  Object.defineProperty(yesterday, 'counts', {
    get() {
      assert.fail('Stale counters must not influence the new Bangkok day');
    },
  });
  assert.strictEqual(
    selectNextPostLink(posts, [group], yesterday, new Date('2026-11-07T17:00:00.000Z'))?.post,
    posts[0],
  );
});

test('future-day counters also do not apply to the current Bangkok day', () => {
  const posts = [post('first'), post('second')];
  assert.strictEqual(
    selectNextPostLink(posts, [group], { day: '2026-11-09', counts: { first: 5 } }, now)?.post,
    posts[0],
  );
});

test('trashed, missing-link, and unsafe-link posts are skipped before accessing their counters', () => {
  const unsafe = [
    '',
    ' ',
    'not a URL',
    'javascript:alert(1)',
    'http://facebook.com/post',
    'https://user:password@facebook.com/post',
    'https://facebook.com/post\n',
  ];
  const posts = unsafe.map((url, index) => post(`unsafe-${index}`, { url }));
  posts.push(post('trashed', { deletedAt: '2026-11-07T00:00:00.000Z' }), post('valid'));
  const counts: Record<string, number> = { valid: 20 };
  for (const item of posts.slice(0, -1))
    Object.defineProperty(counts, item.id, {
      get() {
        assert.fail('Ineligible rows must not enter count selection');
      },
    });
  assert.strictEqual(selectNextPostLink(posts, [group], clicks(counts), now)?.post, posts.at(-1));
});

test('resolves numeric group/post IDs with the same canonical fallback used by a row', () => {
  const item = post('fallback', { url: '', facebookPostId: '29158298537187977' });
  const result = selectNextPostLink([item], [group], clicks(), now);
  assert.strictEqual(result?.post, item);
  assert.equal(
    result?.url,
    'https://www.facebook.com/groups/187964837981399/posts/29158298537187977/',
  );
});

test('keeps an explicit handle URL and prefers it over numeric fallback', () => {
  const url = 'https://www.facebook.com/groups/designg/posts/1810899433450636/';
  const item = post('handle', { url, facebookPostId: '123' });
  assert.deepEqual(selectNextPostLink([item], [group], clicks(), now), { post: item, url });
});

test('an unsafe explicit URL cannot silently fall back to a different generated URL', () => {
  const item = post('unsafe', { url: 'javascript:alert(1)', facebookPostId: '123' });
  assert.equal(selectNextPostLink([item], [group], clicks(), now), null);
});

test('no eligible links returns null, including missing groups and invalid fallback IDs', () => {
  assert.equal(selectNextPostLink([], [group], clicks(), now), null);
  assert.equal(selectNextPostLink([post('empty', { url: '' })], [group], clicks(), now), null);
  assert.equal(
    selectNextPostLink(
      [post('missing-group', { url: '', facebookPostId: '123' })],
      [],
      clicks(),
      now,
    ),
    null,
  );
  assert.equal(
    selectNextPostLink(
      [post('bad-id', { url: '', facebookPostId: '1e20' })],
      [group],
      clicks(),
      now,
    ),
    null,
  );
});

test('active posts can retain usable links after the referenced group is trashed', () => {
  const item = post('active', { url: '', facebookPostId: '123' });
  const deletedGroup = { ...group, deletedAt: '2026-11-07T00:00:00.000Z' };
  assert.equal(
    selectNextPostLink([item], [deletedGroup], clicks(), now)?.url,
    'https://www.facebook.com/groups/187964837981399/posts/123/',
  );
});

test('an inherited property is not a saved count for a post', () => {
  const posts = [post('toString'), post('other')];
  assert.strictEqual(selectNextPostLink(posts, [group], clicks(), now)?.post, posts[0]);
});

test('selection leaves posts, groups, counters, and their order untouched', () => {
  const posts = [post('first'), post('second')];
  const groups = [group];
  const counters = clicks({ first: 2, second: 1 });
  const before = structuredClone({ posts, groups, counters });
  posts.forEach(Object.freeze);
  groups.forEach(Object.freeze);
  Object.freeze(posts);
  Object.freeze(groups);
  Object.freeze(counters.counts);
  Object.freeze(counters);
  assert.strictEqual(selectNextPostLink(posts, groups, counters, now)?.post, posts[1]);
  assert.deepEqual({ posts, groups, counters }, before);
});
