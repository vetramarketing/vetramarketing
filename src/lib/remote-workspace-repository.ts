import { pruneTrash } from './data';
import type { Locale } from './types';
import {
  LocalWorkspaceRepository,
  WorkspaceStorageError,
  WorkspaceUnreadableError,
  type WorkspaceEventSource,
  type WorkspaceRepository,
  type WorkspaceSnapshot,
  type WorkspaceStorage,
} from './workspace-repository';
import { deserializeWorkspace, serializeWorkspace } from './workspace-storage';

export const REMOTE_CACHE_PREFIX = 'vetra-marketing.remote-cache.v1';
export interface CachedWorkspace extends WorkspaceSnapshot {
  /** Older cached snapshots predate timestamp recording. */
  syncedAt: string | null;
}

/** The API implementation supplies authorization and database-backed revisions. */
export type RemoteWorkspaceSource = Pick<
  WorkspaceRepository,
  'load' | 'commit' | 'recover' | 'subscribe'
>;

export interface RemoteWorkspaceOptions {
  remote: RemoteWorkspaceSource;
  cacheScope: { userId: string; workspaceId: string };
  storage?: WorkspaceStorage;
  eventSource?: WorkspaceEventSource | null;
  onCacheError?: (error: WorkspaceStorageError) => void;
}

function scopePart(value: string): string {
  const trimmed = value.trim();
  if (!trimmed || trimmed.length > 200) throw new Error('A signed-in cache scope is required.');
  // Length prefixes prevent collisions when IDs themselves contain the key separator.
  return `${trimmed.length}-${encodeURIComponent(trimmed)}`;
}

function scopedKey(scope: RemoteWorkspaceOptions['cacheScope']) {
  return `${REMOTE_CACHE_PREFIX}.${scopePart(scope.userId)}.${scopePart(scope.workspaceId)}`;
}

export function readScopedWorkspaceCache(
  scope: RemoteWorkspaceOptions['cacheScope'],
  storage: WorkspaceStorage = window.localStorage,
): CachedWorkspace | null {
  const raw = storage.getItem(scopedKey(scope));
  if (!raw) return null;
  try {
    const record = JSON.parse(raw);
    if (!record || typeof record.revision !== 'string' || !record.revision.trim())
      throw new Error('Invalid cache revision.');
    const syncedAt = record.syncedAt ?? null;
    if (
      syncedAt !== null &&
      (typeof syncedAt !== 'string' || new Date(syncedAt).toISOString() !== syncedAt)
    )
      throw new Error('Invalid cache timestamp.');
    return {
      workspace: deserializeWorkspace(record.workspace),
      revision: record.revision,
      syncedAt,
    };
  } catch (error) {
    throw new WorkspaceUnreadableError(error);
  }
}

/** A cached view has no write transport or migration/recovery operations. */
export function readOnlyWorkspaceRepository(snapshot: CachedWorkspace): WorkspaceRepository {
  const unavailable = async () => {
    throw new Error('Reconnect to MongoDB to save changes.');
  };
  return {
    load: async () => structuredClone(snapshot),
    commit: unavailable,
    recover: unavailable,
    subscribe: () => () => {},
    readPreservedRaw: () => null,
    listOlderBackups: () => [],
    readOlderBackup: () => null,
    readLocale: () => new LocalWorkspaceRepository().readLocale(),
    writeLocale: () => {},
  };
}

function validatedSnapshot(snapshot: WorkspaceSnapshot): WorkspaceSnapshot {
  if (typeof snapshot.revision !== 'string' || !snapshot.revision.trim())
    throw new WorkspaceUnreadableError('The API response has no revision.');
  try {
    return {
      revision: snapshot.revision,
      workspace: pruneTrash(deserializeWorkspace(serializeWorkspace(snapshot.workspace))),
    };
  } catch (cause) {
    throw new WorkspaceUnreadableError(cause);
  }
}

/**
 * Remote snapshots are authoritative. Browser storage is a separate, scoped copy
 * for recovery/read-only use; it is never used as a silent write fallback.
 */
export class RemoteWorkspaceRepository implements WorkspaceRepository {
  readonly cacheKey: string;
  private readonly local: LocalWorkspaceRepository;
  private readonly remote: RemoteWorkspaceSource;
  private readonly storageOverride?: WorkspaceStorage;
  private readonly onCacheError?: (error: WorkspaceStorageError) => void;

  private readonly scope: RemoteWorkspaceOptions['cacheScope'];
  constructor({ remote, cacheScope, storage, eventSource, onCacheError }: RemoteWorkspaceOptions) {
    this.remote = remote;
    this.storageOverride = storage;
    this.local = new LocalWorkspaceRepository(storage, eventSource);
    this.onCacheError = onCacheError;
    this.scope = cacheScope;
    this.cacheKey = scopedKey(cacheScope);
  }

  private get storage(): WorkspaceStorage {
    if (this.storageOverride) return this.storageOverride;
    if (typeof window === 'undefined') throw new WorkspaceStorageError('No browser storage');
    return window.localStorage;
  }

  private remember(snapshot: WorkspaceSnapshot): WorkspaceSnapshot {
    const safe = validatedSnapshot(snapshot);
    try {
      this.storage.setItem(
        this.cacheKey,
        JSON.stringify({
          revision: safe.revision,
          syncedAt: new Date().toISOString(),
          workspace: serializeWorkspace(safe.workspace),
        }),
      );
    } catch (cause) {
      // The database write may already have succeeded. Cache failure cannot turn it
      // into an apparent save failure, which could cause the user to retry blindly.
      try {
        this.onCacheError?.(new WorkspaceStorageError(cause));
      } catch {
        // Reporting a cache warning must not change the remote operation result.
      }
    }
    return safe;
  }

  /** Only an explicit read-only recovery flow should display this cached copy. */
  readCachedSnapshot(): CachedWorkspace | null {
    return readScopedWorkspaceCache(this.scope, this.storage);
  }

  async load(): Promise<WorkspaceSnapshot> {
    return this.remember(await this.remote.load());
  }

  async commit(input: Parameters<WorkspaceRepository['commit']>[0]): Promise<WorkspaceSnapshot> {
    return this.remember(await this.remote.commit(input));
  }

  async recover(
    workspace: Parameters<WorkspaceRepository['recover']>[0],
  ): Promise<WorkspaceSnapshot> {
    return this.remember(await this.remote.recover(workspace));
  }

  subscribe(listener: Parameters<WorkspaceRepository['subscribe']>[0]): () => void {
    return this.remote.subscribe((result) => {
      if (result instanceof Error) {
        listener(result);
        return;
      }
      try {
        listener(this.remember(result));
      } catch (error) {
        listener(error instanceof Error ? error : new WorkspaceUnreadableError(error));
      }
    });
  }

  readPreservedRaw(): string | null {
    return this.local.readPreservedRaw();
  }

  listOlderBackups(): ReturnType<WorkspaceRepository['listOlderBackups']> {
    return this.local.listOlderBackups();
  }

  readOlderBackup(key: string): string | null {
    return this.local.readOlderBackup(key);
  }

  readLocale(): Locale {
    return this.local.readLocale();
  }

  writeLocale(locale: Locale): void {
    this.local.writeLocale(locale);
  }
}

/** Keep the browser provider active until a real authenticated API is supplied. */
export function createBrowserWorkspaceRepository(
  options?: RemoteWorkspaceOptions,
): WorkspaceRepository {
  return options ? new RemoteWorkspaceRepository(options) : new LocalWorkspaceRepository();
}
