import readings from './provided-viewers-update.json';
import type { Workspace } from './types';
import {
  WorkspaceRevisionConflict,
  type WorkspaceRepository,
  type WorkspaceSnapshot,
} from './workspace-repository';

// Matched from attachment aaaeceaf: unique published group name + unique supplied
// group permalink. All 26 previously known publication dates also agree.
export const PROVIDED_VIEWERS_UPDATE = 'provided-viewers-aaaeceaf-2026-10-17';
export const providedViewerUpdates = readings;

/** Replace only the latest total, once; never add dated metric history. */
export function applyProvidedViewerUpdates(workspace: Workspace): Workspace {
  if (workspace.appliedDataUpdates?.includes(PROVIDED_VIEWERS_UPDATE)) return workspace;
  const updates = new Map<string, number>();
  for (const reading of readings) {
    const matches = workspace.posts.filter((post) => {
      if (post.deletedAt || post.platform !== 'facebook') return false;
      const group = workspace.groups.find((item) => item.id === post.groupId);
      if (group?.deletedAt) return false;
      if (post.facebookPostId && post.facebookPostId !== reading.postId) return false;
      if (post.url) {
        try {
          const url = new URL(post.url);
          const parts = url.pathname.match(/^\/groups\/([^/]+)\/(?:posts|permalink)\/(\d+)\/?$/);
          if (/(^|\.)facebook\.com$/i.test(url.hostname) && parts) {
            return parts[1] === reading.group && parts[2] === reading.postId;
          }
        } catch {
          return false;
        }
      }
      return post.facebookPostId === reading.postId && group?.facebookId === reading.group;
    });
    // Ambiguous or absent records are left untouched.
    if (matches.length === 1) updates.set(matches[0].id, reading.viewers);
  }
  return {
    ...workspace,
    posts: workspace.posts.map((post) =>
      updates.has(post.id) ? { ...post, viewers: updates.get(post.id)! } : post,
    ),
    appliedDataUpdates: [...(workspace.appliedDataUpdates ?? []), PROVIDED_VIEWERS_UPDATE],
  };
}

export async function ensureProvidedViewerUpdates(
  repository: WorkspaceRepository,
  initial: WorkspaceSnapshot,
): Promise<WorkspaceSnapshot> {
  let snapshot = initial;
  for (let attempt = 0; attempt < 3; attempt += 1) {
    const workspace = applyProvidedViewerUpdates(snapshot.workspace);
    if (workspace === snapshot.workspace) return snapshot;
    try {
      return await repository.commit({
        workspace,
        expectedRevision: snapshot.revision,
        operationId: PROVIDED_VIEWERS_UPDATE,
      });
    } catch (error) {
      if (!(error instanceof WorkspaceRevisionConflict)) throw error;
      snapshot = await repository.load();
    }
  }
  throw new WorkspaceRevisionConflict();
}
