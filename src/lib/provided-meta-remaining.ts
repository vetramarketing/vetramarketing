import { parseFacebookGroupPostUrl } from './facebook-post-url';
import { ESHAN_PRODUCT, eshanProductId } from './provided-products';
import type { Post, Workspace } from './types';
import {
  WorkspaceRevisionConflict,
  type WorkspaceRepository,
  type WorkspaceSnapshot,
} from './workspace-repository';

export const PROVIDED_META_REMAINING_UPDATE = 'meta-remaining-e9237ffb-2026-10-18';

const GROUP_31 = '2865273793746188';
const POST_31 = '4440010186272533';
const ROW_31_DATE = '2026-10-17T09:49:00.000Z';

function isRow31Post(post: Post, workspace: Workspace): boolean {
  if (post.deletedAt || post.platform !== 'facebook') return false;
  const link = parseFacebookGroupPostUrl(post.url);
  if (link) return link.groupId === GROUP_31 && link.postId === POST_31;
  const group = workspace.groups.find((item) => item.id === post.groupId);
  return group?.facebookId === GROUP_31 && post.facebookPostId === POST_31;
}

/** Reconcile one identified group post and retain one page row without inventing its permalink. */
export function addProvidedMetaRemaining(workspace: Workspace): Workspace {
  if (workspace.appliedDataUpdates?.includes(PROVIDED_META_REMAINING_UPDATE)) return workspace;

  const matches = workspace.posts.filter((post) => isRow31Post(post, workspace));
  const posts = workspace.posts.map((post) =>
    matches.length === 1 &&
    post.id === matches[0].id &&
    post.publishedAt === ROW_31_DATE &&
    post.viewers === 21
      ? { ...post, viewers: 34 }
      : post,
  );

  const store = workspace.companies.find((item) => item.id === 'vetra') ?? workspace.companies[0];
  if (store && !posts.some((post) => post.metaSourceRow === 85)) {
    if (posts.some((post) => post.id === 'provided-meta-row-85'))
      throw new Error('A saved post ID conflicts with Meta row 85.');
    const productId = eshanProductId(workspace);
    posts.push({
      id: 'provided-meta-row-85',
      companyId: store.id,
      groupId: '',
      product: ESHAN_PRODUCT.name,
      ...(productId ? { productId } : {}),
      platform: 'facebook',
      publicationStatus: 'published',
      publishedAt: '',
      // The supplied table was captured on 18 Oct; its "today" label has no year.
      metaPublishedLabel: '18 ต.ค. เวลา 03:28',
      metaSourceRow: 85,
      facebookPostId: '',
      url: '',
      viewers: 3,
      pinned: false,
      color: store.color,
    });
  }

  return {
    ...workspace,
    posts,
    appliedDataUpdates: [...(workspace.appliedDataUpdates ?? []), PROVIDED_META_REMAINING_UPDATE],
  };
}

export async function ensureProvidedMetaRemaining(
  repository: WorkspaceRepository,
  initial: WorkspaceSnapshot,
): Promise<WorkspaceSnapshot> {
  let snapshot = initial;
  for (let attempt = 0; attempt < 3; attempt += 1) {
    const workspace = addProvidedMetaRemaining(snapshot.workspace);
    if (workspace === snapshot.workspace) return snapshot;
    try {
      return await repository.commit({
        workspace,
        expectedRevision: snapshot.revision,
        operationId: PROVIDED_META_REMAINING_UPDATE,
      });
    } catch (error) {
      if (!(error instanceof WorkspaceRevisionConflict)) throw error;
      snapshot = await repository.load();
    }
  }
  throw new WorkspaceRevisionConflict();
}
