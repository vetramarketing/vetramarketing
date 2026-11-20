import { createHash, randomUUID } from 'node:crypto';
import { MongoServerError, type AnyBulkWriteOperation, type ClientSession, type Db } from 'mongodb';
import { newDuplicatePair } from '../post-identity';
import {
  deserializeWorkspace,
  serializeWorkspace,
  type StoredWorkspaceV12,
} from '../workspace-storage';
import { migrateWorkspaceMedia, type MediaOptions } from './workspace-media';
import { assertStoredLabels } from './mongo-labels';
import { cleanupStagedImages, commitStagedReferences, resolveStagedImage } from './staged-images';

import { MongoWorkspaceError, workspaceConnection } from './workspace-database';
export {
  MongoWorkspaceError,
  getWorkspaceMongoDb,
  closeWorkspaceMongoDb,
  configuredWorkspaceScope,
  workspaceDatabaseScope,
} from './workspace-database';

const workspaceId = 'vetra-marketing';
const entitySets = [
  'companies',
  'businessTypes',
  'customers',
  'scripts',
  'orders',
  'products',
  'groups',
  'destinations',
  'posts',
] as const;
type EntitySet = (typeof entitySets)[number];
type RecordValue = NonNullable<StoredWorkspaceV12[EntitySet]>[number];
type EntityDocument = { _id: string; position: number; value: RecordValue };
type Head = {
  _id: string;
  revision: string;
  digest: string;
  migrationSourceDigest: string;
  metadata: Omit<StoredWorkspaceV12, EntitySet>;
};
type Receipt = {
  _id: string;
  expectedRevision: string | null;
  requestDigest: string;
  verifyLabelBytes?: boolean;
  revision: string;
};
export type MongoWorkspaceSnapshot = {
  workspace: StoredWorkspaceV12;
  revision: string;
  databaseScope: string;
  migrationSourceDigest: string;
};
export type MongoWorkspaceWrite = {
  workspace: unknown;
  expectedRevision: string | null;
  operationId: string;
  verifyLabelBytes?: boolean;
};

const conflict = () => new MongoWorkspaceError('WORKSPACE_REVISION_CONFLICT', 409);
const digest = (value: string) => createHash('sha256').update(value).digest('hex');

const heads = (db: Db) => db.collection<Head>('vetra_workspace');
const receipts = (db: Db) => db.collection<Receipt>('vetra_operations');
const rows = (db: Db, key: EntitySet) => db.collection<EntityDocument>('vetra_' + key);
const transaction = {
  readConcern: { level: 'snapshot' },
  writeConcern: { w: 'majority' },
  readPreference: 'primary',
} as const;

async function readSnapshot(
  db: Db,
  scope: string,
  session: ClientSession,
): Promise<MongoWorkspaceSnapshot | null> {
  const head = await heads(db).findOne({ _id: workspaceId }, { session });
  if (!head) return null;
  const input: Record<string, unknown> = { ...head.metadata };
  for (const key of entitySets) {
    const records = await rows(db, key).find({}, { session }).toArray();
    records.sort((a, b) => a.position - b.position);
    input[key] = records.map((row, index) => {
      if (row.position !== index || row._id !== row.value.id)
        throw new MongoWorkspaceError('WORKSPACE_UNREADABLE', 500);
      return row.value;
    });
  }
  const workspace = serializeWorkspace(deserializeWorkspace(input));
  if (digest(JSON.stringify(workspace)) !== head.digest)
    throw new MongoWorkspaceError('WORKSPACE_UNREADABLE', 500);
  return {
    workspace,
    revision: head.revision,
    migrationSourceDigest: head.migrationSourceDigest,
    databaseScope: scope,
  };
}

export async function readMongoWorkspace(): Promise<MongoWorkspaceSnapshot | null> {
  const { client, db, scope } = await workspaceConnection();
  return client.withSession((session) =>
    session.withTransaction(() => readSnapshot(db, scope, session), transaction),
  );
}

export async function cleanupWorkspaceImages(id: string | null, options: MediaOptions = {}) {
  const { db, scope } = await workspaceConnection();
  return cleanupStagedImages(
    db,
    async (session) => (await readSnapshot(db, scope, session))?.workspace,
    id,
    options,
  );
}

async function updateRows(
  db: Db,
  session: ClientSession,
  key: EntitySet,
  before: RecordValue[],
  after: RecordValue[],
) {
  const previous = new Map(before.map((record, position) => [record.id, { record, position }]));
  const changes: AnyBulkWriteOperation<EntityDocument>[] = [];
  for (const [position, value] of after.entries()) {
    const old = previous.get(value.id);
    previous.delete(value.id);
    if (old?.position === position && JSON.stringify(old.record) === JSON.stringify(value))
      continue;
    const document = { _id: value.id, position, value };
    changes.push(
      old
        ? { replaceOne: { filter: { _id: value.id }, replacement: document } }
        : { insertOne: { document } },
    );
  }
  if (previous.size)
    changes.push({ deleteMany: { filter: { _id: { $in: [...previous.keys()] } } } });
  if (changes.length) await rows(db, key).bulkWrite(changes, { session });
}

/** Compare and swap the revision, changed records and persistent retry receipt in one transaction. */
export async function writeMongoWorkspace({
  workspace: input,
  expectedRevision,
  operationId,
  verifyLabelBytes = false,
}: MongoWorkspaceWrite): Promise<MongoWorkspaceSnapshot> {
  if (
    typeof operationId !== 'string' ||
    !operationId.trim() ||
    operationId.length > 200 ||
    !(
      expectedRevision === null ||
      (typeof expectedRevision === 'string' &&
        expectedRevision.length > 0 &&
        expectedRevision.length <= 100)
    )
  ) {
    throw new MongoWorkspaceError('INVALID_REQUEST', 400);
  }
  let canonical;
  try {
    canonical = serializeWorkspace(deserializeWorkspace(input));
  } catch {
    throw new MongoWorkspaceError('INVALID_WORKSPACE', 400);
  }
  const requestDigest = digest(JSON.stringify(canonical));
  const { client, db, scope } = await workspaceConnection();
  const replay = (record: Receipt | null, current: MongoWorkspaceSnapshot | null) => {
    if (!record) return null;
    if (
      record.expectedRevision !== expectedRevision ||
      record.requestDigest !== requestDigest ||
      (record.verifyLabelBytes === true) !== verifyLabelBytes ||
      record.revision !== current?.revision
    )
      throw conflict();
    return current;
  };
  const { before, repeated } = await client.withSession((session) =>
    session.withTransaction(async () => {
      const before = await readSnapshot(db, scope, session);
      return {
        before,
        repeated: replay(await receipts(db).findOne({ _id: operationId }, { session }), before),
      };
    }, transaction),
  );
  if (repeated) return repeated;
  if ((before?.revision ?? null) !== expectedRevision) throw conflict();
  const workspace = deserializeWorkspace(canonical);
  const priorWorkspace = before && deserializeWorkspace(before.workspace);
  if (priorWorkspace) {
    const pair = newDuplicatePair(priorWorkspace, workspace);
    if (pair) throw new MongoWorkspaceError('WORKSPACE_IDENTITY_CONFLICT', 409, pair);
  }
  await assertStoredLabels(workspace, db);
  const prepared = serializeWorkspace(
    await migrateWorkspaceMedia(workspace, workspaceId, {
      previous: priorWorkspace ?? undefined,
      staged: (url, target) => resolveStagedImage(db, url, target),
    }),
  );
  const revision = randomUUID();
  const migrationSourceDigest = before?.migrationSourceDigest ?? requestDigest;
  const metadata = Object.fromEntries(
    Object.entries(prepared).filter(([key]) => !entitySets.some((set) => set === key)),
  ) as Head['metadata'];
  const head: Head = {
    _id: workspaceId,
    metadata,
    revision,
    migrationSourceDigest,
    digest: digest(JSON.stringify(prepared)),
  };
  try {
    return await client.withSession((session) =>
      session.withTransaction(async () => {
        const current = await heads(db).findOne({ _id: workspaceId }, { session });
        const receipt = await receipts(db).findOne({ _id: operationId }, { session });
        if (receipt) {
          const result = replay(receipt, await readSnapshot(db, scope, session));
          if (result) return result;
        }
        if ((current?.revision ?? null) !== expectedRevision) throw conflict();
        // Confirm restore dependencies against the same snapshot as the replacement.
        if (verifyLabelBytes || expectedRevision === null)
          await assertStoredLabels(workspace, db, { verifyBytes: true, session });
        await commitStagedReferences(db, session, prepared);
        if (current) {
          const updated = await heads(db).replaceOne(
            { _id: workspaceId, revision: expectedRevision! },
            head,
            { session },
          );
          if (!updated.matchedCount) throw conflict();
        } else {
          for (const key of entitySets) {
            if (await rows(db, key).findOne({}, { session, projection: { _id: 1 } }))
              throw new MongoWorkspaceError('EXISTING_WORKSPACE_ROWS', 409);
          }
          await heads(db).insertOne(head, { session });
        }
        for (const key of entitySets)
          await updateRows(db, session, key, before?.workspace[key] ?? [], prepared[key] ?? []);
        await receipts(db).insertOne(
          {
            _id: operationId,
            expectedRevision,
            requestDigest,
            revision,
            ...(verifyLabelBytes && { verifyLabelBytes }),
          },
          { session },
        );
        return { workspace: prepared, revision, databaseScope: scope, migrationSourceDigest };
      }, transaction),
    );
  } catch (error) {
    // A competing create can surface as a duplicate key rather than a retried transaction.
    if (error instanceof MongoServerError && error.code === 11000) {
      const result = replay(
        await receipts(db).findOne({ _id: operationId }),
        await readMongoWorkspace(),
      );
      if (result) return result;
      throw conflict();
    }
    throw error;
  }
}
