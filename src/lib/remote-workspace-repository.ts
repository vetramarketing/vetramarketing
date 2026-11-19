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

  constructor({ remote, cacheScope, storage, eventSource, onCacheError }: RemoteWorkspaceOptions) {
    this.remote = remote;
    this.storageOverride = storage;
    this.local = new LocalWorkspaceRepository(storage, eventSource);
    this.onCacheError = onCacheError;
    this.cacheKey = `${REMOTE_CACHE_PREFIX}.${scopePart(cacheScope.userId)}.${scopePart(cacheScope.workspaceId)}`;
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
        JSON.stringify({ revision: safe.revision, workspace: serializeWorkspace(safe.workspace) }),
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
  readCachedSnapshot(): WorkspaceSnapshot | null {
    let raw: string | null;
    try {
      raw = this.storage.getItem(this.cacheKey);
    } catch (cause) {
      throw new WorkspaceStorageError(cause);
    }
    if (raw === null) return null;
    try {
      const parsed: unknown = JSON.parse(raw);
      if (!parsed || typeof parsed !== 'object') throw new Error('Invalid cached workspace.');
      const record = parsed as Record<string, unknown>;
      return validatedSnapshot({
        revision: record.revision as string,
        workspace: deserializeWorkspace(record.workspace),
      });
    } catch (cause) {
      throw new WorkspaceUnreadableError(cause);
    }
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
