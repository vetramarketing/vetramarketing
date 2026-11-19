import suppliedGroups from './provided-software-groups.json';
import { nextSortOrder } from './catalog';
import { facebookGroupKeyFromText } from './facebook-group-link';
import type { Company, Workspace } from './types';
import {
  WorkspaceRevisionConflict,
  type WorkspaceRepository,
  type WorkspaceSnapshot,
} from './workspace-repository';

export const SOFTWARE_GROUPS_UPDATE = 'vetra-software-groups-2026-11-05';
export const providedSoftwareGroups = suppliedGroups;

/** Add the supplied communities once, retaining existing IDs, custom details, and Trash. */
export function addProvidedSoftwareGroups(workspace: Workspace): Workspace {
  if (workspace.appliedDataUpdates?.includes(SOFTWARE_GROUPS_UPDATE)) return workspace;
  const matches = workspace.companies.filter(
    (company) => company.name.trim().replace(/\s+/g, ' ').toLowerCase() === 'vetra software',
  );
  if (matches.length > 1) throw new Error('More than one company is named VETRA Software.');
  let company = matches[0] as Company | undefined;
  if (!company) {
    if (workspace.companies.some((item) => item.id === 'vetra-software'))
      throw new Error('The VETRA Software company ID is already used by another company.');
    if (workspace.companies.length >= 100) throw new Error('Company catalog is full.');
    const businessType = workspace.businessTypes.find((item) => item.id === 'software-house');
    if (!businessType) throw new Error('A software house business type is required.');
    company = {
      id: 'vetra-software',
      name: 'VETRA Software',
      businessTypeId: businessType.id,
      logoImageUrl: '',
      ownerName: '',
      sortOrder: nextSortOrder(workspace.companies),
      initials: 'V',
      color: '#263b4b',
      description: '',
    };
  }
  const companyId = company.id;
  const keys = new Set<string>();
  const companyGroups = workspace.groups.filter((item) => item.companyId === companyId);
  const groupIds = new Set(companyGroups.map((group) => group.id));
  for (const group of companyGroups) {
    if (group.facebookId) keys.add(group.facebookId);
    const key = facebookGroupKeyFromText(group.notes);
    if (key) keys.add(key.toLowerCase());
  }
  for (const post of workspace.posts) {
    if (!groupIds.has(post.groupId)) continue;
    const key = facebookGroupKeyFromText(post.url);
    if (key) keys.add(key.toLowerCase());
  }
  const groups = [...workspace.groups];
  for (const { key, name } of suppliedGroups) {
    if (keys.has(key.toLowerCase())) continue;
    const id = `provided-software-group-${key}`;
    if (groups.some((group) => group.id === id)) throw new Error('Supplied group ID conflicts.');
    if (groups.length >= 10000) throw new Error('Group catalog is full.');
    groups.push({
      id,
      companyId,
      name,
      facebookId: /^\d+$/.test(key) ? key : '',
      category: '',
      notes: `https://www.facebook.com/groups/${key}/`,
    });
    keys.add(key.toLowerCase());
  }
  return {
    ...workspace,
    companies: matches.length ? workspace.companies : [...workspace.companies, company],
    groups,
    appliedDataUpdates: [...(workspace.appliedDataUpdates ?? []), SOFTWARE_GROUPS_UPDATE],
  };
}

/** Save against the latest revision so concurrent edits are retained. */
export async function ensureProvidedSoftwareGroups(
  repository: WorkspaceRepository,
  initial: WorkspaceSnapshot,
): Promise<WorkspaceSnapshot> {
  let snapshot = initial;
  for (let attempt = 0; attempt < 3; attempt += 1) {
    const workspace = addProvidedSoftwareGroups(snapshot.workspace);
    if (workspace === snapshot.workspace) return snapshot;
    try {
      return await repository.commit({
        workspace,
        expectedRevision: snapshot.revision,
        operationId: SOFTWARE_GROUPS_UPDATE,
      });
    } catch (error) {
      if (!(error instanceof WorkspaceRevisionConflict)) throw error;
      snapshot = await repository.load();
    }
  }
  throw new WorkspaceRevisionConflict();
}
