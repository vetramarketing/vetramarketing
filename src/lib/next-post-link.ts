import { safePostUrl } from './data';
import { bangkokToday, type DailyPostClicks } from './post-clicks';
import { publicPostUrl } from './post-tools';
import type { Group, Post } from './types';

/** Choose within the supplied visible order; a tie keeps the first eligible row. */
export function selectNextPostLink(
  posts: readonly Post[],
  groups: readonly Group[],
  clicks: DailyPostClicks,
  now: Date = new Date(),
): { post: Post; url: string } | null {
  const groupIds = new Map(groups.map((group) => [group.id, group.facebookId]));
  const counts = clicks.day === bangkokToday(now) ? clicks.counts : undefined;
  let selected: { post: Post; url: string } | null = null;
  let lowestCount = Infinity;

  for (const post of posts) {
    if (post.deletedAt) continue;
    const url = publicPostUrl(post, groupIds.get(post.groupId) ?? '');
    if (!url || !safePostUrl(url)) continue;
    const count = counts && Object.hasOwn(counts, post.id) ? counts[post.id] : 0;
    if (count < lowestCount) {
      selected = { post, url };
      lowestCount = count;
    }
  }

  return selected;
}
