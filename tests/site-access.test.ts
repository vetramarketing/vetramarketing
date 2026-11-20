import assert from 'node:assert/strict';
import { execFile } from 'node:child_process';
import { randomBytes, randomInt, scryptSync, createHash } from 'node:crypto';
import { existsSync } from 'node:fs';
import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { promisify } from 'node:util';
import test, { type TestContext } from 'node:test';
import { DatabaseSync } from 'node:sqlite';
import { NextRequest } from 'next/server';
import { proxy } from '../src/proxy';
import { checkRequestAccess } from '../src/lib/server/access-response';
import {
  closeAccessDatabase,
  hasValidSession,
  readAccessSession,
  SessionStoreUnavailable,
  safeWorkspaceReturn,
  SESSION_COOKIE_NAME,
  SESSION_SECONDS,
  unlockAccess,
} from '../src/lib/server/site-access';
import { lockRequest, unlockRequest } from '../src/lib/server/site-access-handlers';

const origin = 'http://127.0.0.1:3100';
const pinHash = (value: string) => {
  const salt = randomBytes(16);
  return 'scrypt:' + salt.toString('hex') + ':' + scryptSync(value, salt, 64).toString('hex');
};

async function fixture(t: TestContext) {
  const directory = await mkdtemp(join(tmpdir(), 'vetra-access-test-'));
  const pin = '0' + randomInt(10_000_000).toString().padStart(7, '0');
  const settings: Record<string, string | undefined> = {
    VETRA_SITE_ACCESS_DIRECTORY: directory,
    WORKSPACE_PIN_HASH: pinHash(pin),
    VETRA_WORKSPACE_ORIGIN: origin,
    PORT: '3100',
    VERCEL: undefined,
    AWS_LAMBDA_FUNCTION_NAME: undefined,
  };
  const previous = Object.fromEntries(Object.keys(settings).map((key) => [key, process.env[key]]));
  function replace(values: Record<string, string | undefined>) {
    for (const [key, value] of Object.entries(values)) {
      if (value === undefined) delete process.env[key];
      else process.env[key] = value;
    }
  }
  replace(settings);
  t.after(async () => {
    closeAccessDatabase();
    replace(previous);
    await rm(directory, { recursive: true, force: true, maxRetries: 10, retryDelay: 50 });
  });
  return { directory, pin, wrong: '1' + pin.slice(1), file: join(directory, 'access.sqlite') };
}
function form(pin: string, next = '/orders', extra: Record<string, string> = {}, base = origin) {
  return new Request(base + '/api/access/unlock', {
    method: 'POST',
    headers: {
      host: new URL(base).host,
      origin: base,
      'content-type': 'application/x-www-form-urlencoded',
      'sec-fetch-site': 'same-origin',
      ...extra,
    },
    body: new URLSearchParams({ pin, next }),
  });
}
function sessionHeader(response: Response) {
  const cookie = response.headers.get('set-cookie')?.split(';')[0];
  assert.ok(cookie);
  return cookie;
}
function errorLocation(response: Response) {
  assert.equal(response.status, 303);
  assert.equal(response.headers.get('set-cookie'), null);
  return new URL(response.headers.get('location')!, origin).searchParams.get('error');
}
const lookup = (cookie: string) => ({ headers: new Headers({ cookie }) });

test('an unavailable hosted database fails closed while local sessions work offline', async (t) => {
  const { pin, file } = await fixture(t);
  const oldUri = process.env.MONGODB_URI;
  t.after(() => {
    if (oldUri === undefined) delete process.env.MONGODB_URI;
    else process.env.MONGODB_URI = oldUri;
  });
  process.env.MONGODB_URI = 'unconfigured-test-uri';
  process.env.VERCEL = '1';
  assert.equal((await unlockAccess(pin, form(pin))).status, 'unavailable');
  assert.equal(existsSync(file), false);
  delete process.env.VERCEL;
  const cookie = sessionHeader(await unlockRequest(form(pin)));
  assert.equal(await hasValidSession(lookup(cookie)), true);
  process.env.VERCEL = '1';
  await assert.rejects(hasValidSession(lookup(cookie)), SessionStoreUnavailable);
  const unavailable = await checkRequestAccess(lookup(cookie));
  assert.ok(unavailable instanceof Response);
  assert.equal(unavailable.status, 503);
  assert.equal(unavailable.headers.get('Cache-Control'), 'private, no-store');
  assert.equal(unavailable.headers.get('X-Vetra-Session'), 'unavailable');
  assert.equal(unavailable.headers.get('Set-Cookie'), null);
  assert.deepEqual(await unavailable.json(), { code: 'SESSION_VERIFICATION_UNAVAILABLE' });
  for (const invalid of ['', SESSION_COOKIE_NAME + '=bad', cookie + '; ' + cookie]) {
    const denied = await checkRequestAccess(lookup(invalid));
    assert.ok(denied instanceof Response);
    assert.equal(denied.status, 401);
    assert.equal(denied.headers.get('X-Vetra-Session'), null);
  }
  for (const path of ['/groups', '/api/workspace', '/_next/static/chunks/app.js']) {
    const response = await proxy(new NextRequest(origin + path, { headers: { cookie } }));
    assert.equal(response.status, 503);
    assert.equal(response.headers.get('location'), null);
    assert.equal(response.headers.get('Set-Cookie'), null);
  }
  delete process.env.VERCEL;
  assert.ok(await hasValidSession(lookup(cookie)));
});

test('verified PIN issues an opaque, persistent and revocable eight-hour session', async (t) => {
  const { pin, file } = await fixture(t);
  assert.equal(await hasValidSession(lookup('')), false);
  assert.equal(existsSync(file), false);
  let time = Date.now();
  t.mock.method(Date, 'now', () => time);
  const accepted = await unlockRequest(form(pin, '/orders'));
  assert.equal(accepted.status, 303);
  assert.equal(accepted.headers.get('location'), '/orders');
  const raw = accepted.headers.get('set-cookie')!;
  assert.match(raw, /; HttpOnly(;|$)/);
  assert.match(raw, /; SameSite=Strict(;|$)/);
  assert.match(raw, /; Path=\/(;|$)/);
  assert.match(raw, new RegExp('Max-Age=' + SESSION_SECONDS));
  assert.doesNotMatch(raw, /; Secure/);
  const cookie = sessionHeader(accepted);
  assert.ok(cookie.startsWith(SESSION_COOKIE_NAME + '='));
  assert.deepEqual(await readAccessSession(lookup(cookie)), {
    expiresAt: time + SESSION_SECONDS * 1000,
  });
  closeAccessDatabase();
  const inspection = new DatabaseSync(file, { readOnly: true });
  try {
    const token = cookie.slice(SESSION_COOKIE_NAME.length + 1);
    assert.equal(
      inspection.prepare('SELECT digest FROM access_sessions').get()?.digest,
      createHash('sha256').update(token).digest('hex'),
    );
  } finally {
    inspection.close();
  }
  assert.ok(await hasValidSession(lookup(cookie)));
  assert.equal(await hasValidSession(lookup(cookie + '; ' + cookie)), false);
  const second = await unlockRequest(form(pin, '/orders', { cookie }));
  const active = sessionHeader(second);
  assert.notEqual(active, cookie);
  assert.equal(await hasValidSession(lookup(cookie)), false);
  time += SESSION_SECONDS * 1000 - 1;
  assert.ok(await hasValidSession(lookup(active)));
  time += 1;
  assert.equal(await hasValidSession(lookup(active)), false);
  const renewed = sessionHeader(await unlockRequest(form(pin)));
  const locked = await lockRequest(form('', '/', { cookie: renewed + '; ' + renewed }));
  assert.equal(locked.status, 303);
  assert.equal(locked.headers.get('location'), '/unlock');
  assert.match(locked.headers.get('set-cookie')!, /Max-Age=0/);
  closeAccessDatabase();
  assert.equal(await hasValidSession(lookup(renewed)), false);
});

test('invalid settings fail closed and configuration rotation permanently revokes issued sessions', async (t) => {
  const { pin } = await fixture(t);
  const original = process.env.WORKSPACE_PIN_HASH;
  const token = sessionHeader(await unlockRequest(form(pin)));
  delete process.env.WORKSPACE_PIN_HASH;
  assert.equal(await hasValidSession(lookup(token)), false);
  assert.equal(errorLocation(await unlockRequest(form(pin))), 'unavailable');
  process.env.WORKSPACE_PIN_HASH = 'unusable';
  assert.equal(errorLocation(await unlockRequest(form(pin))), 'unavailable');
  process.env.WORKSPACE_PIN_HASH = pinHash(pin);
  assert.equal(await hasValidSession(lookup(token)), false);
  process.env.WORKSPACE_PIN_HASH = original;
  assert.equal(await hasValidSession(lookup(token)), false);
  assert.ok(await hasValidSession(lookup(sessionHeader(await unlockRequest(form(pin))))));
});

test('only known workspace pages can be redirect targets and foreign initiators cannot unlock or lock', async (t) => {
  const { pin, file } = await fixture(t);
  for (const url of [
    null,
    'https://example.invalid/orders',
    '//example.invalid',
    '/api/workspace',
    '/unlock',
    '/posts/../orders',
    '/unknown',
  ])
    assert.equal(safeWorkspaceReturn(url), '/');
  assert.equal(safeWorkspaceReturn('/stores'), '/companies');
  assert.equal(safeWorkspaceReturn('/posts/'), '/posts');
  assert.equal(
    (await unlockRequest(form(pin, '/posts', { origin: 'https://other.invalid' }))).status,
    403,
  );
  assert.equal(
    (await unlockRequest(form(pin, '/posts', { 'sec-fetch-site': 'cross-site' }))).status,
    403,
  );
  assert.equal(existsSync(file), false);
  assert.equal(errorLocation(await unlockRequest(form(' ' + pin))), 'invalid');
  const oversized = await unlockRequest(form(pin, '/' + 'a'.repeat(2048)));
  assert.equal(errorLocation(oversized), 'invalid');
  const accepted = await unlockRequest(form(pin, '//other.invalid/orders'));
  assert.equal(accepted.headers.get('location'), '/');
  const cookie = sessionHeader(accepted);
  assert.equal(
    (await lockRequest(form('', '/', { origin: 'https://other.invalid', cookie }))).status,
    403,
  );
  assert.ok(await hasValidSession(lookup(cookie)));
  const tls = 'https://localhost:3100';
  process.env.VETRA_WORKSPACE_ORIGIN = tls;
  assert.match(
    (await unlockRequest(form(pin, '/posts', {}, tls))).headers.get('set-cookie')!,
    /; Secure/,
  );
});

test('concurrent workers share five attempts and the fifteen-minute retry window survives reopening the database', async (t) => {
  const { pin, wrong } = await fixture(t);
  const worker = `
    const {unlockAccess, closeAccessDatabase}=require('./src/lib/server/site-access.ts');
    const request=new Request('http://localhost/');
    Promise.all(Array.from({length:5},()=>unlockAccess(process.env.VETRA_ACCESS_FIXTURE,request)))
      .then(results=>process.stdout.write(JSON.stringify(results.map(item=>item.status))))
      .finally(closeAccessDatabase);
  `;
  const run = promisify(execFile);
  const outputs = await Promise.all(
    Array.from({ length: 2 }, () =>
      run(process.execPath, ['--require', 'tsx/cjs', '-e', worker], {
        env: { ...process.env, VETRA_ACCESS_FIXTURE: wrong },
        windowsHide: true,
        timeout: 20000,
      }),
    ),
  );
  const results = outputs.flatMap((result) => JSON.parse(result.stdout) as string[]);
  assert.equal(results.filter((value) => value === 'invalid').length, 5);
  assert.equal(results.filter((value) => value === 'limited').length, 5);
  assert.equal(errorLocation(await unlockRequest(form(pin))), 'limited');
  closeAccessDatabase();
  assert.equal(errorLocation(await unlockRequest(form(pin))), 'limited');
  const later = Date.now() + 15 * 60 * 1000 + 1000;
  t.mock.method(Date, 'now', () => later);
  assert.ok(await hasValidSession(lookup(sessionHeader(await unlockRequest(form(pin))))));
});
