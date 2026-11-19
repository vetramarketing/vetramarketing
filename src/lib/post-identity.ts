import { canonicalPostUrl } from './data';
import { parseFacebookGroupPostLink } from './facebook-post-url';
import type { Post, Workspace } from './types';

export interface PostIdentityContext {
  groupFacebookIds: Map<string, string>;
  destinations: Map<string, NonNullable<Workspace['destinations']>[number]>;
}

export function buildPostIdentityContext(
  workspace: Pick<Workspace, 'groups' | 'destinations'>,
): PostIdentityContext {
  return {
    groupFacebookIds: new Map(workspace.groups.map((group) => [group.id, group.facebookId])),
    destinations: new Map(
      (workspace.destinations ?? []).map((destination) => [destination.id, destination]),
    ),
  };
}

/** One identity rule for editor saves, imports, seeds, and future API writes. */
export function normalizedPostUrl(value: string): string {
  const ids = parseFacebookGroupPostLink(value);
  if (ids) return `https://www.facebook.com/groups/${ids.groupId}/posts/${ids.postId}/`;
  try {
    const url = new URL(value);
    url.hash = '';
    url.hostname = url.hostname.toLowerCase().replace(/^www\./, '');
    if (url.hostname === 'm.facebook.com' || url.hostname === 'web.facebook.com')
      url.hostname = 'facebook.com';
    url.pathname = url.pathname.replace(/\/+$/, '') || '/';
    for (const key of [...url.searchParams.keys()]) {
      if (/^(?:utm_.+|fbclid|gclid|ref|refsrc|__cft__|__tn__)$/i.test(key))
        url.searchParams.delete(key);
    }
    url.searchParams.sort();
    return url.toString().replace(/\/$/, '');
  } catch {
    return value.trim();
  }
}

export function postIdentityKeys(
  post: Post,
  workspace: Pick<Workspace, 'groups' | 'destinations'>,
  context = buildPostIdentityContext(workspace),
): Set<string> {
  const keys = new Set<string>();
  const groupUrl =
    post.platform === 'facebook'
      ? canonicalPostUrl(context.groupFacebookIds.get(post.groupId) ?? '', post.facebookPostId)
      : '';
  if (groupUrl) keys.add(`url:${groupUrl}`);
  if (post.url) keys.add(`url:${normalizedPostUrl(post.url)}`);
  const destination = context.destinations.get(post.destinationId ?? '');
  if (post.platform === 'facebook' && post.facebookPostId && destination?.externalId)
    keys.add(
      `facebook:${destination.kind}:${destination.externalId.toLowerCase()}:${post.facebookPostId}`,
    );
  return keys;
}

export function postsShareIdentity(
  first: Post,
  second: Post,
  workspace: Pick<Workspace, 'groups' | 'destinations'>,
  context = buildPostIdentityContext(workspace),
): boolean {
  const keys = postIdentityKeys(first, workspace, context);
  return [...postIdentityKeys(second, workspace, context)].some((key) => keys.has(key));
}

/** Retain historical active pairs, but reject new ones, including when a post is restored. */
export function newDuplicatePair(before: Workspace, after: Workspace): [string, string] | null {
  const previous = new Map(
    before.posts.filter((post) => !post.deletedAt).map((post) => [post.id, post]),
  );
  const beforeContext = buildPostIdentityContext(before);
  const afterContext = buildPostIdentityContext(after);
  const previousKeys = new Map(
    [...previous.values()].map((post) => [post.id, postIdentityKeys(post, before, beforeContext)]),
  );
  const nextKeys = new Map(
    after.posts
      .filter((post) => !post.deletedAt)
      .map((post) => [post.id, postIdentityKeys(post, after, afterContext)]),
  );
  const owners = new Map<string, string[]>();
  for (const [id, keys] of nextKeys)
    for (const key of keys) {
      const list = owners.get(key);
      if (list) list.push(id);
      else owners.set(key, [id]);
    }
  for (const [id, keys] of nextKeys) {
    const oldKeys = previousKeys.get(id);
    if (oldKeys && oldKeys.size === keys.size && [...keys].every((key) => oldKeys.has(key)))
      continue;
    for (const key of keys)
      for (const otherId of owners.get(key) ?? []) {
        if (otherId === id) continue;
        const oldPost = previous.get(id);
        const oldOther = previous.get(otherId);
        if (!oldPost || !oldOther || !postsShareIdentity(oldPost, oldOther, before, beforeContext))
          return [id, otherId];
      }
  }
  return null;
}
