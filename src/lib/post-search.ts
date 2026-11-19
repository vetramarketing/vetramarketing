import { formatCalendarDate } from './calendar';
import { normalizedPostUrl } from './post-identity';
import { postPublicationStatus, publicPostUrl } from './post-tools';
import type { Post, Workspace } from './types';

const metricFormatter = new Intl.NumberFormat('en-US');

/** Preserve Thai vowel/tone marks while accepting equivalent Unicode and pasted spacing. */
function normalize(value: string): string {
  return value
    .normalize('NFKC')
    .replace(/[\u200b\ufeff]/g, '')
    .toLowerCase()
    .replace(/\s+/g, ' ')
    .trim();
}

function publicationDateText(value: string): string {
  const timestamp = Date.parse(value);
  if (!Number.isFinite(timestamp)) return '';
  // Match the calendar date shown in the table, including posts near midnight ICT.
  const ict = new Date(timestamp + 7 * 60 * 60 * 1000).toISOString();
  return `${formatCalendarDate(ict.slice(0, 10))} ${ict.slice(0, 10)} ${ict.slice(11, 16)}`;
}

function metricText(value: number | null | undefined, en: string, th: string): string {
  return value == null ? '' : `${en} ${value} ${th} ${value} ${metricFormatter.format(value)}`;
}

/** Build once per workspace change, rather than resolving every relation on each keystroke. */
export function buildPostSearchIndex(workspace: Workspace): Map<string, string> {
  const companies = new Map(workspace.companies.map((item) => [item.id, item]));
  const products = new Map(workspace.products.map((item) => [item.id, item]));
  const groups = new Map(workspace.groups.map((item) => [item.id, item]));
  const destinations = new Map((workspace.destinations ?? []).map((item) => [item.id, item]));
  const index = new Map<string, string>();

  for (const post of workspace.posts) {
    if (post.deletedAt) continue;
    const group = groups.get(post.groupId);
    const destination = destinations.get(post.destinationId ?? '');
    const url = publicPostUrl(post, group?.facebookId ?? '');
    const status = postPublicationStatus(post);
    index.set(
      post.id,
      normalize(
        [
          post.product,
          products.get(post.productId ?? '')?.name,
          companies.get(post.companyId)?.name,
          group?.name,
          group?.facebookId,
          destination?.name,
          destination?.externalId,
          destination?.kind === 'group' || (!destination && group)
            ? 'group กลุ่ม'
            : destination?.kind === 'page' ||
                (!destination &&
                  post.platform === 'facebook' &&
                  post.metaSourceRow &&
                  !post.metaGroupKey)
              ? 'page เพจ'
              : destination?.kind === 'account'
                ? 'account บัญชี'
                : '',
          post.metaGroupName,
          post.metaGroupKey,
          post.facebookPostId,
          post.id,
          post.url,
          url,
          url ? normalizedPostUrl(url) : '',
          post.platform,
          status === 'pending' ? 'pending รอดำเนินการ' : 'published เผยแพร่แล้ว',
          !url ? 'no link ไม่มีลิงก์' : '',
          post.pinned ? 'pinned ปักหมุด' : '',
          publicationDateText(post.publishedAt),
          post.metaPublishedLabel,
          post.metaSourceRow == null
            ? ''
            : `Meta row ${post.metaSourceRow} แถว Meta ${post.metaSourceRow}`,
          metricText(post.viewers, 'viewers', 'ผู้ชม'),
          metricText(post.commentCount, 'comments', 'ความคิดเห็น'),
        ]
          .filter((value): value is string => typeof value === 'string' && value.length > 0)
          .join('\n'),
      ),
    );
  }
  return index;
}

/** Every word must match, but words may appear in different fields and in any order. */
export function createPostSearchMatcher(
  index: ReadonlyMap<string, string>,
  query: string,
): (post: Post) => boolean {
  const terms = normalize(query)
    .split(' ')
    .filter(Boolean)
    .map((term) =>
      /^https?:\/\//.test(term) ? [term, normalize(normalizedPostUrl(term))] : [term],
    );
  return (post) => {
    if (post.deletedAt) return false;
    if (!terms.length) return true;
    const document = index.get(post.id);
    return (
      document !== undefined &&
      terms.every((variants) => variants.some((term) => document.includes(term)))
    );
  };
}
