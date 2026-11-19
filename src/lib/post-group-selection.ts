import { knownFacebookGroupHandleName, knownFacebookGroupName } from './facebook-group-directory';
import { facebookGroupKeyFromText } from './facebook-group-link';
import { normalizeFacebookGroupKey } from './facebook-post-url';
import type { Group } from './types';

const NUMERIC_GROUP_ID = /^\d{1,40}$/;

/** A handle is an alias stored in notes, never a replacement for a numeric Facebook ID. */
export function groupMatchesFacebookKey(group: Group, key: string): boolean {
  const normalized = normalizeFacebookGroupKey(key);
  if (!normalized) return false;
  if (NUMERIC_GROUP_ID.test(group.facebookId) && NUMERIC_GROUP_ID.test(normalized))
    return group.facebookId === normalized;
  return (
    (NUMERIC_GROUP_ID.test(group.facebookId) && group.facebookId === normalized) ||
    normalizeFacebookGroupKey(facebookGroupKeyFromText(group.notes)) === normalized
  );
}

export function groupFacebookKey(group: Group): string {
  return NUMERIC_GROUP_ID.test(group.facebookId)
    ? group.facebookId
    : normalizeFacebookGroupKey(facebookGroupKeyFromText(group.notes));
}

/** Resolve one company-scoped group without changing saved metadata or inventing a numeric ID. */
export function resolvePostGroupSelection(
  groups: Group[],
  companyId: string,
  key: string,
  pendingGroup: Group | null = null,
  newId: () => string = () => crypto.randomUUID(),
): Group | null {
  const normalized = normalizeFacebookGroupKey(key);
  if (!companyId.trim() || !normalized) return null;

  const matches = groups.filter(
    (group) =>
      !group.deletedAt &&
      group.companyId === companyId &&
      groupMatchesFacebookKey(group, normalized),
  );
  if (matches.length > 1) return null;
  if (matches.length === 1) {
    const match = matches[0];
    // A numeric URL in notes must not contradict the group's known numeric identity.
    if (NUMERIC_GROUP_ID.test(normalized) && match.facebookId && match.facebookId !== normalized)
      return null;
    return match;
  }

  if (
    pendingGroup &&
    !pendingGroup.deletedAt &&
    pendingGroup.companyId === companyId &&
    (!pendingGroup.facebookId || NUMERIC_GROUP_ID.test(pendingGroup.facebookId)) &&
    groupMatchesFacebookKey(pendingGroup, normalized) &&
    (!NUMERIC_GROUP_ID.test(normalized) ||
      !pendingGroup.facebookId ||
      pendingGroup.facebookId === normalized)
  )
    return pendingGroup;

  const numeric = NUMERIC_GROUP_ID.test(normalized);
  return {
    id: newId(),
    companyId,
    name:
      (numeric ? knownFacebookGroupName(normalized) : knownFacebookGroupHandleName(normalized)) ||
      `Facebook group ${normalized}`,
    facebookId: numeric ? normalized : '',
    category: '',
    notes: numeric ? '' : `https://www.facebook.com/groups/${normalized}/`,
  };
}
