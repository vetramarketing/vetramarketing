import { createEmptyWorkspace, pruneTrash } from './data';
import { newDuplicatePair } from './post-identity';
import type { Locale, Workspace } from './types';
import {
  deserializeWorkspace,
  WORKSPACE_BACKUPS,
  serializeWorkspace,
  WORKSPACE_KEY,
} from './workspace-storage';

const LOCALE_KEY = 'vetra-marketing.locale';

export interface WorkspaceSnapshot {
  workspace: Workspace;
  revision: string;
}

export interface WorkspaceStorage {
  getItem(key: string): string | null;
  setItem(key: string, value: string): void;
}

export interface WorkspaceEventSource {
  addEventListener(type: 'storage', listener: (event: StorageEvent) => void): void;
  removeEventListener(type: 'storage', listener: (event: StorageEvent) => void): void;
}

export interface WorkspaceRepository {
  load(): Promise<WorkspaceSnapshot>;
  commit(input: {
    workspace: Workspace;
    expectedRevision: string;
    operationId: string;
  }): Promise<WorkspaceSnapshot>;
  recover(workspace: Workspace): Promise<WorkspaceSnapshot>;
  subscribe(listener: (snapshot: WorkspaceSnapshot | Error) => void): () => void;
  readPreservedRaw(): string | null;
  listOlderBackups(): Array<{ key: string; version: string }>;
  readOlderBackup(key: string): string | null;
  readLocale(): Locale;
  writeLocale(locale: Locale): void;
}

export class WorkspaceRevisionConflict extends Error {
  readonly code = 'WORKSPACE_REVISION_CONFLICT';

  constructor() {
    super('The workspace changed since it was loaded. Reload it before saving.');
    this.name = 'WorkspaceRevisionConflict';
  }
}

export class WorkspaceUnreadableError extends Error {
  readonly code = 'WORKSPACE_UNREADABLE';

  constructor(cause: unknown) {
    super('Saved workspace data could not be read. It has been preserved.', { cause });
    this.name = 'WorkspaceUnreadableError';
  }
}

export class WorkspaceStorageError extends Error {
  readonly code = 'WORKSPACE_STORAGE_ERROR';

  constructor(cause: unknown) {
    super('Browser storage is unavailable. Your saved workspace was not changed.', { cause });
    this.name = 'WorkspaceStorageError';
  }
}

export class WorkspaceRemovedError extends Error {
  readonly code = 'WORKSPACE_REMOVED';

  constructor() {
    super('Saved workspace data was removed in another tab. Restore a backup before editing.');
    this.name = 'WorkspaceRemovedError';
  }
}

export class WorkspaceIdentityConflict extends Error {
  readonly code = 'WORKSPACE_IDENTITY_CONFLICT';

  constructor(readonly postIds: [string, string]) {
    super('This post already has an active record. Only one copy can be active at a time.');
    this.name = 'WorkspaceIdentityConflict';
  }
}

function fromRaw(raw: string): Workspace {
  try {
    return pruneTrash(deserializeWorkspace(JSON.parse(raw)));
  } catch (cause) {
    throw new WorkspaceUnreadableError(cause);
  }
}

function toStored(workspace: Workspace): { workspace: Workspace; raw: string } {
  // Round-trip through the active storage contract before persisting. This applies
  // the same validation, generated labels, and Trash cleanup as the current app.
  const normalized = pruneTrash(deserializeWorkspace(serializeWorkspace(workspace)));
  return { workspace: normalized, raw: JSON.stringify(serializeWorkspace(normalized)) };
}

async function revisionOf(raw: string): Promise<string> {
  const digest = await crypto.subtle.digest('SHA-256', new TextEncoder().encode(raw));
  return Array.from(new Uint8Array(digest), (byte) => byte.toString(16).padStart(2, '0')).join('');
}

/** Browser implementation of the future workspace API boundary. No network is used. */
export class LocalWorkspaceRepository implements WorkspaceRepository {
  private readonly storageOverride?: WorkspaceStorage;
  private readonly eventSourceOverride?: WorkspaceEventSource | null;
  private readonly completedOperations = new Map<string, string>();
  private queue: Promise<void> = Promise.resolve();

  constructor(storage?: WorkspaceStorage, eventSource?: WorkspaceEventSource | null) {
    this.storageOverride = storage;
    this.eventSourceOverride = eventSource;
  }

  private get storage(): WorkspaceStorage {
    if (this.storageOverride) return this.storageOverride;
    if (typeof window === 'undefined') throw new WorkspaceStorageError('No browser storage');
    return window.localStorage;
  }

  private get eventSource(): WorkspaceEventSource | null {
    if (this.eventSourceOverride !== undefined) return this.eventSourceOverride;
    return typeof window === 'undefined' ? null : window;
  }

  private read(key: string): string | null {
    try {
      return this.storage.getItem(key);
    } catch (cause) {
      throw new WorkspaceStorageError(cause);
    }
  }

  private write(key: string, value: string): void {
    try {
      this.storage.setItem(key, value);
    } catch (cause) {
      throw new WorkspaceStorageError(cause);
    }
  }

  private runSerial<T>(work: () => Promise<T>): Promise<T> {
    const pending = this.queue.then(work);
    this.queue = pending.then(
      () => undefined,
      () => undefined,
    );
    return pending;
  }

  load(): Promise<WorkspaceSnapshot> {
    return this.runSerial(() => this.loadUnlocked());
  }

  private async loadUnlocked(requireExisting = false): Promise<WorkspaceSnapshot> {
    // Retry if another tab changes the active key while a revision is calculated.
    for (let attempt = 0; attempt < 3; attempt += 1) {
      const activeRaw = this.read(WORKSPACE_KEY);
      if (requireExisting && activeRaw === null) throw new WorkspaceRemovedError();
      let sourceRaw = activeRaw;
      if (sourceRaw === null) {
        for (const { key } of WORKSPACE_BACKUPS) {
          sourceRaw = this.read(key);
          if (sourceRaw !== null) break;
        }
      }
      const workspace = sourceRaw === null ? createEmptyWorkspace() : fromRaw(sourceRaw);
      const stored = toStored(workspace);
      const revision = await revisionOf(stored.raw);
      if (this.read(WORKSPACE_KEY) !== activeRaw) continue;
      if (activeRaw !== stored.raw) this.write(WORKSPACE_KEY, stored.raw);
      if (this.read(WORKSPACE_KEY) !== stored.raw) continue;
      return { workspace: stored.workspace, revision };
    }
    throw new WorkspaceRevisionConflict();
  }

  commit({
    workspace,
    expectedRevision,
    operationId,
  }: {
    workspace: Workspace;
    expectedRevision: string;
    operationId: string;
  }): Promise<WorkspaceSnapshot> {
    return this.runSerial(async () => {
      if (!operationId.trim()) throw new Error('A save operation ID is required.');
      const stored = toStored(workspace);
      const nextRevision = await revisionOf(stored.raw);
      const activeRaw = this.read(WORKSPACE_KEY);
      if (activeRaw === null) throw new WorkspaceRevisionConflict();
      const activeWorkspace = fromRaw(activeRaw); // A stale save must never overwrite unreadable data.
      const activeRevision = await revisionOf(activeRaw);
      if (this.read(WORKSPACE_KEY) !== activeRaw) throw new WorkspaceRevisionConflict();

      // Same-instance retries can acknowledge a successful write whose response was lost.
      // A future server must persist operation IDs to provide this across reloads.
      const completedRaw = this.completedOperations.get(operationId);
      if (completedRaw !== undefined) {
        if (completedRaw !== stored.raw || activeRaw !== completedRaw)
          throw new WorkspaceRevisionConflict();
        return { workspace: stored.workspace, revision: activeRevision };
      }
      if (activeRevision !== expectedRevision) throw new WorkspaceRevisionConflict();
      const duplicate = newDuplicatePair(activeWorkspace, stored.workspace);
      if (duplicate) throw new WorkspaceIdentityConflict(duplicate);

      this.write(WORKSPACE_KEY, stored.raw);
      this.completedOperations.set(operationId, stored.raw);
      if (this.completedOperations.size > 100) {
        const oldest = this.completedOperations.keys().next().value;
        if (oldest) this.completedOperations.delete(oldest);
      }
      return { workspace: stored.workspace, revision: nextRevision };
    });
  }

  /** Explicit replacement for a confirmed backup restore or storage recovery. */
  recover(workspace: Workspace): Promise<WorkspaceSnapshot> {
    return this.runSerial(async () => {
      const stored = toStored(workspace);
      const revision = await revisionOf(stored.raw);
      this.write(WORKSPACE_KEY, stored.raw);
      this.completedOperations.clear();
      return { workspace: stored.workspace, revision };
    });
  }

  subscribe(listener: (snapshot: WorkspaceSnapshot | Error) => void): () => void {
    const source = this.eventSource;
    if (!source) return () => {};
    let active = true;
    let sequence = 0;
    const onStorage = (event: StorageEvent) => {
      if (event.key !== WORKSPACE_KEY) return;
      const current = ++sequence;
      if (event.newValue === null) {
        listener(new WorkspaceRemovedError());
        return;
      }
      void this.runSerial(() => this.loadUnlocked(true)).then(
        (snapshot) => {
          if (active && current === sequence) listener(snapshot);
        },
        (error: unknown) => {
          if (active && current === sequence)
            listener(error instanceof Error ? error : new Error('Workspace update failed.'));
        },
      );
    };
    source.addEventListener('storage', onStorage);
    return () => {
      active = false;
      source.removeEventListener('storage', onStorage);
    };
  }

  readPreservedRaw(): string | null {
    return this.read(WORKSPACE_KEY);
  }

  listOlderBackups(): Array<{ key: string; version: string }> {
    return WORKSPACE_BACKUPS.filter(({ key }) => this.read(key) !== null);
  }

  readOlderBackup(key: string): string | null {
    if (!WORKSPACE_BACKUPS.some((backup) => backup.key === key)) return null;
    return this.read(key);
  }

  readLocale(): Locale {
    return this.read(LOCALE_KEY) === 'en' ? 'en' : 'th';
  }

  writeLocale(locale: Locale): void {
    if (locale !== 'th' && locale !== 'en') throw new Error('Unsupported language.');
    this.write(LOCALE_KEY, locale);
  }
}
