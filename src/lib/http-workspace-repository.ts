import type { Workspace } from './types';
import {
  LocalWorkspaceRepository,
  WorkspaceIdentityConflict,
  WorkspaceRevisionConflict,
  WorkspaceUnreadableError,
  type WorkspaceSnapshot,
  type WorkspaceStorage,
} from './workspace-repository';
import { RemoteWorkspaceRepository } from './remote-workspace-repository';
import {
  deserializeWorkspace,
  serializeWorkspace,
  WORKSPACE_BACKUPS,
  WORKSPACE_KEY,
} from './workspace-storage';
import { uploadWorkspaceLabels } from './order-labels';

const endpoint = '/api/workspace';

export function readBrowserMigrationSource(storage: WorkspaceStorage = window.localStorage) {
  for (const { key } of [{ key: WORKSPACE_KEY }, ...WORKSPACE_BACKUPS]) {
    const raw = storage.getItem(key);
    if (raw === null) continue;
    try {
      return { key, raw, workspace: deserializeWorkspace(JSON.parse(raw)) };
    } catch (cause) {
      throw new WorkspaceUnreadableError(cause);
    }
  }
  return null;
}

type WorkspaceState =
  | { kind: 'local' }
  | { kind: 'empty'; scope: string }
  | { kind: 'ready'; scope: string; migrationSourceDigest: string; snapshot: WorkspaceSnapshot };

async function sourceDigest(workspace: Workspace) {
  const bytes = new TextEncoder().encode(JSON.stringify(serializeWorkspace(workspace)));
  const hash = await crypto.subtle.digest('SHA-256', bytes);
  return Array.from(new Uint8Array(hash), (value) => value.toString(16).padStart(2, '0')).join('');
}

export async function browserSourceNeedsReview(digest?: string) {
  if (!digest) return false;
  const source = readBrowserMigrationSource();
  return !!source && (await sourceDigest(source.workspace)) !== digest;
}

async function readResponse(response: Response): Promise<WorkspaceState> {
  const body = await response.json();
  if (response.ok && body.configured === false) return { kind: 'local' };
  if (response.status === 409) {
    if (body.code === 'WORKSPACE_IDENTITY_CONFLICT' && Array.isArray(body.postIds))
      throw new WorkspaceIdentityConflict(body.postIds as [string, string]);
    if (body.code === 'WORKSPACE_REVISION_CONFLICT') throw new WorkspaceRevisionConflict();
    if (body.code === 'EXISTING_WORKSPACE_ROWS')
      throw new Error(
        'MongoDB already contains workspace records. Review the existing data before importing.',
      );
  }
  if (body.configured === true && typeof body.databaseScope === 'string' && body.databaseScope) {
    if (response.status === 404 && body.code === 'WORKSPACE_NOT_INITIALIZED')
      return { kind: 'empty', scope: body.databaseScope };
    if (response.ok && typeof body.revision === 'string' && body.revision)
      return {
        kind: 'ready',
        scope: body.databaseScope,
        migrationSourceDigest: body.migrationSourceDigest,
        snapshot: {
          workspace: deserializeWorkspace(body.workspace),
          revision: body.revision,
        },
      };
  }
  if (body.code === 'LOCAL_ACCESS_REQUIRED')
    throw new Error('Open the workspace on the configured localhost address to access MongoDB.');
  throw new Error(
    typeof body.message === 'string' ? body.message : 'Could not access the MongoDB workspace.',
  );
}

async function getState() {
  return readResponse(await fetch(endpoint, { cache: 'no-store' }));
}

export async function connectWorkspace(onCacheError: () => void) {
  const initial = await getState();
  if (initial.kind === 'local')
    return {
      store: new LocalWorkspaceRepository(),
      mode: 'local' as const,
      initialize: null,
      migrationSourceDigest: undefined,
    };

  const scope = initial.scope;
  const confirmedLabels = new Set<string>();
  let firstRead = initial.kind === 'ready' ? initial : null;
  let revision: string | null = initial.kind === 'ready' ? initial.snapshot.revision : null;
  const accept = (state: WorkspaceState) => {
    if (state.kind !== 'ready' || state.scope !== scope)
      throw new Error('The database workspace changed. Reload to reconnect.');
    revision = state.snapshot.revision;
    for (const order of state.snapshot.workspace.orders ?? [])
      if (order.label) confirmedLabels.add(order.label.id);
    return state.snapshot;
  };
  const load = async () => {
    if (firstRead) {
      const saved = firstRead;
      firstRead = null;
      return accept(saved);
    }
    return accept(await getState());
  };
  const save = async (
    workspace: Workspace,
    expectedRevision: string | null,
    operationId: string,
  ) => {
    await uploadWorkspaceLabels(workspace, confirmedLabels);
    const body = JSON.stringify({
      workspace: serializeWorkspace(workspace),
      expectedRevision,
      operationId,
      databaseScope: scope,
    });
    const send = () =>
      fetch(endpoint, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body });
    // Reuse the same operation ID if the connection drops before a response arrives.
    const response = await send().catch(() => send());
    const snapshot = accept(await readResponse(response));
    firstRead = null;
    return snapshot;
  };
  const store = new RemoteWorkspaceRepository({
    cacheScope: { userId: 'local-operator', workspaceId: scope },
    onCacheError,
    remote: {
      load,
      commit: ({ workspace, expectedRevision, operationId }) =>
        save(workspace, expectedRevision, operationId),
      recover: (workspace) => save(workspace, revision, crypto.randomUUID()),
      subscribe(listener) {
        let active = true;
        let seq = 0;
        const onStorage = (event: StorageEvent) => {
          if (event.key !== store.cacheKey || !event.newValue) return;
          const id = ++seq;
          const base = revision;
          void getState()
            .then((state) => {
              if (
                active &&
                id === seq &&
                base === revision &&
                state.kind === 'ready' &&
                state.snapshot.revision !== revision
              )
                listener(accept(state));
            })
            .catch(() => {
              /* A later read or save checks the server's current revision. */
            });
        };
        window.addEventListener('storage', onStorage);
        return () => {
          active = false;
          window.removeEventListener('storage', onStorage);
        };
      },
    },
  });
  const initialize =
    initial.kind === 'empty'
      ? async (workspace: Workspace) => {
          const digest = await sourceDigest(workspace);
          await save(workspace, null, `browser-import-${digest}`);
          const verified = await getState();
          if (
            verified.kind !== 'ready' ||
            verified.scope !== scope ||
            verified.migrationSourceDigest !== digest
          )
            throw new Error('Could not verify the imported workspace. Reload to check MongoDB.');
          return accept(verified);
        }
      : null;
  return {
    store,
    mode: 'mongo' as const,
    initialize,
    migrationSourceDigest: initial.kind === 'ready' ? initial.migrationSourceDigest : undefined,
  };
}
