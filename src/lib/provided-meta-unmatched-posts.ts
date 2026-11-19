import { knownFacebookGroupHandleName, knownFacebookGroupName } from './facebook-group-directory';
import { ESHAN_PRODUCT, eshanProductId } from './provided-products';
import type { Group, Workspace } from './types';
import {
  WorkspaceRevisionConflict,
  type WorkspaceRepository,
  type WorkspaceSnapshot,
} from './workspace-repository';

export const PROVIDED_META_UNMATCHED_POSTS_UPDATE = 'meta-unmatched-posts-e9237ffb-2026-10-18';

/**
 * Rows from the supplied Meta table. Its dates omit the year and none of these
 * rows exposes a public post permalink. Row number identifies only this source
 * record; it must never be used to match a later Meta export to a post.
 */
export const providedMetaUnmatchedPosts: ReadonlyArray<{
  row: number;
  groupKey: string;
  viewers: number;
  publicationStatus: 'published' | 'pending';
  metaPublishedLabel?: string;
}> = [
  { row: 35, groupKey: '1484261645271696', viewers: 28, publicationStatus: 'pending' },
  { row: 69, groupKey: '441202063403406', viewers: 9, publicationStatus: 'pending' },
  { row: 75, groupKey: '662486263901244', viewers: 6, publicationStatus: 'pending' },
  { row: 86, groupKey: '1899598603545611', viewers: 1, publicationStatus: 'pending' },
  { row: 87, groupKey: '255496054624069', viewers: 1, publicationStatus: 'pending' },
  {
    row: 88,
    groupKey: '1519436311687402',
    viewers: 1,
    publicationStatus: 'published',
    metaPublishedLabel: '15 ต.ค. เวลา 18:24',
  },
  {
    row: 89,
    groupKey: '3086169734836945',
    viewers: 1,
    publicationStatus: 'published',
    metaPublishedLabel: '15 ต.ค. เวลา 12:37',
  },
  {
    row: 90,
    groupKey: 'promoinsider',
    viewers: 1,
    publicationStatus: 'published',
    metaPublishedLabel: '15 ต.ค. เวลา 12:35',
  },
  {
    row: 91,
    groupKey: '3441101339294036',
    viewers: 1,
    publicationStatus: 'published',
    metaPublishedLabel: '15 ต.ค. เวลา 12:26',
  },
  { row: 92, groupKey: '217617192676179', viewers: 1, publicationStatus: 'pending' },
  {
    row: 93,
    groupKey: '715406855709019',
    viewers: 1,
    publicationStatus: 'published',
    metaPublishedLabel: '15 ต.ค. เวลา 11:49',
  },
  {
    row: 94,
    groupKey: '349424095518801',
    viewers: 1,
    publicationStatus: 'published',
    metaPublishedLabel: '12 ต.ค. เวลา 20:38',
  },
  {
    row: 95,
    groupKey: '292856030876621',
    viewers: 1,
    publicationStatus: 'published',
    metaPublishedLabel: '12 ต.ค. เวลา 20:33',
  },
  {
    row: 96,
    groupKey: '861842967267665',
    viewers: 1,
    publicationStatus: 'published',
    metaPublishedLabel: '12 ต.ค. เวลา 20:27',
  },
  {
    row: 97,
    groupKey: '1630598533700689',
    viewers: 1,
    publicationStatus: 'published',
    metaPublishedLabel: '12 ต.ค. เวลา 19:05',
  },
  {
    row: 98,
    groupKey: '243087606396865',
    viewers: 1,
    publicationStatus: 'published',
    metaPublishedLabel: '12 ต.ค. เวลา 19:03',
  },
  { row: 99, groupKey: '244884858861515', viewers: 1, publicationStatus: 'pending' },
  {
    row: 100,
    groupKey: '1781235235507749',
    viewers: 1,
    publicationStatus: 'published',
    metaPublishedLabel: '12 ต.ค. เวลา 18:46',
  },
  {
    row: 101,
    groupKey: '1578765565896832',
    viewers: 1,
    publicationStatus: 'published',
    metaPublishedLabel: '12 ต.ค. เวลา 00:33',
  },
  {
    row: 102,
    groupKey: '335511100155515',
    viewers: 1,
    publicationStatus: 'published',
    metaPublishedLabel: '12 ต.ค. เวลา 00:32',
  },
  {
    row: 103,
    groupKey: '2332092036952396',
    viewers: 1,
    publicationStatus: 'published',
    metaPublishedLabel: '12 ต.ค. เวลา 00:31',
  },
  {
    row: 104,
    groupKey: '286101845724521',
    viewers: 1,
    publicationStatus: 'published',
    metaPublishedLabel: '12 ต.ค. เวลา 00:28',
  },
  {
    row: 105,
    groupKey: '542468432758792',
    viewers: 1,
    publicationStatus: 'published',
    metaPublishedLabel: '12 ต.ค. เวลา 00:28',
  },
  {
    row: 106,
    groupKey: '297143061308143',
    viewers: 1,
    publicationStatus: 'published',
    metaPublishedLabel: '12 ต.ค. เวลา 00:22',
  },
  { row: 107, groupKey: '547707429351851', viewers: 1, publicationStatus: 'pending' },
  {
    row: 108,
    groupKey: '463742223828669',
    viewers: 1,
    publicationStatus: 'published',
    metaPublishedLabel: '12 ต.ค. เวลา 00:16',
  },
  {
    row: 109,
    groupKey: '1995937563955842',
    viewers: 1,
    publicationStatus: 'published',
    metaPublishedLabel: '12 ต.ค. เวลา 00:16',
  },
  {
    row: 110,
    groupKey: '1363023827419590',
    viewers: 1,
    publicationStatus: 'published',
    metaPublishedLabel: '12 ต.ค. เวลา 00:14',
  },
  { row: 111, groupKey: '2218177998322994', viewers: 1, publicationStatus: 'pending' },
  {
    row: 112,
    groupKey: '695459011217047',
    viewers: 1,
    publicationStatus: 'published',
    metaPublishedLabel: '12 ต.ค. เวลา 00:12',
  },
  { row: 113, groupKey: '2087613338176312', viewers: 1, publicationStatus: 'pending' },
  {
    row: 114,
    groupKey: '251379486284817',
    viewers: 1,
    publicationStatus: 'published',
    metaPublishedLabel: '11 ต.ค. เวลา 23:29',
  },
  { row: 115, groupKey: '925914791537235', viewers: 1, publicationStatus: 'pending' },
  { row: 116, groupKey: '1805398209681667', viewers: 1, publicationStatus: 'pending' },
  { row: 117, groupKey: '1899598603545611', viewers: 1, publicationStatus: 'pending' },
];

function groupName(groupKey: string): string {
  const name = /^\d+$/.test(groupKey)
    ? knownFacebookGroupName(groupKey)
    : knownFacebookGroupHandleName(groupKey);
  if (!name) throw new Error(`The supplied Meta group ${groupKey} is not in the group directory.`);
  return name;
}

function matchingGroup(groups: Group[], companyId: string, groupKey: string): Group | undefined {
  const groupUrl = `https://www.facebook.com/groups/${groupKey}/`;
  return groups.find(
    (group) =>
      group.companyId === companyId &&
      (/^\d+$/.test(groupKey) ? group.facebookId === groupKey : group.notes.includes(groupUrl)),
  );
}

/** Add each source row once, without treating a group name as a unique post identity. */
export function addProvidedMetaUnmatchedPosts(workspace: Workspace): Workspace {
  if (workspace.appliedDataUpdates?.includes(PROVIDED_META_UNMATCHED_POSTS_UPDATE))
    return workspace;
  const store = workspace.companies.find((item) => item.id === 'vetra') ?? workspace.companies[0];
  if (!store) throw new Error('A company is required to add the supplied Meta rows.');

  const groups = [...workspace.groups];
  const posts = [...workspace.posts];
  const productId = eshanProductId(workspace);
  const usedRows = new Set<number>();
  for (const item of providedMetaUnmatchedPosts) {
    if (usedRows.has(item.row)) throw new Error('The supplied Meta rows contain a duplicate row.');
    usedRows.add(item.row);
    const id = `provided-meta-row-${item.row}`;
    const existing = posts.find((post) => post.id === id);
    if (existing) {
      if (existing.metaSourceRow !== item.row || existing.metaGroupKey !== item.groupKey)
        throw new Error('A saved post ID conflicts with a supplied Meta row.');
      continue;
    }

    const name = groupName(item.groupKey);
    let group = matchingGroup(groups, store.id, item.groupKey);
    // Respect a group already moved to Trash. The post keeps the source group
    // snapshot, so it remains identifiable even without an active catalog link.
    if (!group && groups.length < 10000) {
      const groupId = `provided-group-${item.groupKey}`;
      if (groups.some((candidate) => candidate.id === groupId))
        throw new Error('A group ID conflicts with the supplied Meta row.');
      group = {
        id: groupId,
        companyId: store.id,
        name,
        facebookId: /^\d+$/.test(item.groupKey) ? item.groupKey : '',
        category: '',
        notes: `https://www.facebook.com/groups/${item.groupKey}/`,
      };
      groups.push(group);
    }
    const activeGroup = group && !group.deletedAt ? group : undefined;
    posts.push({
      id,
      companyId: store.id,
      groupId: activeGroup?.id ?? '',
      ...(activeGroup ? { destinationId: activeGroup.id } : {}),
      product: ESHAN_PRODUCT.name,
      ...(productId ? { productId } : {}),
      platform: 'facebook',
      publicationStatus: item.publicationStatus,
      publishedAt: '',
      metaSourceRow: item.row,
      metaGroupName: name,
      metaGroupKey: item.groupKey,
      ...(item.metaPublishedLabel ? { metaPublishedLabel: item.metaPublishedLabel } : {}),
      facebookPostId: '',
      url: '',
      viewers: item.viewers,
      pinned: false,
      color: store.color,
    });
  }
  return {
    ...workspace,
    groups,
    posts,
    appliedDataUpdates: [
      ...(workspace.appliedDataUpdates ?? []),
      PROVIDED_META_UNMATCHED_POSTS_UPDATE,
    ],
  };
}

export async function ensureProvidedMetaUnmatchedPosts(
  repository: WorkspaceRepository,
  initial: WorkspaceSnapshot,
): Promise<WorkspaceSnapshot> {
  let snapshot = initial;
  for (let attempt = 0; attempt < 3; attempt += 1) {
    const workspace = addProvidedMetaUnmatchedPosts(snapshot.workspace);
    if (workspace === snapshot.workspace) return snapshot;
    try {
      return await repository.commit({
        workspace,
        expectedRevision: snapshot.revision,
        operationId: PROVIDED_META_UNMATCHED_POSTS_UPDATE,
      });
    } catch (error) {
      if (!(error instanceof WorkspaceRevisionConflict)) throw error;
      snapshot = await repository.load();
    }
  }
  throw new WorkspaceRevisionConflict();
}
