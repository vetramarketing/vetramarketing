import assert from 'node:assert/strict';
import test from 'node:test';
import {
  bangkokToday,
  millisecondsUntilTomorrow,
  POST_CLICKS_KEY,
  readDailyPostClicks,
  recordPostClick,
  resetDailyPostClicks,
  sameDailyPostClicks,
} from '../src/lib/post-clicks';

test('click refresh keeps unchanged snapshots but detects midnight and counter changes', () => {
  const first = { day: '2026-10-29', counts: { a: 0, b: 2 } };
  const before = structuredClone(first);
  assert.equal(sameDailyPostClicks(first, { day: first.day, counts: { b: 2, a: 0 } }), true);
  assert.equal(sameDailyPostClicks(first, { day: '2026-10-30', counts: first.counts }), false);
  assert.equal(sameDailyPostClicks(first, { day: first.day, counts: { a: 0, b: 3 } }), false);
  assert.equal(sameDailyPostClicks(first, { day: first.day, counts: { a: 0 } }), false);
  assert.equal(sameDailyPostClicks(first, { day: first.day, counts: { a: 0, c: 2 } }), false);
  assert.deepEqual(first, before);
});

function storage() {
  const values = new Map<string, string>();
  return {
    getItem: (key: string) => values.get(key) ?? null,
    setItem: (key: string, value: string) => {
      values.set(key, value);
    },
  };
}

test('each post has an independent daily click count stored in local storage', () => {
  const local = storage();
  const now = new Date('2026-10-17T08:00:00.000Z');
  assert.deepEqual(readDailyPostClicks(local, '2026-10-17'), { day: '2026-10-17', counts: {} });
  assert.equal(recordPostClick(local, 'post-a', now).counts['post-a'], 1);
  assert.equal(recordPostClick(local, 'post-a', now).counts['post-a'], 2);
  assert.equal(recordPostClick(local, 'post-b', now).counts['post-b'], 1);
  assert.deepEqual(JSON.parse(local.getItem(POST_CLICKS_KEY)!), {
    version: 1,
    day: '2026-10-17',
    counts: { 'post-a': 2, 'post-b': 1 },
  });
});

test('manual reset clears every post count, persists after reload, and preserves unrelated data', () => {
  const local = storage();
  const now = new Date('2026-10-17T08:00:00Z');
  local.setItem('vetra-marketing.workspace.v6', 'workspace unchanged');
  local.setItem('vetra-marketing.locale', 'th');
  recordPostClick(local, 'post-a', now);
  recordPostClick(local, 'post-b', now);
  const reset = resetDailyPostClicks(local, now);
  assert.deepEqual(reset, { day: '2026-10-17', counts: {} });
  assert.equal(Object.keys(readDailyPostClicks(local, reset.day).counts).length, 0);
  assert.equal(local.getItem('vetra-marketing.workspace.v6'), 'workspace unchanged');
  assert.equal(local.getItem('vetra-marketing.locale'), 'th');
  assert.equal(recordPostClick(local, 'post-a', now).counts['post-a'], 1);
});

test('manual reset uses the current Bangkok day and failed resets preserve saved counts', () => {
  const local = storage();
  recordPostClick(local, 'post-a', new Date('2026-10-17T16:59:59Z'));
  const original = local.getItem(POST_CLICKS_KEY);
  assert.throws(() =>
    resetDailyPostClicks({
      setItem: () => {
        throw new Error('Storage blocked');
      },
    }),
  );
  assert.equal(local.getItem(POST_CLICKS_KEY), original);
  assert.equal(resetDailyPostClicks(local, new Date('2026-10-17T17:00:00Z')).day, '2026-10-18');
});

test('counts reset at Bangkok midnight even when the UTC date is unchanged', () => {
  const local = storage();
  const before = new Date('2026-10-17T16:59:59.999Z');
  const after = new Date('2026-10-17T17:00:00.000Z');
  assert.equal(bangkokToday(before), '2026-10-17');
  assert.equal(bangkokToday(after), '2026-10-18');
  assert.equal(millisecondsUntilTomorrow(before), 1);
  assert.equal(recordPostClick(local, 'post-a', before).counts['post-a'], 1);
  assert.deepEqual(readDailyPostClicks(local, '2026-10-18'), { day: '2026-10-18', counts: {} });
  assert.equal(recordPostClick(local, 'post-a', after).counts['post-a'], 1);
  assert.equal(JSON.parse(local.getItem(POST_CLICKS_KEY)!).day, '2026-10-18');
});

test('invalid saved counts and failed writes preserve the previous record', () => {
  const local = storage();
  const raw = '{"version":1,"day":"2026-10-17","counts":{"post-a":-1}}';
  local.setItem(POST_CLICKS_KEY, raw);
  assert.throws(() => recordPostClick(local, 'post-a', new Date('2026-10-17T08:00:00Z')));
  assert.equal(local.getItem(POST_CLICKS_KEY), raw);

  const valid = '{"version":1,"day":"2026-10-17","counts":{"post-a":2}}';
  const failing = {
    getItem: () => valid,
    setItem: () => {
      throw new Error('quota');
    },
  };
  assert.throws(() => recordPostClick(failing, 'post-a', new Date('2026-10-17T08:00:00Z')));
  assert.equal(failing.getItem(), valid);
});
