import { validDate, validateWorkspace } from './data';
import { resolveFacebookGroupName } from './facebook-group-directory';
import { createDefaultBusinessTypes } from './customer-data';
import { migrateCustomerOrderQuantities } from './customer-orders';
import { serializeOrder } from './orders';
import type { PublishedPost, Workspace } from './types';

// Separate keys keep already-open older clients from stripping collections they do not know.
export const WORKSPACE_KEY = 'vetra-marketing.workspace.v12';
export const V11_WORKSPACE_KEY = 'vetra-marketing.workspace.v11';
export const V10_WORKSPACE_KEY = 'vetra-marketing.workspace.v10';
export const V9_WORKSPACE_KEY = 'vetra-marketing.workspace.v9';
export const V8_WORKSPACE_KEY = 'vetra-marketing.workspace.v8';
export const V7_WORKSPACE_KEY = 'vetra-marketing.workspace.v7';
export const V6_WORKSPACE_KEY = 'vetra-marketing.workspace.v6';
export const PREVIOUS_WORKSPACE_KEY = 'vetra-marketing.workspace.v5';
export const OLDER_WORKSPACE_KEY = 'vetra-marketing.workspace.v4';
export const V3_WORKSPACE_KEY = 'vetra-marketing.workspace.v3';
export const V2_WORKSPACE_KEY = 'vetra-marketing.workspace.v2';
export const LEGACY_WORKSPACE_KEY = 'vetra-marketing.workspace.v1';
export const WORKSPACE_BACKUPS = [
  { key: V11_WORKSPACE_KEY, version: 'v11' },
  { key: V10_WORKSPACE_KEY, version: 'v10' },
  { key: V9_WORKSPACE_KEY, version: 'v9' },
  { key: V8_WORKSPACE_KEY, version: 'v8' },
  { key: V7_WORKSPACE_KEY, version: 'v7' },
  { key: V6_WORKSPACE_KEY, version: 'v6' },
  { key: PREVIOUS_WORKSPACE_KEY, version: 'v5' },
  { key: OLDER_WORKSPACE_KEY, version: 'v4' },
  { key: V3_WORKSPACE_KEY, version: 'v3' },
  { key: V2_WORKSPACE_KEY, version: 'v2' },
  { key: LEGACY_WORKSPACE_KEY, version: 'v1' },
];

type StoredPost = PublishedPost;
export type StoredWorkspaceV12 = Omit<Workspace, 'version' | 'posts' | 'scripts' | 'orders'> & {
  version: 12;
  posts: StoredPost[];
  scripts: NonNullable<Workspace['scripts']>;
  orders: ReturnType<typeof serializeOrder>[];
};

/** Older backups may contain dated measurements. Keep only their latest valid total. */
export function latestLegacyViewers(value: unknown): number | null {
  if (!Array.isArray(value) || value.length > 2000)
    throw new Error('Legacy post measurements are invalid.');
  const seen = new Set<number>();
  let latest: { date: number; viewers: number } | null = null;
  for (const raw of value) {
    if (!raw || typeof raw !== 'object') throw new Error('Legacy measurement is invalid.');
    const metric = raw as Record<string, unknown>;
    if (typeof metric.date !== 'string' || !validDate(metric.date))
      throw new Error('Legacy measurement date is invalid.');
    if (
      typeof metric.viewers !== 'number' ||
      !Number.isSafeInteger(metric.viewers) ||
      metric.viewers < 0
    )
      throw new Error('Legacy Viewers total is invalid.');
    const time = Date.parse(metric.date);
    if (seen.has(time)) throw new Error('Legacy measurements contain duplicate dates.');
    seen.add(time);
    if (!latest || time > latest.date) latest = { date: time, viewers: metric.viewers };
  }
  return latest?.viewers ?? null;
}

function untouchedBuiltInSample(post: {
  id?: unknown;
  url?: unknown;
  facebookPostId?: unknown;
}): boolean {
  return (
    typeof post.id === 'string' &&
    /^sample-(?:[1-9]|1[0-2])$/.test(post.id) &&
    !post.url &&
    !post.facebookPostId
  );
}

/** The active workspace contains published posts only. Older keys remain as recovery copies. */
export function serializeWorkspace(workspace: Workspace): StoredWorkspaceV12 {
  if (workspace.posts.some((post) => post.status !== undefined && post.status !== 'published'))
    throw new Error('Only published posts can be saved in this workspace.');
  const valid = migrateCustomerOrderQuantities(validateWorkspace(workspace), false);
  return {
    version: 12,
    sample: false,
    ...(valid.appliedDataUpdates ? { appliedDataUpdates: valid.appliedDataUpdates } : {}),
    companies: valid.companies,
    businessTypes: valid.businessTypes,
    customers: valid.customers,
    scripts: valid.scripts ?? [],
    orders: (valid.orders ?? []).map(serializeOrder),
    orderSequences: valid.orderSequences,
    shippingSettings: valid.shippingSettings,
    products: valid.products,
    groups: valid.groups,
    destinations: valid.destinations,
    posts: valid.posts.map((post) => ({
      id: post.id,
      companyId: post.companyId,
      groupId: post.groupId,
      product: post.product,
      ...(post.productId ? { productId: post.productId } : {}),
      ...(post.destinationId ? { destinationId: post.destinationId } : {}),
      platform: post.platform,
      publishedAt: post.publishedAt,
      ...(post.publicationStatus ? { publicationStatus: post.publicationStatus } : {}),
      ...(post.metaSourceRow === undefined ? {} : { metaSourceRow: post.metaSourceRow }),
      ...(post.metaGroupName ? { metaGroupName: post.metaGroupName } : {}),
      ...(post.metaGroupKey ? { metaGroupKey: post.metaGroupKey } : {}),
      ...(post.metaPublishedLabel ? { metaPublishedLabel: post.metaPublishedLabel } : {}),
      facebookPostId: post.facebookPostId,
      url: post.url,
      viewers: post.viewers,
      commentCount: post.commentCount ?? null,
      pinned: post.pinned === true,
      color: post.color,
      ...(post.deletedAt ? { deletedAt: post.deletedAt } : {}),
    })),
  };
}

function legacyAlias(item: Record<string, unknown>, current: string, legacy: string): unknown {
  if (
    item[current] !== undefined &&
    item[legacy] !== undefined &&
    JSON.stringify(item[current]) !== JSON.stringify(item[legacy])
  )
    throw new Error(`Conflicting ${current} and legacy ${legacy} values.`);
  return item[current] === undefined ? item[legacy] : item[current];
}

/** Keep old keys readable while every current save uses company identities. */
function migrateLegacyCompanies(raw: Record<string, unknown>): Record<string, unknown> {
  const companies = legacyAlias(raw, 'companies', 'stores');
  const { stores: _legacyCompanies, ...current } = raw;
  const records = (
    value: unknown,
    transform: (item: Record<string, unknown>) => Record<string, unknown>,
  ) =>
    Array.isArray(value)
      ? value.map((item) =>
          item && typeof item === 'object' && !Array.isArray(item)
            ? transform(item as Record<string, unknown>)
            : item,
        )
      : value;
  return {
    ...current,
    companies: records(companies, (company) => ({
      ...company,
      businessTypeId: company.businessTypeId === undefined ? 'retail' : company.businessTypeId,
    })),
    businessTypes:
      raw.businessTypes === undefined ? createDefaultBusinessTypes() : raw.businessTypes,
    customers: raw.customers === undefined ? [] : raw.customers,
    products: records(raw.products, (product) => {
      const companyIds = legacyAlias(product, 'companyIds', 'storeIds');
      const { storeIds: _legacyIds, ...currentProduct } = product;
      return { ...currentProduct, ...(companyIds === undefined ? {} : { companyIds }) };
    }),
    groups: records(raw.groups, (group) => {
      const companyId = legacyAlias(group, 'companyId', 'storeId');
      const { storeId: _legacyId, ...entry } = group;
      return { ...entry, companyId };
    }),
    destinations: records(raw.destinations, (destination) => {
      const companyId = legacyAlias(destination, 'companyId', 'storeId');
      const { storeId: _legacyId, ...entry } = destination;
      return { ...entry, companyId };
    }),
    posts: records(raw.posts, (post) => {
      const companyId = legacyAlias(post, 'companyId', 'storeId');
      const { storeId: _legacyId, ...entry } = post;
      return { ...entry, companyId };
    }),
  };
}

/** Restore supported backups without changing the bytes kept under older storage keys. */
export function deserializeWorkspace(input: unknown): Workspace {
  if (!input || typeof input !== 'object') throw new Error('Invalid workspace.');
  const source = input as Record<string, unknown>;
  const version = source.version;
  if (typeof version !== 'number' || !Number.isInteger(version) || version < 1 || version > 12)
    throw new Error('This workspace format is not supported.');
  const raw = version >= 8 ? source : migrateLegacyCompanies(source);
  if (
    version >= 8 &&
    (!Array.isArray(raw.companies) ||
      !Array.isArray(raw.businessTypes) ||
      !Array.isArray(raw.customers) ||
      raw.companies.some(
        (company) =>
          !company ||
          typeof company !== 'object' ||
          typeof (company as Record<string, unknown>).businessTypeId !== 'string',
      ))
  )
    throw new Error('This company workspace is missing required records.');
  if (version >= 9 && !Array.isArray(raw.scripts))
    throw new Error('This workspace is missing its scripts collection.');
  if (version >= 11 && !Array.isArray(raw.orders))
    throw new Error('This workspace is missing its orders collection.');
  if (raw.version === 1) {
    if (!Array.isArray(raw.posts)) throw new Error('Invalid legacy workspace.');
    return deserializeWorkspace({
      ...raw,
      version: 2,
      posts: raw.posts.filter(
        (post) =>
          post &&
          typeof post === 'object' &&
          (post as Record<string, unknown>).status === 'published' &&
          (post as Record<string, unknown>).publishedAt &&
          !(raw.sample === true && untouchedBuiltInSample(post as Record<string, unknown>)),
      ),
    });
  }
  if (!Array.isArray(raw.posts)) throw new Error('This workspace format is not supported.');
  const groupsById = new Map<unknown, Record<string, unknown>>();
  if (Array.isArray(raw.groups))
    for (const value of raw.groups) {
      if (!value || typeof value !== 'object') continue;
      const group = value as Record<string, unknown>;
      if (!groupsById.has(group.id)) groupsById.set(group.id, group);
    }
  // Product backfill belongs to older formats only. Keep ambiguous names
  // unassigned, and never scan the catalog for every current-format post.
  const legacyProductsByName = new Map<unknown, { id: unknown; count: number }>();
  if (version < 7 && Array.isArray(raw.products))
    for (const value of raw.products) {
      if (!value || typeof value !== 'object') continue;
      const product = value as Record<string, unknown>;
      const previous = legacyProductsByName.get(product.name);
      if (previous) previous.count += 1;
      else legacyProductsByName.set(product.name, { id: product.id, count: 1 });
    }
  const posts = raw.posts.flatMap((value) => {
    if (!value || typeof value !== 'object') throw new Error('Invalid post.');
    const post = value as Record<string, unknown>;
    if (raw.sample === true && untouchedBuiltInSample(post)) return [];
    // v2 normally has no stored status. Honor it when present rather than promoting a legacy draft.
    if (raw.version === 2 && post.status !== undefined && post.status !== 'published') return [];
    if (
      raw.version !== 2 &&
      ['title', 'content', 'status', 'scheduledAt'].some((key) => key in post)
    )
      throw new Error('This workspace contains removed post fields.');
    const publishedAt = post.publishedAt;
    if (raw.version !== 2 && (typeof publishedAt !== 'string' || (version < 6 && !publishedAt)))
      throw new Error('This workspace contains an unpublished post.');
    if (raw.version === 2 && !publishedAt) return [];
    if (version >= 4 && 'metrics' in post)
      throw new Error('This workspace contains removed Viewers history.');
    const group = groupsById.get(post.groupId);
    const label =
      typeof post.product === 'string' && post.product.trim()
        ? post.product.trim()
        : typeof group?.name === 'string' && group.name.trim()
          ? group.name.trim()
          : `${typeof post.platform === 'string' ? post.platform : 'Social'} post`;
    const matchingProduct = legacyProductsByName.get(post.product);
    const backfilledProductId = matchingProduct?.count === 1 ? matchingProduct.id : undefined;
    const { metrics: _oldMetrics, ...currentPost } = post;
    return [
      {
        ...currentPost,
        title: label,
        content: '',
        status: 'published',
        scheduledAt: '',
        ...(backfilledProductId ? { productId: backfilledProductId } : {}),
        viewers: version >= 4 ? post.viewers : latestLegacyViewers(post.metrics),
      },
    ];
  });
  // New catalog fields are defaulted only for older formats. A malformed v5/v6
  // backup must fail validation instead of silently losing catalog records.
  const companies =
    version >= 5 || !Array.isArray(raw.companies)
      ? raw.companies
      : raw.companies.map((value, index) => {
          if (!value || typeof value !== 'object') throw new Error('Invalid company.');
          return { ...value, logoImageUrl: '', ownerName: '', sortOrder: index };
        });
  const workspace = validateWorkspace({
    ...raw,
    companies,
    products: version >= 5 ? raw.products : [],
    version: 1,
    sample: false,
    posts,
  });
  return {
    ...migrateCustomerOrderQuantities(workspace, version < 11),
    groups: workspace.groups.map((group) => ({
      ...group,
      name: resolveFacebookGroupName(group.facebookId, group.name),
    })),
  };
}
