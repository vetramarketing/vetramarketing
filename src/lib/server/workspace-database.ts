import { createHash } from 'node:crypto';
import { MongoClient, type Db } from 'mongodb';

export class MongoWorkspaceError extends Error {
  constructor(
    readonly code: string,
    readonly status: number,
    readonly postIds?: [string, string],
  ) {
    super(code);
  }
}
type Connection = { client: MongoClient; db: Db; scope: string };
const cache = globalThis as typeof globalThis & { vetraMongoConnection?: Promise<Connection> };
function configuredConnection(): Connection {
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
  const scope = createHash('sha256')
    .update(host + '/' + name)
    .digest('hex')
    .slice(0, 32);
  return { client, db, scope };
}

/** Resolve the configured scope without opening a database connection. */
export function configuredWorkspaceScope(): string {
  return configuredConnection().scope;
}

export async function workspaceConnection(): Promise<Connection> {
  if (!cache.vetraMongoConnection) {
    const { client, db, scope } = configuredConnection();
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
  return (await workspaceConnection()).db;
}
export async function workspaceDatabaseScope(): Promise<string> {
  return (await workspaceConnection()).scope;
}
export async function closeWorkspaceMongoDb(): Promise<void> {
  const pending = cache.vetraMongoConnection;
  delete cache.vetraMongoConnection;
  if (pending) await (await pending).client.close();
}
