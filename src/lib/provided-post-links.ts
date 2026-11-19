import links from './provided-post-links.json';
import { knownFacebookGroupHandleName, knownFacebookGroupName } from './facebook-group-directory';
import { providedSamplePosts } from './provided-sample-posts';
import { addProvidedLatestReadings } from './provided-latest-readings';
import { normalizedPostUrl, postIdentityKeys, buildPostIdentityContext } from './post-identity';
import { ESHAN_PRODUCT, eshanProductId } from './provided-products';
import type { Workspace } from './types';
import {
  WorkspaceRevisionConflict,
  type WorkspaceRepository,
  type WorkspaceSnapshot,
} from './workspace-repository';

export const PROVIDED_POST_LINKS_UPDATE = 'provided-post-links-2026-10-17';
export const providedPostLinks = links;

function facebookPostId(url: string): string | undefined {
  try {
    const parsed = new URL(url);
    if (!/(^|\.)facebook\.com$/i.test(parsed.hostname)) return;
    return (
      parsed.pathname.match(/\/(?:permalink|posts)\/(\+?\d+)/)?.[1] ??
      parsed.searchParams.get('story_fbid') ??
      undefined
    );
  } catch {
    return;
  }
}

/** Supplied published links only; duplicates and pending posts were removed at ingestion. */
export function addProvidedPostLinks(workspace: Workspace): Workspace {
  if (workspace.appliedDataUpdates?.includes(PROVIDED_POST_LINKS_UPDATE)) return workspace;
  const store = workspace.companies.find((item) => item.id === 'vetra') ?? workspace.companies[0];
  if (!store) throw new Error('A company is required to import the supplied posts.');
  const groups = [...workspace.groups];
  const productId = eshanProductId(workspace);
  const added = [] as Workspace['posts'];
  const identityContext = buildPostIdentityContext(workspace);
  const existingLinks = new Set(
    workspace.posts.flatMap((post) => [...postIdentityKeys(post, workspace, identityContext)]),
  );
  const existing = new Set(
    workspace.posts.flatMap((post) =>
      post.platform === 'facebook' ? [post.facebookPostId, facebookPostId(post.url) ?? ''] : [],
    ),
  );
  for (const link of links) {
    const match = new URL(link).pathname.match(/^\/groups\/([^/]+)\/permalink\/(\d+)\/?$/);
    if (!match) throw new Error('Invalid supplied post link.');
    const [, handle, postId] = match;
    if (existing.has(postId) || existingLinks.has(`url:${normalizedPostUrl(link)}`)) continue;
    const numeric = /^\d+$/.test(handle);
    const groupUrl = `https://www.facebook.com/groups/${handle}/`;
    let group = groups.find(
      (item) =>
        item.companyId === store.id &&
        (numeric
          ? item.facebookId === handle
          : item.notes.includes(groupUrl) ||
            workspace.posts.some(
              (post) => post.groupId === item.id && post.url.startsWith(groupUrl),
            )),
    );
    if (group?.deletedAt)
      throw new Error('Restore the matching Facebook group from Trash before importing.');
    if (!group) {
      const id = `provided-group-${handle}`;
      if (groups.some((item) => item.id === id))
        throw new Error('Supplied group ID conflicts with existing data.');
      group = {
        id,
        companyId: store.id,
        name:
          (numeric ? knownFacebookGroupName(handle) : knownFacebookGroupHandleName(handle)) ||
          `Facebook group ${handle}`,
        facebookId: numeric ? handle : '',
        category: '',
        notes: groupUrl,
      };
      groups.push(group);
    }
    const id = `provided-link-${postId}`;
    if (workspace.posts.some((post) => post.id === id))
      throw new Error('Supplied post ID conflicts with existing data.');
    const known = providedSamplePosts.find(
      (post) => post.postId === postId && post.group === handle,
    );
    added.push({
      id,
      companyId: store.id,
      groupId: group.id,
      destinationId: group.id,
      product: ESHAN_PRODUCT.name,
      ...(productId ? { productId } : {}),
      platform: 'facebook',
      publishedAt: known
        ? new Date(known.publishedAtIct.replace(' ', 'T') + ':00+07:00').toISOString()
        : '',
      facebookPostId: postId,
      url: `${groupUrl}posts/${postId}/`,
      viewers: known?.viewers ?? null,
      color: store.color,
    });
    existing.add(postId);
    existingLinks.add(`url:${normalizedPostUrl(link)}`);
  }
  // Apply previously supplied latest totals only to newly added records.
  const updated = addProvidedLatestReadings({ ...workspace, groups, posts: added });
  return {
    ...workspace,
    groups,
    posts: [...workspace.posts, ...updated.workspace.posts],
    appliedDataUpdates: [...(workspace.appliedDataUpdates ?? []), PROVIDED_POST_LINKS_UPDATE],
  };
}

export async function ensureProvidedPostLinks(
  repository: WorkspaceRepository,
  initial: WorkspaceSnapshot,
): Promise<WorkspaceSnapshot> {
  let snapshot = initial;
  for (let attempt = 0; attempt < 3; attempt += 1) {
    const workspace = addProvidedPostLinks(snapshot.workspace);
    if (workspace === snapshot.workspace) return snapshot;
    try {
      return await repository.commit({
        workspace,
        expectedRevision: snapshot.revision,
        operationId: PROVIDED_POST_LINKS_UPDATE,
      });
    } catch (error) {
      if (!(error instanceof WorkspaceRevisionConflict)) throw error;
      snapshot = await repository.load();
    }
  }
  throw new WorkspaceRevisionConflict();
}
