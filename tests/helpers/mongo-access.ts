import assert from 'node:assert/strict';
import { execFile } from 'node:child_process';
import { createHash, randomBytes, randomInt, randomUUID, scryptSync } from 'node:crypto';
import { existsSync } from 'node:fs';
import { join } from 'node:path';
import type { TestContext } from 'node:test';
import { promisify } from 'node:util';
import type { Db } from 'mongodb';
import {
  hasValidSession,
  readAccessSession,
  renewAccessSession,
  SESSION_COOKIE_NAME,
  SESSION_SECONDS,
  unlockAccess,
} from '../../src/lib/server/site-access';

const worker = `
  const {hasValidSession, lockAccess, renewAccessSession, unlockAccess} = require('./src/lib/server/site-access.ts');
  const {closeWorkspaceMongoDb} = require('./src/lib/server/workspace-database.ts');
  async function action() {
    const request = new Request('https://app.example.invalid/', {headers: {cookie: process.env.TEST_COOKIE || ''}});
    if (process.env.TEST_ACTION === 'read') return hasValidSession(request);
    if (process.env.TEST_ACTION === 'renew') return renewAccessSession(request);
    if (process.env.TEST_ACTION === 'lock') {
      await lockAccess(request);
      return true;
    }
    const attempts = Array.from({length: 5}, () => unlockAccess(process.env.TEST_WRONG_PIN, request));
    return (await Promise.all(attempts)).map(item => item.status);
  }
  action().then(result => process.stdout.write(JSON.stringify(result)))
    .catch(() => {process.exitCode = 1}).finally(closeWorkspaceMongoDb);
`;
async function runWorker(action: string, cookie: string, wrong: string) {
  const result = await promisify(execFile)(
    process.execPath,
    ['--require', 'tsx/cjs', '-e', worker],
    {
      env: { ...process.env, TEST_ACTION: action, TEST_COOKIE: cookie, TEST_WRONG_PIN: wrong },
      windowsHide: true,
      timeout: 45000,
    },
  );
  return JSON.parse(result.stdout);
}

export async function checkMongoAccess(t: TestContext, db: Db, directory: string) {
  const pin = '0' + randomInt(10_000_000).toString().padStart(7, '0');
  const wrong = '1' + pin.slice(1);
  function hashedPin() {
    const salt = randomBytes(16);
    return 'scrypt:' + salt.toString('hex') + ':' + scryptSync(pin, salt, 64).toString('hex');
  }
  const settings = {
    VERCEL: '1',
    VERCEL_ENV: 'production',
    VERCEL_TARGET_ENV: 'production',
    VERCEL_PROJECT_ID: randomUUID(),
    WORKSPACE_PIN_HASH: hashedPin(),
    VETRA_SITE_ACCESS_DIRECTORY: join(directory, 'unused-site-access'),
  };
  const previous = Object.fromEntries(Object.keys(settings).map((key) => [key, process.env[key]]));
  Object.assign(process.env, settings);
  t.after(() => {
    for (const [key, value] of Object.entries(previous)) {
      if (value === undefined) delete process.env[key];
      else process.env[key] = value;
    }
  });
  const request = (cookie = '') =>
    new Request('https://app.example.invalid/', { headers: { cookie } });
  async function issue(prior = '') {
    const result = await unlockAccess(pin, request(prior));
    assert.equal(result.status, 'accepted');
    return SESSION_COOKIE_NAME + '=' + result.token;
  }
  const before = Date.now();
  const cookie = await issue();
  const session = await readAccessSession(request(cookie));
  assert.ok(session && session.expiresAt >= before + SESSION_SECONDS * 1000);
  assert.ok(session.expiresAt <= Date.now() + SESSION_SECONDS * 1000);
  const token = cookie.slice(SESSION_COOKIE_NAME.length + 1);
  const digest = createHash('sha256').update(token).digest('hex');
  const sessions = db.collection<{ _id: string; expiresAt: Date }>('vetra_access_sessions');
  assert.ok(await sessions.findOne({ _id: digest }));
  assert.equal(await sessions.findOne({ _id: token }), null);
  assert.ok(
    (await sessions.indexes()).some(
      (index) => index.key.expiresAt === 1 && index.expireAfterSeconds === 0,
    ),
  );
  assert.equal(await runWorker('read', cookie, wrong), true);
  const legacyExpiry = new Date(Date.now() + 8 * 60 * 60 * 1000);
  await sessions.updateOne({ _id: digest }, { $set: { expiresAt: legacyExpiry } });
  assert.deepEqual(await readAccessSession(request(cookie)), { expiresAt: legacyExpiry.getTime() });
  assert.equal(await runWorker('read', cookie, wrong), true);
  assert.deepEqual((await sessions.findOne({ _id: digest }))?.expiresAt, legacyExpiry);
  const beforeActivity = Date.now();
  const extended = await runWorker('renew', cookie, wrong);
  const week = 7 * 24 * 60 * 60 * 1000;
  assert.ok(extended.expiresAt >= beforeActivity + week && extended.expiresAt <= Date.now() + week);
  assert.deepEqual(await readAccessSession(request(cookie)), extended);
  process.env.VERCEL_PROJECT_ID = randomUUID();
  assert.equal(await hasValidSession(request(cookie)), false);
  assert.equal(await renewAccessSession(request(cookie)), null);
  process.env.VERCEL_PROJECT_ID = settings.VERCEL_PROJECT_ID;
  const renewed = await issue(cookie);
  assert.equal(await hasValidSession(request(cookie)), false);
  const [locked] = await Promise.all([
    runWorker('lock', renewed, wrong),
    runWorker('renew', renewed, wrong),
  ]);
  assert.equal(locked, true);
  assert.equal(await hasValidSession(request(renewed)), false);
  assert.equal(await renewAccessSession(request(renewed)), null);

  const soonExpired = await issue();
  const expiredDigest = createHash('sha256').update(soonExpired.split('=')[1]).digest('hex');
  await sessions.updateOne(
    { _id: expiredDigest },
    { $set: { expiresAt: new Date(Date.now() - 1) } },
  );
  assert.equal(await hasValidSession(request(soonExpired)), false);
  assert.equal(await renewAccessSession(request(soonExpired)), null);
  const original = await issue();
  process.env.WORKSPACE_PIN_HASH = hashedPin();
  assert.equal(await renewAccessSession(request(original)), null);
  assert.equal(await hasValidSession(request(original)), false);
  process.env.WORKSPACE_PIN_HASH = settings.WORKSPACE_PIN_HASH;
  assert.equal(await hasValidSession(request(original)), false);
  assert.equal(await renewAccessSession(request(original)), null);

  // A new scope starts cold in two independent processes, each with its own pool and process state.
  process.env.VERCEL_PROJECT_ID = randomUUID();
  const results = (
    await Promise.all([runWorker('attempt', '', wrong), runWorker('attempt', '', wrong)])
  ).flat();
  assert.deepEqual(results.sort(), [...Array(5).fill('invalid'), ...Array(5).fill('limited')]);
  assert.equal((await unlockAccess(pin, request())).status, 'limited');
  const states = db.collection<{ _id: string; attempts: { id: string; started: number }[] }>(
    'vetra_access_state',
  );
  const limited = await states.findOne({ attempts: { $size: 5 } });
  assert.ok(limited);
  await states.updateOne(
    { _id: limited._id },
    { $set: { 'attempts.$[].started': Date.now() - 15 * 60 * 1000 } },
  );
  assert.equal(await hasValidSession(request(await issue())), true);
  assert.equal(existsSync(settings.VETRA_SITE_ACCESS_DIRECTORY), false);
}
