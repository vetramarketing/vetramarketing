import { safePostUrl } from './data';
import { buildPostIdentityContext, postsShareIdentity, normalizedPostUrl } from './post-identity';
import type { Group, Post, Workspace } from './types';

export type PostLinkReview = {
  exactMatch: Post | null;
  possibleMetaRows: Post[];
};

function groupKeyInUrl(value: string): string {
  if (!value || !safePostUrl(value)) return '';
  try {
    const url = new URL(normalizedPostUrl(value));
    if (!['facebook.com', 'www.facebook.com'].includes(url.hostname)) return '';
    return (
      /^\/groups\/([A-Za-z0-9._-]{2,80})\/(?:posts|permalink)\/\d{1,40}\/?$/i
        .exec(url.pathname)?.[1]
        ?.toLowerCase() ?? ''
    );
  } catch {
    return '';
  }
}

/** A group match is a review hint; only a post URL or post ID proves identity. */
export function reviewPostLink(
  workspace: Workspace,
  candidate: Post,
  pendingGroup: Group | null = null,
): PostLinkReview {
  const groups = pendingGroup
    ? [...workspace.groups.filter((group) => group.id !== pendingGroup.id), pendingGroup]
    : workspace.groups;
  const contextWorkspace = { ...workspace, groups };
  const context = buildPostIdentityContext(contextWorkspace);
  const safeCandidate = {
    ...candidate,
    url: safePostUrl(candidate.url) ? candidate.url : '',
    facebookPostId: /^\d{1,40}$/.test(candidate.facebookPostId) ? candidate.facebookPostId : '',
  };
  const hasPostIdentity = Boolean(
    safeCandidate.url ||
    (safeCandidate.platform === 'facebook' &&
      safeCandidate.facebookPostId &&
      context.groupFacebookIds.get(safeCandidate.groupId)),
  );
  if (!hasPostIdentity) return { exactMatch: null, possibleMetaRows: [] };

  const exactMatch =
    workspace.posts.find(
      (post) =>
        post.id !== candidate.id &&
        !post.deletedAt &&
        postsShareIdentity(safeCandidate, post, contextWorkspace, context),
    ) ?? null;
  const groupKey =
    candidate.platform === 'facebook'
      ? groupKeyInUrl(safeCandidate.url) || context.groupFacebookIds.get(candidate.groupId) || ''
      : '';
  const possibleMetaRows = groupKey
    ? workspace.posts.filter(
        (post) =>
          post.id !== candidate.id &&
          !post.deletedAt &&
          post.platform === 'facebook' &&
          post.metaSourceRow !== undefined &&
          !post.url &&
          !post.facebookPostId &&
          post.metaGroupKey?.toLowerCase() === groupKey.toLowerCase(),
      )
    : [];
  return { exactMatch, possibleMetaRows };
}
