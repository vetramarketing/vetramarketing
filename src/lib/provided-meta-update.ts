import readings from './provided-meta-update.json';
import type { Post, Workspace } from './types';
import {
  WorkspaceRevisionConflict,
  type WorkspaceRepository,
  type WorkspaceSnapshot,
} from './workspace-repository';

/**
 * Meta table pasted on 17 October 2026 (ICT); column 5 is Viewers.
 * The HTML omitted group post IDs and years. Its 72 tracked rows were matched
 * by unique group label, then checked against known publication minutes where
 * available. The year 2026 follows the current reporting period; sourceRow
 * preserves the table position.
 */
export const PROVIDED_META_UPDATE = 'meta-viewers-dates-4a849074-2026-10-17';
export const providedMetaReadings = readings;

function matchesIdentity(post: Post, group: string, postId: string): boolean {
  if (post.deletedAt || post.platform !== 'facebook' || post.facebookPostId !== postId)
    return false;
  try {
    const url = new URL(post.url);
    if (!/(^|\.)facebook\.com$/i.test(url.hostname)) return false;
    const parts = url.pathname.match(/^\/groups\/([^/]+)\/(?:posts|permalink)\/(\d+)\/?$/);
    return parts?.[1] === group && parts[2] === postId;
  } catch {
    return false;
  }
}

export interface MetaUpdateResult {
  workspace: Workspace;
  viewersUpdated: number;
  datesFilled: number;
  conflicts: number;
  unmatched: number;
}

/** Update identified posts once, preserving any Viewers or dates edited since the last supplied data. */
export function applyProvidedMetaUpdate(workspace: Workspace): MetaUpdateResult {
  if (workspace.appliedDataUpdates?.includes(PROVIDED_META_UPDATE))
    return { workspace, viewersUpdated: 0, datesFilled: 0, conflicts: 0, unmatched: 0 };

  const updates = new Map<string, Post>();
  let viewersUpdated = 0;
  let datesFilled = 0;
  let conflicts = 0;
  let unmatched = 0;
  for (const reading of readings) {
    const matches = workspace.posts.filter((post) =>
      matchesIdentity(post, reading.group, reading.postId),
    );
    if (matches.length !== 1) {
      unmatched += 1;
      continue;
    }
    const post = matches[0];
    const viewersSafe =
      post.viewers === reading.previousViewers || post.viewers === reading.viewers;
    const dateSafe =
      post.publishedAt === reading.previousPublishedAt || post.publishedAt === reading.publishedAt;
    if (!viewersSafe || !dateSafe) conflicts += 1;
    const viewers = viewersSafe ? reading.viewers : post.viewers;
    const publishedAt = dateSafe ? reading.publishedAt : post.publishedAt;
    if (viewers !== post.viewers) viewersUpdated += 1;
    if (!post.publishedAt && publishedAt) datesFilled += 1;
    if (viewers !== post.viewers || publishedAt !== post.publishedAt)
      updates.set(post.id, { ...post, viewers, publishedAt });
  }
  return {
    workspace: {
      ...workspace,
      posts: workspace.posts.map((post) => updates.get(post.id) ?? post),
      appliedDataUpdates: [...(workspace.appliedDataUpdates ?? []), PROVIDED_META_UPDATE],
    },
    viewersUpdated,
    datesFilled,
    conflicts,
    unmatched,
  };
}

export async function ensureProvidedMetaUpdate(
  repository: WorkspaceRepository,
  initial: WorkspaceSnapshot,
): Promise<WorkspaceSnapshot> {
  let snapshot = initial;
  for (let attempt = 0; attempt < 3; attempt += 1) {
    const result = applyProvidedMetaUpdate(snapshot.workspace);
    if (result.workspace === snapshot.workspace) return snapshot;
    try {
      return await repository.commit({
        workspace: result.workspace,
        expectedRevision: snapshot.revision,
        operationId: PROVIDED_META_UPDATE,
      });
    } catch (error) {
      if (!(error instanceof WorkspaceRevisionConflict)) throw error;
      snapshot = await repository.load();
    }
  }
  throw new WorkspaceRevisionConflict();
}
