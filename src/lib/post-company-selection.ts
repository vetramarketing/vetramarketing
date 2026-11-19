export const POST_COMPANY_SELECTION_KEY = 'vetra-marketing.posts.company.v1';

function validSelection(value: unknown): value is string {
  return typeof value === 'string' && value.trim().length > 0 && value.length <= 100;
}

/** A list preference stays separate from workspace records and defaults to All. */
export function readPostCompanySelection(storage: Pick<Storage, 'getItem'>): string {
  try {
    const value = storage.getItem(POST_COMPANY_SELECTION_KEY);
    return validSelection(value) ? value : 'all';
  } catch {
    return 'all';
  }
}

export function writePostCompanySelection(
  storage: Pick<Storage, 'setItem'>,
  companyId: string,
): boolean {
  if (!validSelection(companyId)) return false;
  try {
    storage.setItem(POST_COMPANY_SELECTION_KEY, companyId);
    return true;
  } catch {
    return false;
  }
}
