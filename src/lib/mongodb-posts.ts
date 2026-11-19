import { validateWorkspace } from './data';
import { validateAuthorizedWorkspaceId } from './mongodb-catalog';
import { postIdentityKeys } from './post-identity';
import { postPublicationStatus } from './post-tools';
import type { Destination, PublishedPost, Workspace } from './types';

export type DestinationDocument = Destination & { workspaceId: string };
export type PostDocument = PublishedPost & { workspaceId: string; identityKeys: string[] };

/** Indexes are declarations for the future server adapter; no database is connected here. */
export const POST_INDEXES = {
  destinations: [
    { key: { workspaceId: 1, id: 1 }, name: 'destination_identity', unique: true },
    {
      key: { workspaceId: 1, companyId: 1, platform: 1, kind: 1, externalId: 1 },
      name: 'destination_lookup',
    },
  ],
  posts: [
    { key: { workspaceId: 1, id: 1 }, name: 'post_identity', unique: true },
    { key: { workspaceId: 1, identityKeys: 1 }, name: 'post_external_identity' },
    {
      key: { workspaceId: 1, companyId: 1, deletedAt: 1, publicationStatus: 1 },
      name: 'post_publication_status',
    },
    {
      key: { workspaceId: 1, companyId: 1, deletedAt: 1, pinned: -1, publishedAt: -1 },
      name: 'post_company_feed',
    },
    { key: { workspaceId: 1, productId: 1, deletedAt: 1 }, name: 'post_product_lookup' },
    { key: { workspaceId: 1, destinationId: 1, deletedAt: 1 }, name: 'post_destination_lookup' },
  ],
} as const;

/** Detached, validated documents for a future authenticated migration or API transaction. */
export function preparePostDocuments(
  workspace: Workspace,
  authorizedWorkspaceId: string,
): {
  destinations: DestinationDocument[];
  posts: PostDocument[];
} {
  validateAuthorizedWorkspaceId(authorizedWorkspaceId);
  const valid = validateWorkspace(workspace);
  if (valid.posts.some((post) => post.status !== undefined && post.status !== 'published'))
    throw new Error('Only published posts can be prepared for MongoDB.');
  return {
    destinations: (valid.destinations ?? []).map((destination) => ({
      ...destination,
      workspaceId: authorizedWorkspaceId,
    })),
    posts: valid.posts.map((post) => ({
      id: post.id,
      workspaceId: authorizedWorkspaceId,
      companyId: post.companyId,
      groupId: post.groupId,
      product: post.product,
      ...(post.productId ? { productId: post.productId } : {}),
      ...(post.destinationId ? { destinationId: post.destinationId } : {}),
      platform: post.platform,
      publishedAt: post.publishedAt,
      facebookPostId: post.facebookPostId,
      url: post.url,
      viewers: post.viewers,
      commentCount: post.commentCount ?? null,
      pinned: post.pinned === true,
      publicationStatus: postPublicationStatus(post),
      ...(post.metaSourceRow === undefined ? {} : { metaSourceRow: post.metaSourceRow }),
      ...(post.metaPublishedLabel ? { metaPublishedLabel: post.metaPublishedLabel } : {}),
      ...(post.metaGroupName ? { metaGroupName: post.metaGroupName } : {}),
      ...(post.metaGroupKey ? { metaGroupKey: post.metaGroupKey } : {}),
      color: post.color,
      ...(post.deletedAt ? { deletedAt: post.deletedAt } : {}),
      identityKeys: [...postIdentityKeys(post, valid)].sort(),
    })),
  };
}
