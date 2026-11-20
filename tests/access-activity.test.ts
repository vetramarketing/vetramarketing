import assert from 'node:assert/strict';
import { createHash, randomBytes, randomInt, scryptSync } from 'node:crypto';
import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { DatabaseSync } from 'node:sqlite';
import test from 'node:test';
import { closeAccessDatabase, readAccessSession } from '../src/lib/server/site-access';
import {
  activityRequest,
  lockRequest,
  unlockRequest,
} from '../src/lib/server/site-access-handlers';

const idleSeconds = 7 * 24 * 60 * 60;

test('the activity handler renews a live legacy cookie and leaves denied or idle sessions alone', async (t) => {
  const directory = await mkdtemp(join(tmpdir(), 'vetra-activity-test-'));
  const local = 'https://localhost:3100';
  const hosted = 'https://marketing.example.test';
  const pin = randomInt(100_000_000).toString().padStart(8, '0');
  const salt = randomBytes(16);
  const settings: Record<string, string | undefined> = {
    VETRA_SITE_ACCESS_DIRECTORY: directory,
    WORKSPACE_PIN_HASH:
      'scrypt:' + salt.toString('hex') + ':' + scryptSync(pin, salt, 64).toString('hex'),
    VETRA_WORKSPACE_ORIGIN: local,
    VERCEL: undefined,
    VERCEL_ENV: undefined,
    VERCEL_TARGET_ENV: undefined,
    VERCEL_PROJECT_PRODUCTION_URL: undefined,
    AWS_LAMBDA_FUNCTION_NAME: undefined,
    MONGODB_URI: 'invalid-test-uri',
  };
  const replace = (items: typeof settings) => {
    for (const [key, value] of Object.entries(items)) {
      if (value === undefined) delete process.env[key];
      else process.env[key] = value;
    }
  };
  const prior = Object.fromEntries(Object.keys(settings).map((key) => [key, process.env[key]]));
  replace(settings);
  let inspection: DatabaseSync | undefined;
  t.after(async () => {
    inspection?.close();
    closeAccessDatabase();
    replace(prior);
    await rm(directory, { recursive: true, force: true, maxRetries: 5, retryDelay: 50 });
  });
  let now = 1_930_000_000_321;
  t.mock.method(Date, 'now', () => now);
  let cookie = '';
  function request(
    path: string,
    base = local,
    sender: string | null = base,
    body?: URLSearchParams,
  ) {
    const headers = new Headers({ host: new URL(base).host, cookie });
    if (sender !== null) headers.set('origin', sender);
    return new Request(base + '/api/access/' + path, { method: 'POST', headers, body });
  }
  async function unlock() {
    const result = await unlockRequest(
      request('unlock', local, local, new URLSearchParams({ pin })),
    );
    assert.equal(result.status, 303);
    const token = result.headers.get('set-cookie')?.split(';', 1)[0];
    assert.ok(token);
    cookie = token;
  }
  async function rejected(request: Request, status: number) {
    const result = await activityRequest(request);
    assert.equal(result.status, status);
    assert.equal(result.headers.get('set-cookie'), null);
    assert.match(result.headers.get('cache-control') ?? '', /no-store/);
  }
  const statusRequest = () => new Request(local + '/api/access/status', { headers: { cookie } });
  await unlock();
  inspection = new DatabaseSync(join(directory, 'access.sqlite'));
  const digest = createHash('sha256')
    .update(cookie.slice(cookie.indexOf('=') + 1))
    .digest('hex');
  // A session issued by the previous eight-hour policy is still valid for just five seconds.
  const originalDeadline = now + 5_000;
  assert.equal(
    inspection
      .prepare('UPDATE access_sessions SET expires=? WHERE digest=?')
      .run(originalDeadline, digest).changes,
    1,
  );
  const persisted = () =>
    inspection!.prepare('SELECT expires FROM access_sessions WHERE digest=?').get(digest)?.expires;
  await rejected(request('activity', local, null), 403);
  await rejected(request('activity', local, hosted), 403);
  assert.deepEqual(await readAccessSession(statusRequest()), { expiresAt: originalDeadline });
  assert.equal(persisted(), originalDeadline);

  now = originalDeadline - 1;
  const renewed = await activityRequest(request('activity'));
  assert.equal(renewed.status, 200);
  assert.match(renewed.headers.get('cache-control') ?? '', /no-store/);
  const deadline = now + idleSeconds * 1000;
  assert.deepEqual(await renewed.json(), { authenticated: true, expiresAt: deadline });
  assert.equal(persisted(), deadline);
  const header = renewed.headers.get('set-cookie') ?? '';
  assert.ok(header.split(';', 1)[0] === cookie, 'renewal should preserve the authenticated token');
  for (const attribute of [
    'Path=/',
    'HttpOnly',
    'Secure',
    'SameSite=Strict',
    'Max-Age=' + idleSeconds,
  ])
    assert.ok(
      header
        .split(';')
        .map((part) => part.trim())
        .includes(attribute),
      attribute,
    );
  assert.equal(header.match(/(?:^|; )Expires=([^;]+)/i)?.[1], new Date(deadline).toUTCString());

  now = deadline - 1;
  assert.deepEqual(await readAccessSession(statusRequest()), { expiresAt: deadline });
  assert.equal(persisted(), deadline);
  now = deadline;
  await rejected(request('activity'), 401);
  assert.equal(await readAccessSession(statusRequest()), null);

  await unlock();
  assert.equal((await lockRequest(request('lock'))).status, 303);
  await rejected(request('activity'), 401);

  process.env.VERCEL = '1';
  process.env.VERCEL_ENV = 'production';
  process.env.VERCEL_PROJECT_PRODUCTION_URL = new URL(hosted).host;
  await rejected(request('activity', hosted), 503);
  await rejected(request('activity', hosted, local), 403);
  await rejected(request('activity', 'https://branch.example.test'), 403);
  process.env.VERCEL_ENV = 'preview';
  await rejected(request('activity', hosted), 403);
});
