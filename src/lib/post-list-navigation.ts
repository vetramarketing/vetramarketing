import { isPostSort, type PostSort, type PostStatusFilter } from './post-tools';

const HISTORY_KEY = 'vetraPostList';
const platforms = new Set(['all', 'facebook', 'instagram', 'tiktok', 'linkedin']);
const statusFilters = new Set<PostStatusFilter>(['normal', 'pending', 'no-link', 'all']);

export interface PostListReturnState {
  companyId: string;
  productId: string;
  search: string;
  platform: string;
  statusFilter: PostStatusFilter;
  sort: PostSort;
  scrollX: number;
  scrollY: number;
  tableScrollLeft: number;
}

function record(value: unknown): value is Record<string, unknown> {
  return !!value && typeof value === 'object' && !Array.isArray(value);
}

/** Keep list state on its own browser-history entry, without replacing router state. */
export function withPostListReturnState(
  state: unknown,
  list: PostListReturnState,
): Record<string, unknown> {
  return { ...(record(state) ? state : {}), [HISTORY_KEY]: { version: 6, ...list } };
}

export function readPostListReturnState(
  state: unknown,
  { companyId: selectedCompanyId }: { companyId?: string } = {},
): PostListReturnState | null {
  if (!record(state) || !record(state[HISTORY_KEY])) return null;
  const list = state[HISTORY_KEY];
  const companyId = list.version === 6 ? list.companyId : (list.companyId ?? list.storeId);
  const sort = list.version !== 6 && list.sort === 'store' ? 'company' : list.sort;
  if (
    ![1, 2, 3, 4, 5, 6].includes(list.version as number) ||
    typeof companyId !== 'string' ||
    !companyId ||
    companyId.length > 100 ||
    (list.version !== 1 &&
      (typeof list.productId !== 'string' || !list.productId || list.productId.length > 100)) ||
    (list.version === 3 && typeof list.pendingOnly !== 'boolean') ||
    (list.version === 4 && typeof list.showPending !== 'boolean') ||
    ([5, 6].includes(list.version as number) &&
      !statusFilters.has(list.statusFilter as PostStatusFilter)) ||
    typeof list.search !== 'string' ||
    typeof list.platform !== 'string' ||
    !platforms.has(list.platform) ||
    !isPostSort(sort) ||
    ![list.scrollX, list.scrollY, list.tableScrollLeft].every(
      (value) => typeof value === 'number' && Number.isFinite(value) && value >= 0,
    )
  )
    return null;
  const productId = list.version === 1 ? 'all' : (list.productId as string);
  const scopeChanged = selectedCompanyId !== undefined && selectedCompanyId !== companyId;
  return {
    companyId: selectedCompanyId ?? companyId,
    productId: scopeChanged ? 'all' : productId,
    search: list.search,
    platform: list.platform,
    statusFilter: [5, 6].includes(list.version as number)
      ? (list.statusFilter as PostStatusFilter)
      : list.version === 4 && list.showPending
        ? 'all'
        : list.version === 3 && list.pendingOnly
          ? 'pending'
          : 'normal',
    sort,
    scrollX: scopeChanged ? 0 : (list.scrollX as number),
    scrollY: scopeChanged ? 0 : (list.scrollY as number),
    tableScrollLeft: scopeChanged ? 0 : (list.tableScrollLeft as number),
  };
}
