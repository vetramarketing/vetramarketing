import type { Locale, Post, Product } from './types';
import { canonicalPostUrl } from './data';
import { productCompanyIdMap } from './product-company';

const postSortOrder = {
  recent: ['date', 'descending'],
  'date-asc': ['date', 'ascending'],
  viewers: ['viewers', 'descending'],
  'viewers-asc': ['viewers', 'ascending'],
  'viewers-per-day': ['viewers-per-day', 'descending'],
  'viewers-per-day-asc': ['viewers-per-day', 'ascending'],
  comments: ['comments', 'descending'],
  'comments-asc': ['comments', 'ascending'],
  title: ['product', 'ascending'],
  'title-desc': ['product', 'descending'],
  group: ['destination', 'ascending'],
  'group-desc': ['destination', 'descending'],
  company: ['company', 'ascending'],
  'company-desc': ['company', 'descending'],
} as const;

export type PostSort = keyof typeof postSortOrder;

export const isPostSort = (value: unknown): value is PostSort =>
  typeof value === 'string' && Object.hasOwn(postSortOrder, value);

export type PostStatusFilter = 'normal' | 'pending' | 'no-link' | 'all';

/** A missing actual date keeps the record pending without changing its saved source details. */
export function postPublicationStatus(
  post: Pick<Post, 'publicationStatus' | 'publishedAt'>,
): 'published' | 'pending' {
  return !post.publishedAt || post.publicationStatus === 'pending' ? 'pending' : 'published';
}

/** Use the same link resolution for filtering and opening a row. */
export function publicPostUrl(
  post: Pick<Post, 'url' | 'facebookPostId'>,
  groupFacebookId: string,
): string {
  return post.url || canonicalPostUrl(groupFacebookId, post.facebookPostId);
}

export function matchesPostStatusFilter(
  post: Pick<Post, 'publicationStatus' | 'publishedAt'>,
  hasLink: boolean,
  filter: PostStatusFilter,
): boolean {
  const status = postPublicationStatus(post);
  switch (filter) {
    case 'normal':
      return status === 'published' && hasLink;
    case 'pending':
      return status === 'pending';
    case 'no-link':
      return !hasLink;
    case 'all':
      return true;
  }
}

/** Approximate daily average from the current total and elapsed time; no metric history is stored. */
export function averageViewersPerDay(
  post: Pick<Post, 'publishedAt' | 'viewers' | 'publicationStatus'>,
  now: Date = new Date(),
): number | null {
  if (post.viewers === null || postPublicationStatus(post) === 'pending') return null;
  const published = Date.parse(post.publishedAt);
  const elapsed = now.getTime() - published;
  if (!Number.isFinite(elapsed) || elapsed < 0) return null;
  return post.viewers / Math.max(1, elapsed / 86_400_000);
}

/** A platform without a named destination still has an unknown destination for sorting. */
export function namedPostDestination(
  post: Post,
  destinationName: string | undefined,
  groupName: string | undefined,
  facebookPageLabel: string,
): string {
  return (
    destinationName ||
    (post.platform === 'facebook' && groupName) ||
    post.metaGroupName ||
    (post.platform === 'facebook' && post.metaSourceRow && !post.metaGroupKey
      ? facebookPageLabel
      : '')
  );
}

/** Prefer stable catalog IDs; resolve old name-only posts within an unambiguous company. */
export function filterPostsByProduct(
  posts: readonly Post[],
  products: readonly Product[],
  productId: string,
  allPosts: readonly Post[] = posts,
): Post[] {
  if (productId === 'all') return [...posts];
  const selected = products.find((product) => product.id === productId && !product.deletedAt);
  if (!selected) return [];
  const selectedName = selected.name.trim();
  const sameName = products.filter(
    (product) => !product.deletedAt && product.name.trim() === selectedName,
  );
  const productCompanies = productCompanyIdMap(sameName, allPosts);
  const eligibleCompanyIds = new Set(productCompanies.get(selected.id));
  const ambiguousCompanyIds = new Set(
    sameName
      .filter((product) => product.id !== selected.id)
      .flatMap((product) => productCompanies.get(product.id) ?? []),
  );
  return posts.filter(
    (post) =>
      post.productId === productId ||
      (!post.productId &&
        post.product.trim() === selectedName &&
        eligibleCompanyIds.has(post.companyId) &&
        !ambiguousCompanyIds.has(post.companyId)),
  );
}

function postDate(post: Post): number | null {
  const value = post.publishedAt;
  const timestamp = value ? Date.parse(value) : NaN;
  return Number.isFinite(timestamp) ? timestamp : null;
}

function compareKnown(a: number | null, b: number | null, ascending = false): number {
  if (a === null) return b === null ? 0 : 1;
  if (b === null) return -1;
  return ascending ? a - b : b - a;
}

/** Sort a copy with pinned posts first, keeping unknown values last within each section. */
export function sortPosts(
  posts: readonly Post[],
  sort: PostSort,
  locale: Locale,
  catalog?: {
    groups: readonly { id: string; name: string }[];
    companies: readonly { id: string; name: string }[];
    destinations?: readonly { id: string; name: string }[];
    products?: readonly Pick<Product, 'id' | 'name' | 'deletedAt'>[];
  },
  now: Date = new Date(),
): Post[] {
  const collator = new Intl.Collator(locale, { numeric: true, sensitivity: 'base' });
  const [column, direction] = postSortOrder[sort];
  const ascending = direction === 'ascending';
  const namesById = (entries: readonly { id: string; name: string }[] = []) =>
    new Map(entries.map(({ id, name }) => [id, name.trim()]));
  const names = namesById(
    column === 'destination'
      ? catalog?.groups
      : column === 'product'
        ? catalog?.products?.filter((item) => !item.deletedAt)
        : column === 'company'
          ? catalog?.companies
          : [],
  );
  const destinationNames = namesById(column === 'destination' ? catalog?.destinations : []);
  const facebookPageLabel = locale === 'th' ? 'เพจ Facebook' : 'Facebook Page';
  const byName = column === 'product' || column === 'destination' || column === 'company';
  function name(post: Post) {
    if (column === 'product') return names.get(post.productId ?? '') || post.product.trim();
    if (column === 'company') return names.get(post.companyId) ?? '';
    return namedPostDestination(
      post,
      destinationNames.get(post.destinationId ?? ''),
      names.get(post.groupId),
      facebookPageLabel,
    ).trim();
  }
  return posts
    .map((post, index) => ({
      post,
      index,
      value:
        column === 'viewers'
          ? post.viewers
          : column === 'viewers-per-day'
            ? averageViewersPerDay(post, now)
            : column === 'comments'
              ? (post.commentCount ?? null)
              : column === 'date'
                ? postDate(post)
                : null,
      name: byName ? name(post) : '',
    }))
    .sort((a, b) => {
      if (Boolean(a.post.pinned) !== Boolean(b.post.pinned)) return a.post.pinned ? -1 : 1;
      const comparison = byName
        ? a.name && b.name
          ? ascending
            ? collator.compare(a.name, b.name)
            : collator.compare(b.name, a.name)
          : a.name
            ? -1
            : b.name
              ? 1
              : 0
        : compareKnown(a.value, b.value, ascending);
      return comparison || a.index - b.index;
    })
    .map(({ post }) => post);
}
