import type { Destination, Platform } from './types';

type InferredDestination = Pick<Destination, 'platform' | 'kind' | 'externalId' | 'name'>;

/** A permalink does not always reveal its publisher. Return nothing when it does not. */
export function inferPublishingDestination(
  platform: Platform,
  input: string,
): InferredDestination | null {
  try {
    const url = new URL(input);
    if (url.protocol !== 'https:' || url.username || url.password) return null;
    const host = url.hostname.toLowerCase().replace(/^(?:www|m|web)\./, '');
    if (platform === 'facebook' && host === 'facebook.com') {
      const story = /^\/(?:story|permalink)\.php$/.test(url.pathname);
      if (story) {
        const id = url.searchParams.get('id');
        const postId = url.searchParams.get('story_fbid');
        if (id && postId && /^\d{1,40}$/.test(id) && /^\d{1,40}$/.test(postId))
          return { platform, kind: 'page', externalId: id, name: `Facebook page ${id}` };
      }
      const match = /^\/([A-Za-z0-9._-]{2,80})\/(?:posts|videos)\/(\d{1,40})(?:\/|$)/.exec(
        url.pathname,
      );
      if (match && !['groups', 'share', 'watch', 'reel'].includes(match[1].toLowerCase()))
        return { platform, kind: 'page', externalId: match[1].toLowerCase(), name: match[1] };
    }
    if (platform === 'tiktok' && host === 'tiktok.com') {
      const match = /^\/@([A-Za-z0-9._]{2,80})\/video\/\d+(?:\/|$)/.exec(url.pathname);
      if (match)
        return {
          platform,
          kind: 'account',
          externalId: match[1].toLowerCase(),
          name: `@${match[1]}`,
        };
    }
    if (platform === 'linkedin' && host === 'linkedin.com') {
      const match = /^\/(company|in)\/([A-Za-z0-9-]{2,80})\/(?:posts|recent-activity)(?:\/|$)/.exec(
        url.pathname,
      );
      if (match)
        return {
          platform,
          kind: 'account',
          externalId: `${match[1]}:${match[2].toLowerCase()}`,
          name: match[2],
        };
    }
  } catch {
    // Invalid URLs are rejected by the post validator with a clearer message.
  }
  return null;
}

/** Stable across browser migrations and future server imports. */
export function inferredDestinationId(companyId: string, destination: InferredDestination): string {
  const value = `${companyId}|${destination.platform}|${destination.kind}|${destination.externalId}`;
  let hash = 0xcbf29ce484222325n;
  for (const byte of new TextEncoder().encode(value)) {
    hash ^= BigInt(byte);
    hash = BigInt.asUintN(64, hash * 0x100000001b3n);
  }
  return `destination-${hash.toString(16).padStart(16, '0')}`;
}
