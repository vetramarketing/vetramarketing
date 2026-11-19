import { createHash, randomBytes, scrypt, timingSafeEqual } from 'node:crypto';
import { mkdirSync } from 'node:fs';
import { join, resolve } from 'node:path';
import type { DatabaseSync } from 'node:sqlite';
import { viewFromPath, workspacePath } from '../workspace-routes';

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

type SessionRequest = { headers: Pick<Headers, 'get'> };
function cookieValues(request: SessionRequest) {
  const raw = request.headers.get('cookie') ?? '';
  return raw
    .split(';')
    .map((s) => s.trim())
    .filter((s) => s.startsWith(SESSION_COOKIE_NAME + '='))
    .map((s) => s.slice(SESSION_COOKIE_NAME.length + 1));
}
const validToken = (value: string) => value.length === 43 && /^[A-Za-z0-9_-]{43}$/.test(value);

export function readAccessSession(request: SessionRequest): { expiresAt: number } | null {
  const tokens = cookieValues(request);
  if (tokens.length !== 1 || !validToken(tokens[0])) return null;
  const token = tokens[0];
  try {
    const config = configuration();
    if (!config) return null;
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
    return null;
  }
}

export function hasValidSession(request: SessionRequest): boolean {
  return readAccessSession(request) !== null;
}

export type UnlockResult =
  { status: 'accepted'; token: string } | { status: 'invalid' | 'limited' | 'unavailable' };

export async function unlockAccess(pin: string, request: Request): Promise<UnlockResult> {
  const config = configuration();
  if (!config) return { status: 'unavailable' };
  try {
    const db = database();
    const now = Date.now();
    // Reserve before asynchronous hashing. Concurrent or interrupted attempts count in the same window.
    const attempt = transaction(db, () => {
      activateGeneration(db, config.id);
      db.prepare('DELETE FROM access_attempts WHERE started<=?').run(now - windowMs);
      db.prepare('DELETE FROM access_sessions WHERE expires<=?').run(now);
      const used = Number(db.prepare('SELECT count(*) AS n FROM access_attempts').get()?.n);
      if (used >= maxAttempts) return null;
      return db.prepare('INSERT INTO access_attempts(started) VALUES(?)').run(now).lastInsertRowid;
    });
    if (attempt === null) return { status: 'limited' };
    if (pin.length !== 8 || !/^[0-9]{8}$/.test(pin)) return { status: 'invalid' };
    const computed = await new Promise<Buffer>((ok, fail) =>
      scrypt(pin, config.salt, 64, (error, result) => (error ? fail(error) : ok(result))),
    );
    if (!timingSafeEqual(config.expected, computed)) return { status: 'invalid' };
    return transaction(db, () => {
      if (configuration()?.id !== config.id || currentGeneration(db) !== config.id)
        return { status: 'unavailable' } as const;
      db.prepare('DELETE FROM access_attempts WHERE id=?').run(attempt);
      // A fresh unlock replaces the session presented by this browser.
      for (const previous of cookieValues(request).filter(validToken))
        db.prepare('DELETE FROM access_sessions WHERE digest=?').run(hash(previous));
      const token = randomBytes(32).toString('base64url');
      db.prepare('INSERT INTO access_sessions(digest,expires) VALUES(?,?)').run(
        hash(token),
        Date.now() + SESSION_SECONDS * 1000,
      );
      return { status: 'accepted', token } as const;
    });
  } catch {
    return { status: 'unavailable' };
  }
}

export function lockAccess(request: Request) {
  const tokens = cookieValues(request).filter(validToken);
  if (!tokens.length) return;
  const db = database();
  transaction(db, () => {
    const revoke = db.prepare('DELETE FROM access_sessions WHERE digest=?');
    for (const token of tokens) revoke.run(hash(token));
  });
}
