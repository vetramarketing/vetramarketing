import { reportingDate } from './data';

export const POST_CLICKS_KEY = 'vetra-marketing.post-clicks.v1';

type ClickStorage = Pick<Storage, 'getItem' | 'setItem'>;

export interface DailyPostClicks {
  day: string;
  counts: Record<string, number>;
}

/** Browser focus and visibility can both refresh the same unchanged counters. */
export function sameDailyPostClicks(first: DailyPostClicks, second: DailyPostClicks): boolean {
  if (first.day !== second.day) return false;
  const ids = Object.keys(first.counts);
  return (
    ids.length === Object.keys(second.counts).length &&
    ids.every((id) => Object.hasOwn(second.counts, id) && first.counts[id] === second.counts[id])
  );
}

export function bangkokToday(now: Date = new Date()): string {
  return reportingDate(now);
}

export function millisecondsUntilTomorrow(now: Date = new Date()): number {
  const day = bangkokToday(now);
  const nextMidnight = Date.parse(`${day}T00:00:00.000Z`) + 86_400_000 - 7 * 3_600_000;
  return Math.max(1, nextMidnight - now.getTime());
}

/** Counts are kept apart from the workspace and scoped to one Bangkok calendar day. */
export function readDailyPostClicks(
  storage: Pick<ClickStorage, 'getItem'>,
  day: string,
): DailyPostClicks {
  const raw = storage.getItem(POST_CLICKS_KEY);
  if (raw === null) return { day, counts: {} };

  let parsed: unknown;
  try {
    parsed = JSON.parse(raw);
  } catch {
    throw new Error('Saved post click counts could not be read.');
  }
  if (!parsed || typeof parsed !== 'object' || Array.isArray(parsed))
    throw new Error('Saved post click counts could not be read.');
  const record = parsed as Record<string, unknown>;
  if (record.version !== 1 || typeof record.day !== 'string')
    throw new Error('Saved post click counts could not be read.');
  if (record.day !== day) return { day, counts: {} };
  if (!record.counts || typeof record.counts !== 'object' || Array.isArray(record.counts))
    throw new Error('Saved post click counts could not be read.');

  const counts: Record<string, number> = Object.create(null);
  for (const [postId, value] of Object.entries(record.counts)) {
    if (!postId || !Number.isSafeInteger(value) || (value as number) < 0)
      throw new Error('Saved post click counts could not be read.');
    counts[postId] = value as number;
  }
  return { day, counts };
}

export function recordPostClick(
  storage: ClickStorage,
  postId: string,
  now: Date = new Date(),
): DailyPostClicks {
  if (!postId) throw new Error('A post ID is required to count a click.');
  const day = bangkokToday(now);
  const current = readDailyPostClicks(storage, day);
  const previous = current.counts[postId] ?? 0;
  if (previous >= Number.MAX_SAFE_INTEGER) throw new Error('The daily click count is too large.');
  const counts = { ...current.counts, [postId]: previous + 1 };
  storage.setItem(POST_CLICKS_KEY, JSON.stringify({ version: 1, day, counts }));
  return { day, counts };
}

/** Reset this browser's daily counters without touching workspace or preference data. */
export function resetDailyPostClicks(
  storage: Pick<ClickStorage, 'setItem'>,
  now: Date = new Date(),
): DailyPostClicks {
  const day = bangkokToday(now);
  const counts = {};
  storage.setItem(POST_CLICKS_KEY, JSON.stringify({ version: 1, day, counts }));
  return { day, counts };
}
