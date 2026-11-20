import { createHash, randomBytes, scrypt, timingSafeEqual } from 'node:crypto';
import { mkdirSync } from 'node:fs';
import { join, resolve } from 'node:path';
import type { DatabaseSync } from 'node:sqlite';
import { viewFromPath, workspacePath } from '../workspace-routes';
import { readMongoAccessSession, reserveMongoAttempt, revokeMongoSessions } from './mongo-access';

export const SESSION_COOKIE_NAME = 'vetra_session';
export const SESSION_SECONDS = 8 * 60 * 60;
const windowMs = 15 * 60 * 1000;
const maxAttempts = 5;
const hashFormat = /^scrypt:([0-9a-f]{32}):([0-9a-f]{128})$/;
const hash = (value: string) => createHash('sha256').update(value).digest('hex');

export function safeWorkspaceReturn(input: string | null): string {
  const view = input && viewFromPath(input);
  return view ? workspacePath(view) : '/';
}

function configuration() {
  const raw = process.env.WORKSPACE_PIN_HASH ?? '';
  const match = hashFormat.exec(raw);
  if (!match || match[0] !== raw) return null;
  return {
    id: hash(raw),
    salt: Buffer.from(match[1], 'hex'),
    expected: Buffer.from(match[2], 'hex'),
  };
}

type AccessDatabase = { path: string; db: DatabaseSync };
const cache = globalThis as typeof globalThis & { vetraAccessDatabase?: AccessDatabase };

/** SQLite transactions coordinate local Next workers and persist across process restarts. */
function database(): DatabaseSync {
  const configuredFolder =
    process.env.VETRA_SITE_ACCESS_DIRECTORY || join('.local-data', 'site-access');
  const folder = resolve(/* turbopackIgnore: true */ configuredFolder);
  const path = join(folder, 'access.sqlite');
  if (cache.vetraAccessDatabase?.path === path) return cache.vetraAccessDatabase.db;
  closeAccessDatabase();
  const sqlite = process.getBuiltinModule('node:sqlite') as
    typeof import('node:sqlite') | undefined;
  if (!sqlite) throw new Error('Local access storage requires Node.js 22.13 or later.');
  mkdirSync(folder, { recursive: true, mode: 0o700 });
  const db = new sqlite.DatabaseSync(path);
  try {
    db.exec(`
      PRAGMA busy_timeout=3000;
      CREATE TABLE IF NOT EXISTS access_config (singleton INTEGER PRIMARY KEY CHECK(singleton=1), fingerprint TEXT NOT NULL);
      CREATE TABLE IF NOT EXISTS access_sessions (digest TEXT PRIMARY KEY, expires INTEGER NOT NULL);
      CREATE TABLE IF NOT EXISTS access_attempts (id INTEGER PRIMARY KEY AUTOINCREMENT, started INTEGER NOT NULL);
    `);
  } catch (error) {
    db.close();
    throw error;
  }
  cache.vetraAccessDatabase = { path, db };
  return db;
}

export function closeAccessDatabase() {
  cache.vetraAccessDatabase?.db.close();
  delete cache.vetraAccessDatabase;
}

function transaction<T>(db: DatabaseSync, work: () => T): T {
  db.exec('BEGIN IMMEDIATE');
  try {
    const value = work();
    db.exec('COMMIT');
    return value;
  } catch (error) {
    db.exec('ROLLBACK');
    throw error;
  }
}

function currentGeneration(db: DatabaseSync) {
  return db.prepare('SELECT fingerprint FROM access_config WHERE singleton=1').get()?.fingerprint;
}

/** Called within an immediate transaction. Reverting the setting cannot resurrect old sessions. */
function activateGeneration(db: DatabaseSync, fingerprint: string) {
  if (currentGeneration(db) !== fingerprint) {
    db.exec('DELETE FROM access_sessions');
    db.prepare('INSERT OR REPLACE INTO access_config VALUES(1, ?)').run(fingerprint);
  }
}

export type SessionRequest = { headers: Pick<Headers, 'get'> };
export class SessionStoreUnavailable extends Error {}
function cookieValues(request: SessionRequest) {
  const raw = request.headers.get('cookie') ?? '';
  return raw
    .split(';')
    .map((s) => s.trim())
    .filter((s) => s.startsWith(SESSION_COOKIE_NAME + '='))
    .map((s) => s.slice(SESSION_COOKIE_NAME.length + 1));
}
const validToken = (value: string) => value.length === 43 && /^[A-Za-z0-9_-]{43}$/.test(value);

export async function readAccessSession(
  request: SessionRequest,
): Promise<{ expiresAt: number } | null> {
  const tokens = cookieValues(request);
  if (tokens.length !== 1 || !validToken(tokens[0])) return null;
  const token = tokens[0];
  const config = configuration();
  if (!config) {
    if (process.env.VERCEL) throw new SessionStoreUnavailable();
    return null;
  }
  try {
    if (process.env.VERCEL) return await readMongoAccessSession(config.id, hash(token));
    const db = database();
    if (currentGeneration(db) !== config.id)
      transaction(db, () => activateGeneration(db, config.id));
    const row = db
      .prepare(
        `SELECT expires FROM access_sessions WHERE digest=? AND expires>?
      AND (SELECT fingerprint FROM access_config WHERE singleton=1)=?`,
      )
      .get(hash(token), Date.now(), config.id);
    return typeof row?.expires === 'number' ? { expiresAt: row.expires } : null;
  } catch {
    if (process.env.VERCEL) throw new SessionStoreUnavailable();
    return null;
  }
}

export async function hasValidSession(request: SessionRequest): Promise<boolean> {
  return (await readAccessSession(request)) !== null;
}

export type UnlockResult =
  { status: 'accepted'; token: string } | { status: 'invalid' | 'limited' | 'unavailable' };

function reserveLocalAttempt(fingerprint: string) {
  const db = database();
  const now = Date.now();
  const attempt = transaction(db, () => {
    activateGeneration(db, fingerprint);
    db.prepare('DELETE FROM access_attempts WHERE started<=?').run(now - windowMs);
    db.prepare('DELETE FROM access_sessions WHERE expires<=?').run(now);
    const used = Number(db.prepare('SELECT count(*) AS n FROM access_attempts').get()?.n);
    if (used >= maxAttempts) return null;
    return db.prepare('INSERT INTO access_attempts(started) VALUES(?)').run(now).lastInsertRowid;
  });
  if (attempt === null) return null;
  return (digest: string, previous: string[], expires: number) =>
    transaction(db, () => {
      if (currentGeneration(db) !== fingerprint) return false;
      db.prepare('DELETE FROM access_attempts WHERE id=?').run(attempt);
      for (const old of previous) db.prepare('DELETE FROM access_sessions WHERE digest=?').run(old);
      db.prepare('INSERT INTO access_sessions(digest,expires) VALUES(?,?)').run(digest, expires);
      return true;
    });
}

export async function unlockAccess(pin: string, request: Request): Promise<UnlockResult> {
  const config = configuration();
  if (!config) return { status: 'unavailable' };
  try {
    // Reserve before asynchronous hashing. Concurrent or interrupted attempts count in the same window.
    const issue = process.env.VERCEL
      ? await reserveMongoAttempt(config.id, windowMs, maxAttempts)
      : reserveLocalAttempt(config.id);
    if (!issue) return { status: 'limited' };
    if (pin.length !== 8 || !/^[0-9]{8}$/.test(pin)) return { status: 'invalid' };
    const computed = await new Promise<Buffer>((ok, fail) =>
      scrypt(pin, config.salt, 64, (error, result) => (error ? fail(error) : ok(result))),
    );
    if (!timingSafeEqual(config.expected, computed)) return { status: 'invalid' };
    if (configuration()?.id !== config.id) return { status: 'unavailable' };
    const previous = cookieValues(request).filter(validToken).map(hash);
    const token = randomBytes(32).toString('base64url');
    const saved = await issue(hash(token), previous, Date.now() + SESSION_SECONDS * 1000);
    return saved ? { status: 'accepted', token } : { status: 'unavailable' };
  } catch {
    return { status: 'unavailable' };
  }
}

export async function lockAccess(request: Request): Promise<void> {
  const tokens = cookieValues(request).filter(validToken);
  if (!tokens.length) return;
  if (process.env.VERCEL) return revokeMongoSessions(tokens.map(hash));
  const db = database();
  transaction(db, () => {
    const revoke = db.prepare('DELETE FROM access_sessions WHERE digest=?');
    for (const token of tokens) revoke.run(hash(token));
  });
}
