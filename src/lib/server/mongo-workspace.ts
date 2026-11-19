import { createHash, randomUUID } from 'node:crypto';
import {
  MongoClient,
  MongoServerError,
  type AnyBulkWriteOperation,
  type ClientSession,
  type Db,
} from 'mongodb';
import { newDuplicatePair } from '../post-identity';
import {
  deserializeWorkspace,
  serializeWorkspace,
  type StoredWorkspaceV12,
} from '../workspace-storage';
import { migrateWorkspaceMedia } from './workspace-media';
import { assertStoredLabels } from './mongo-labels';

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
};

export class MongoWorkspaceError extends Error {
  constructor(
    readonly code: string,
    readonly status: number,
    readonly postIds?: [string, string],
  ) {
    super(code);
  }
}
const conflict = () => new MongoWorkspaceError('WORKSPACE_REVISION_CONFLICT', 409);
const digest = (value: string) => createHash('sha256').update(value).digest('hex');

type Connection = { client: MongoClient; db: Db; scope: string };
const cache = globalThis as typeof globalThis & { vetraMongoConnection?: Promise<Connection> };
async function connection(): Promise<Connection> {
  if (!cache.vetraMongoConnection) {
    const uri = process.env.MONGODB_URI?.trim();
    if (!uri) throw new MongoWorkspaceError('MONGODB_NOT_CONFIGURED', 503);
    const client = new MongoClient(uri, {
      appName: 'vetra-marketing',
      serverSelectionTimeoutMS: 12000,
      maxPoolSize: 8,
      ignoreUndefined: true,
    });
    const path = uri
      .split('?')[0]
      .slice(uri.indexOf('://') + 3)
      .split('/')[1];
    const name =
      process.env.MONGODB_DB?.trim() || (path && decodeURIComponent(path)) || 'vetra_marketing';
    if (['admin', 'config', 'local'].includes(name))
      throw new MongoWorkspaceError('INVALID_DATABASE', 503);
    const db = client.db(name);
    const host =
      client.options.srvHost ||
      client.options.hosts
        .map((item) => item.toString())
        .sort()
        .join(',');
    const scope = digest(host + '/' + name).slice(0, 32);
    cache.vetraMongoConnection = client
      .connect()
      .then(() => ({ client, db, scope }))
      .catch(async (error) => {
        delete cache.vetraMongoConnection;
        await client.close().catch(() => {});
        throw error;
      });
  }
  return cache.vetraMongoConnection;
}

export async function getWorkspaceMongoDb(): Promise<Db> {
  return (await connection()).db;
}
export async function workspaceDatabaseScope(): Promise<string> {
  return (await connection()).scope;
}
export async function closeWorkspaceMongoDb(): Promise<void> {
  const pending = cache.vetraMongoConnection;
  delete cache.vetraMongoConnection;
  if (pending) await (await pending).client.close();
}
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
  const { client, db, scope } = await connection();
  return client.withSession((session) =>
    session.withTransaction(() => readSnapshot(db, scope, session), transaction),
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
  const { client, db, scope } = await connection();
  const replay = (record: Receipt | null, current: MongoWorkspaceSnapshot | null) => {
    if (!record) return null;
    if (
      record.expectedRevision !== expectedRevision ||
      record.requestDigest !== requestDigest ||
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
    await migrateWorkspaceMedia(workspace, workspaceId, { previous: priorWorkspace ?? undefined }),
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
          { _id: operationId, expectedRevision, requestDigest, revision },
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
