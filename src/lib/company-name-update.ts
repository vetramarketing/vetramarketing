import type { Workspace } from './types';
import {
  WorkspaceRevisionConflict,
  type WorkspaceRepository,
  type WorkspaceSnapshot,
} from './workspace-repository';

export const VETRA_STORE_NAME_UPDATE = 'vetra-store-uppercase-2026-10-17';

/** Rename only the exact legacy name, without changing company IDs or other saved fields. */
export function renameVetraCompany(workspace: Workspace): Workspace {
  if (workspace.appliedDataUpdates?.includes(VETRA_STORE_NAME_UPDATE)) return workspace;
  if (!workspace.companies.some((store) => store.name === 'VETRA Store')) return workspace;
  return {
    ...workspace,
    companies: workspace.companies.map((store) =>
      store.name === 'VETRA Store' ? { ...store, name: 'VETRA STORE' } : store,
    ),
    appliedDataUpdates: [...(workspace.appliedDataUpdates ?? []), VETRA_STORE_NAME_UPDATE],
  };
}

/** Persist the one-time rename against the latest workspace revision. */
export async function ensureVetraCompanyName(
  repository: WorkspaceRepository,
  initial: WorkspaceSnapshot,
): Promise<WorkspaceSnapshot> {
  let snapshot = initial;
  for (let attempt = 0; attempt < 3; attempt += 1) {
    const workspace = renameVetraCompany(snapshot.workspace);
    if (workspace === snapshot.workspace) return snapshot;
    try {
      return await repository.commit({
        workspace,
        expectedRevision: snapshot.revision,
        operationId: VETRA_STORE_NAME_UPDATE,
      });
    } catch (error) {
      if (!(error instanceof WorkspaceRevisionConflict)) throw error;
      snapshot = await repository.load();
    }
  }
  throw new WorkspaceRevisionConflict();
}
