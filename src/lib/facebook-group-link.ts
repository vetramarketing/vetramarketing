import type { Group } from './types';

/** Named group links stay in notes when Facebook did not supply a numeric ID. */
export function facebookGroupKeyFromText(text: string): string {
  return (
    text.match(
      /(?:^|\s)https:\/\/(?:www\.)?facebook\.com\/groups\/([A-Za-z0-9._-]{1,80})(?=[/?#\s]|$)/i,
    )?.[1] ?? ''
  );
}

export function facebookGroupUrl(group: Pick<Group, 'facebookId' | 'notes'>): string {
  const key = /^\d{1,40}$/.test(group.facebookId)
    ? group.facebookId
    : facebookGroupKeyFromText(group.notes);
  return key ? `https://www.facebook.com/groups/${key}/` : '';
}
