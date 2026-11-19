import { buildPostIdentityContext, postsShareIdentity } from './post-identity';
import type { Post, Workspace } from './types';

export type PostConflictReason =
  'changed' | 'removed' | 'duplicate' | 'existing-post' | 'identity' | 'missing-id';

const messages: Record<PostConflictReason, string> = {
  changed:
    'This post changed in another tab. Reopen it to review the latest version before saving.',
  removed: 'This post was removed or moved to Trash. Your changes were not saved.',
  duplicate: 'A post with this ID already exists. Create a new copy before saving.',
  'existing-post': 'This post already has an active record. Open that record to edit it.',
  identity: 'The edited post ID no longer matches its original record.',
  'missing-id': 'A post ID is required before saving.',
};

export class PostConflictError extends Error {
  readonly code = 'POST_CONFLICT';
  readonly reason: PostConflictReason;

  constructor(reason: PostConflictReason) {
    super(messages[reason]);
    this.name = 'PostConflictError';
    this.reason = reason;
  }
}

/** Explicit field order ignores JSON property order without hiding actual changes. */
function snapshot(post: Post): string {
  return JSON.stringify([
    post.id,
    post.companyId,
    post.groupId,
    post.product,
    post.productId ?? null,
    post.destinationId ?? null,
    post.platform,
    post.publishedAt,
    post.facebookPostId,
    post.url,
    post.viewers,
    post.publicationStatus ?? 'published',
    post.metaSourceRow ?? null,
    post.metaPublishedLabel ?? null,
    post.metaGroupName ?? null,
    post.metaGroupKey ?? null,
    post.pinned === true,
    post.color,
    post.deletedAt ?? null,
  ]);
}

function copyPost(post: Post): Post {
  return { ...post };
}

function assertUniquePost(latest: Workspace, post: Post): void {
  const context = buildPostIdentityContext(latest);
  for (const other of latest.posts) {
    if (other.id === post.id || other.deletedAt) continue;
    if (postsShareIdentity(post, other, latest, context))
      throw new PostConflictError('existing-post');
  }
}

/** Merge one editor save into the freshest workspace without overwriting concurrent edits. */
export function preparePostSave(latest: Workspace, post: Post, baseline: Post | null): Workspace {
  if (!post.id.trim()) throw new PostConflictError('missing-id');

  if (baseline?.id) {
    if (post.id !== baseline.id) throw new PostConflictError('identity');
    const index = latest.posts.findIndex((item) => item.id === baseline.id);
    const current = latest.posts[index];
    if (!current || current.deletedAt) throw new PostConflictError('removed');
    if (snapshot(current) !== snapshot(baseline)) throw new PostConflictError('changed');
    assertUniquePost(latest, post);

    return {
      ...latest,
      posts: latest.posts.map((item, itemIndex) => (itemIndex === index ? copyPost(post) : item)),
    };
  }

  if (latest.posts.some((item) => item.id === post.id)) throw new PostConflictError('duplicate');
  assertUniquePost(latest, post);
  return { ...latest, posts: [copyPost(post), ...latest.posts] };
}
