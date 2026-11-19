export type FacebookGroupPostIds = { groupId: string; postId: string };

const FACEBOOK_HOSTS = new Set([
  'facebook.com',
  'www.facebook.com',
  'm.facebook.com',
  'web.facebook.com',
]);
const ID = '[0-9]{1,40}';
const GROUP_KEY = '[A-Za-z0-9._-]{1,80}';
const POST_PATH = new RegExp(`^/groups/(${GROUP_KEY})/(?:permalink|posts)/(${ID})/?$`);
const PENDING_POST_PATH = new RegExp(`^/groups/(${GROUP_KEY})/pending_posts/(${ID})/?$`);
const GROUP_PATH = new RegExp(`^/groups/(${GROUP_KEY})/?$`);
const NUMERIC_ID = new RegExp(`^${ID}$`);
const VALID_GROUP_KEY = new RegExp(`^${GROUP_KEY}$`);
const NAVIGATION_KEYS = new Set([
  'feed',
  'discover',
  'joins',
  'create',
  'categories',
  'notifications',
  'your_groups',
  'membership',
  'admin',
]);

/** Match the group import's safe ID-or-handle convention without importing its HTML parser. */
export function normalizeFacebookGroupKey(input: string): string {
  const key = input.trim().toLowerCase();
  if (
    !VALID_GROUP_KEY.test(key) ||
    NAVIGATION_KEYS.has(key) ||
    (/^\d+$/.test(key) && !NUMERIC_ID.test(key))
  )
    return '';
  return key;
}

function parseFacebookUrl(input: string): URL | null {
  const value = input.trim();
  // URL normalizes explicit :443 and empty credentials away, so check the original authority too.
  const authority = /^https:\/\/([^/?#]+)/i.exec(value)?.[1];
  if (!authority || !FACEBOOK_HOSTS.has(authority.toLowerCase())) return null;
  let url: URL;
  try {
    url = new URL(value);
  } catch {
    return null;
  }

  if (
    url.protocol !== 'https:' ||
    !FACEBOOK_HOSTS.has(url.hostname) ||
    url.username ||
    url.password ||
    url.port
  ) {
    return null;
  }

  return url;
}

export function convertFacebookPendingPostUrl(input: string): string | null {
  const url = parseFacebookUrl(input);
  const pendingPost = url && PENDING_POST_PATH.exec(url.pathname);
  if (!pendingPost) return null;
  const groupId = normalizeFacebookGroupKey(pendingPost[1]);
  if (!groupId) return null;
  const postId = pendingPost[2];
  return `https://www.facebook.com/groups/${groupId}/posts/${postId}/`;
}

/** Extract a numeric post ID and a group ID or handle from a clearly identified group post. */
export function parseFacebookGroupPostLink(input: string): FacebookGroupPostIds | null {
  const url = parseFacebookUrl(input);
  if (!url) return null;

  const postPath = POST_PATH.exec(url.pathname);
  if (postPath) {
    const groupId = normalizeFacebookGroupKey(postPath[1]);
    return groupId ? { groupId, postId: postPath[2] } : null;
  }

  // Facebook also shares individual group posts as /groups/{key}/?multi_permalinks={postId}.
  const groupPath = GROUP_PATH.exec(url.pathname);
  if (!groupPath) return null;
  const groupId = normalizeFacebookGroupKey(groupPath[1]);
  if (!groupId) return null;
  const postIds = url.searchParams.getAll('multi_permalinks');
  if (postIds.length !== 1 || !NUMERIC_ID.test(postIds[0])) return null;
  return { groupId, postId: postIds[0] };
}

/** Preserve the numeric-only contract used by imports and stored Facebook ID fields. */
export function parseFacebookGroupPostUrl(input: string): FacebookGroupPostIds | null {
  const ids = parseFacebookGroupPostLink(input);
  return ids && NUMERIC_ID.test(ids.groupId) ? ids : null;
}

/** Upgrade recognized Facebook group post input before the editor extracts IDs or saves it. */
export function normalizeFacebookGroupPostInput(input: string): string {
  const value = input.trim();
  if (!/^http:\/\//i.test(value)) return value;
  const secureUrl = value.replace(/^http:/i, 'https:');
  return parseFacebookGroupPostLink(secureUrl) || convertFacebookPendingPostUrl(secureUrl)
    ? secureUrl
    : value;
}
