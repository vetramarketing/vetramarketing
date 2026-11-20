import { createHash, randomUUID } from 'node:crypto';
import { MongoServerError, type ClientSession, type Db } from 'mongodb';
import { workspaceConnection } from './workspace-database';

type AccessState = {
  _id: string;
  fingerprint: string;
  generation: string;
  attempts: { id: string; started: number }[];
};
type Session = { _id: string; scope: string; generation: string; expiresAt: Date };
const states = (db: Db) => db.collection<AccessState>('vetra_access_state');
const sessions = (db: Db) => db.collection<Session>('vetra_access_sessions');
const initialized = new WeakMap<Db, Map<string, Promise<void>>>();
const timeoutMS = 12000;
const transaction = {
  readConcern: { level: 'snapshot' },
  writeConcern: { w: 'majority' },
  readPreference: 'primary',
  timeoutMS,
} as const;

function deploymentScope() {
  // Use stable, server-provided project/environment settings across instances and redeployments.
  const project =
    process.env.VERCEL_PROJECT_ID ||
    process.env.VERCEL_PROJECT_PRODUCTION_URL ||
    process.env.VETRA_WORKSPACE_ORIGIN ||
    'vetra-marketing';
  const environment = process.env.VERCEL_TARGET_ENV || process.env.VERCEL_ENV || 'production';
  return createHash('sha256')
    .update(JSON.stringify([project, environment]))
    .digest('hex');
}

async function initialize(db: Db, scope: string, fingerprint: string) {
  let byScope = initialized.get(db);
  if (!byScope) initialized.set(db, (byScope = new Map()));
  if (!byScope.has(scope)) {
    const pending = (async () => {
      await sessions(db).createIndex({ expiresAt: 1 }, { expireAfterSeconds: 0, timeoutMS });
      try {
        await states(db).updateOne(
          { _id: scope },
          { $setOnInsert: { fingerprint, generation: randomUUID(), attempts: [] } },
          { upsert: true, writeConcern: { w: 'majority' }, timeoutMS },
        );
      } catch (error) {
        // Other cold-starting workers can create the same unique state document first.
        if (!(error instanceof MongoServerError && error.code === 11000)) throw error;
      }
    })();
    byScope.set(scope, pending);
    pending.catch(() => byScope.delete(scope));
  }
  await byScope.get(scope);
}

async function withGeneration<T>(
  fingerprint: string,
  work: (state: AccessState, db: Db, session: ClientSession) => Promise<T>,
) {
  const { client, db } = await workspaceConnection();
  const scope = deploymentScope();
  await initialize(db, scope, fingerprint);
  return client.withSession((session) =>
    session.withTransaction(async () => {
      const state = await states(db).findOne({ _id: scope }, { session });
      if (!state) throw new Error('Access state is unavailable.');
      if (state.fingerprint !== fingerprint) {
        // A fresh generation also invalidates sessions if an old PIN setting is restored later.
        state.generation = randomUUID();
        await states(db).updateOne(
          { _id: scope },
          { $set: { fingerprint, generation: state.generation } },
          { session },
        );
      }
      return work(state, db, session);
    }, transaction),
  );
}

export async function readMongoAccessSession(fingerprint: string, digest: string) {
  const { db } = await workspaceConnection();
  const scope = deploymentScope();
  await initialize(db, scope, fingerprint);
  // The proxy checks private chunks as well as pages. Read state and token by their unique IDs
  // in a single consistent round trip, including after revocation or credential rotation.
  const state = await states(db)
    .aggregate<{ fingerprint: string; expiresAt?: Date }>(
      [
        { $match: { _id: scope } },
        {
          $lookup: {
            from: sessions(db).collectionName,
            let: { generation: '$generation' },
            pipeline: [
              {
                $match: {
                  _id: digest,
                  scope,
                  expiresAt: { $gt: new Date(Date.now()) },
                  $expr: { $eq: ['$generation', '$$generation'] },
                },
              },
              { $project: { expiresAt: 1 } },
            ],
            as: 'valid',
          },
        },
        { $project: { fingerprint: 1, expiresAt: { $first: '$valid.expiresAt' } } },
      ],
      { readConcern: { level: 'snapshot' }, readPreference: 'primary', timeoutMS },
    )
    .next();
  if (!state) throw new Error('Access state is unavailable.');
  if (state.fingerprint !== fingerprint) {
    await withGeneration(fingerprint, async () => undefined);
    return null;
  }
  return state.expiresAt ? { expiresAt: state.expiresAt.getTime() } : null;
}

export function renewMongoAccessSession(fingerprint: string, digest: string, duration: number) {
  return withGeneration(fingerprint, async (state, db, session) => {
    const now = Date.now();
    const row = await sessions(db).findOneAndUpdate(
      {
        _id: digest,
        scope: state._id,
        generation: state.generation,
        expiresAt: { $gt: new Date(now) },
      },
      { $max: { expiresAt: new Date(now + duration) } },
      { session, returnDocument: 'after', projection: { expiresAt: 1 } },
    );
    return row ? { expiresAt: row.expiresAt.getTime() } : null;
  });
}

export async function reserveMongoAttempt(fingerprint: string, windowMs: number, maximum: number) {
  const id = randomUUID();
  const reserved = await withGeneration(fingerprint, async (state, db, session) => {
    const now = Date.now();
    const recent = state.attempts.filter((attempt) => attempt.started > now - windowMs);
    if (recent.length >= maximum) return null;
    recent.push({ id, started: now });
    // All contenders write the same state row. The driver retries transaction write conflicts.
    await states(db).updateOne({ _id: state._id }, { $set: { attempts: recent } }, { session });
    return { scope: state._id, generation: state.generation };
  });
  if (!reserved) return null;
  return async (digest: string, previous: string[], expires: number) => {
    const { db, client } = await workspaceConnection();
    return client.withSession((session) =>
      session.withTransaction(async () => {
        const removed = await states(db).updateOne(
          { _id: reserved.scope, fingerprint, generation: reserved.generation, 'attempts.id': id },
          { $pull: { attempts: { id } } },
          { session },
        );
        if (!removed.modifiedCount) return false;
        if (previous.length) {
          await sessions(db).deleteMany(
            { scope: reserved.scope, _id: { $in: previous } },
            { session },
          );
        }
        await sessions(db).insertOne(
          { _id: digest, ...reserved, expiresAt: new Date(expires) },
          { session },
        );
        return true;
      }, transaction),
    );
  };
}

export async function revokeMongoSessions(digests: string[]) {
  const { db } = await workspaceConnection();
  await sessions(db).deleteMany(
    { scope: deploymentScope(), _id: { $in: digests } },
    { writeConcern: { w: 'majority' }, timeoutMS },
  );
}
