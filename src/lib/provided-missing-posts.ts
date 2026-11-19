import { knownFacebookGroupName } from './facebook-group-directory';
import { ESHAN_PRODUCT, eshanProductId } from './provided-products';
import { normalizedPostUrl, postIdentityKeys, buildPostIdentityContext } from './post-identity';
import type { Workspace } from './types';
import {
  WorkspaceRevisionConflict,
  type WorkspaceRepository,
  type WorkspaceSnapshot,
} from './workspace-repository';

export const PROVIDED_MISSING_POSTS_UPDATE = 'missing-group-posts-2026-10-17';

/** Links supplied after the group posts were matched to the 17 October Viewers table. */
export const providedMissingPosts = [
  {
    groupId: '984343641981437',
    postId: '2809958519419931',
    publishedAtIct: '2026-10-12T19:18:00+07:00',
    viewers: 15,
    url: 'https://www.facebook.com/groups/984343641981437/permalink/2809958519419931/',
  },
  {
    groupId: '3900458250198953',
    postId: '4661094270802010',
    publishedAtIct: '2026-10-12T19:08:00+07:00',
    viewers: 9,
    url: 'https://www.facebook.com/groups/3900458250198953/permalink/4661094270802010/',
  },
] as const;

/** Add the two supplied published posts once without altering existing records. */
export function addProvidedMissingPosts(workspace: Workspace): Workspace {
  if (workspace.appliedDataUpdates?.includes(PROVIDED_MISSING_POSTS_UPDATE)) return workspace;
  const store = workspace.companies.find((item) => item.id === 'vetra') ?? workspace.companies[0];
  if (!store) throw new Error('A company is required to add the supplied posts.');

  const groups = [...workspace.groups];
  const productId = eshanProductId(workspace);
  const posts = [...workspace.posts];
  const identityContext = buildPostIdentityContext(workspace);
  const existingLinks = new Set(
    workspace.posts.flatMap((post) => [...postIdentityKeys(post, workspace, identityContext)]),
  );
  for (const item of providedMissingPosts) {
    if (
      posts.some(
        (post) =>
          post.platform === 'facebook' &&
          (post.facebookPostId === item.postId || post.url === item.url),
      ) ||
      existingLinks.has(`url:${normalizedPostUrl(item.url)}`)
    )
      continue;

    let group = groups.find(
      (candidate) => candidate.companyId === store.id && candidate.facebookId === item.groupId,
    );
    if (group?.deletedAt)
      throw new Error('Restore the matching Facebook group from Trash before adding its post.');
    if (!group) {
      const id = `provided-group-${item.groupId}`;
      if (groups.some((candidate) => candidate.id === id))
        throw new Error('A group ID conflicts with the supplied post.');
      group = {
        id,
        companyId: store.id,
        name: knownFacebookGroupName(item.groupId) ?? `Facebook group ${item.groupId}`,
        facebookId: item.groupId,
        category: '',
        notes: '',
      };
      groups.push(group);
    }

    const id = `provided-link-${item.postId}`;
    if (posts.some((post) => post.id === id))
      throw new Error('A post ID conflicts with the supplied post.');
    posts.push({
      id,
      companyId: store.id,
      groupId: group.id,
      destinationId: group.id,
      product: ESHAN_PRODUCT.name,
      ...(productId ? { productId } : {}),
      platform: 'facebook',
      publishedAt: new Date(item.publishedAtIct).toISOString(),
      facebookPostId: item.postId,
      url: item.url,
      viewers: item.viewers,
      pinned: false,
      color: store.color,
    });
    existingLinks.add(`url:${normalizedPostUrl(item.url)}`);
  }
  return {
    ...workspace,
    groups,
    posts,
    appliedDataUpdates: [...(workspace.appliedDataUpdates ?? []), PROVIDED_MISSING_POSTS_UPDATE],
  };
}

export async function ensureProvidedMissingPosts(
  repository: WorkspaceRepository,
  initial: WorkspaceSnapshot,
): Promise<WorkspaceSnapshot> {
  let snapshot = initial;
  for (let attempt = 0; attempt < 3; attempt += 1) {
    const workspace = addProvidedMissingPosts(snapshot.workspace);
    if (workspace === snapshot.workspace) return snapshot;
    try {
      return await repository.commit({
        workspace,
        expectedRevision: snapshot.revision,
        operationId: PROVIDED_MISSING_POSTS_UPDATE,
      });
    } catch (error) {
      if (!(error instanceof WorkspaceRevisionConflict)) throw error;
      snapshot = await repository.load();
    }
  }
  throw new WorkspaceRevisionConflict();
}
