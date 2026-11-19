import type { Company } from './types';

/** Shared limits for catalog forms, backup validation, and the future API. */
export const MAX_SORT_ORDER = 1_000_000;

export function validSortOrder(value: unknown): value is number {
  return (
    typeof value === 'number' &&
    Number.isSafeInteger(value) &&
    value >= 0 &&
    value <= MAX_SORT_ORDER
  );
}

/** Stable tie-breaks keep the same order in every browser and database query. */
export function sortCatalog<T extends { id: string; sortOrder: number }>(items: readonly T[]): T[] {
  return [...items].sort(
    (a, b) => a.sortOrder - b.sortOrder || (a.id < b.id ? -1 : a.id > b.id ? 1 : 0),
  );
}

export function nextSortOrder(items: readonly { sortOrder: number }[]): number {
  return Math.min(
    MAX_SORT_ORDER,
    items.reduce((max, item) => Math.max(max, item.sortOrder), -1) + 1,
  );
}

/** Move one company in the complete catalog and save a stable, gap-free display order. */
export function reorderCompanies(
  companies: readonly Company[],
  draggedId: string,
  targetId: string,
): Company[] {
  const ordered = sortCatalog(companies);
  const from = ordered.findIndex((store) => store.id === draggedId);
  const to = ordered.findIndex((store) => store.id === targetId);
  if (from < 0 || to < 0 || from === to) return ordered;

  const [dragged] = ordered.splice(from, 1);
  ordered.splice(to, 0, dragged);
  return ordered.map((store, index) =>
    store.sortOrder === index ? store : { ...store, sortOrder: index },
  );
}
