// Optional production-build test. It creates two Next workers and a disposable loopback replica.
// Set VETRA_TEST_HOSTED=1, VETRA_TEST_MONGOD_BINARY, and optionally VETRA_TEST_OPENSSL,
// VETRA_TEST_PLAYWRIGHT and VETRA_TEST_CHROMIUM. Run with node --import tsx --test on this file.
const assert = require('node:assert/strict');
const { execFileSync, fork, spawn } = require('node:child_process');
const { randomBytes, randomInt, randomUUID, scryptSync } = require('node:crypto');
const { once } = require('node:events');
const { mkdtemp, readFile, readdir, rm } = require('node:fs/promises');
const http = require('node:http');
const https = require('node:https');
const net = require('node:net');
const { tmpdir } = require('node:os');
const { join } = require('node:path');
const test = require('node:test');
const { MongoClient } = require('mongodb');
const { createEmptyWorkspace } = require('../../src/lib/data.ts');
const { serializeWorkspace } = require('../../src/lib/workspace-storage.ts');

async function listen(server) {
  server.listen(0, '127.0.0.1');
  await once(server, 'listening');
  return server.address().port;
}

async function stop(child) {
  if (!child || child.exitCode !== null || child.signalCode !== null) return;
  const stopped = once(child, 'exit');
  child.kill();
  await stopped;
}

async function fixtureWorkspace() {
  const data = createEmptyWorkspace();
  data.groups.push({
    id: 'test-group',
    name: 'Hosted smoke group',
    companyId: 'vetra',
    facebookId: '87654321',
    notes: '',
    category: '',
  });
  // This fixture exercises storage with synthetic records only. Skip the bundled business imports.
  const lib = join(__dirname, '../../src/lib');
  const migrations = (await readdir(lib)).filter((name) =>
    /^(?:provided-|company-name-update).*\.ts$/.test(name),
  );
  data.appliedDataUpdates = migrations.flatMap((name) =>
    Object.entries(require(join(lib, name)))
      .filter(([key, value]) => key.endsWith('_UPDATE') && typeof value === 'string')
      .map(([, value]) => value),
  );
  return serializeWorkspace(data);
}

test(
  'hosted HTTPS form, Mongo session and workspace survive routing across Next instances',
  { skip: process.env.VETRA_TEST_HOSTED !== '1', timeout: 120_000 },
  async () => {
    assert.ok(process.env.VETRA_TEST_MONGOD_BINARY);
    const { chromium } = require(process.env.VETRA_TEST_PLAYWRIGHT || 'playwright-core');
    const directory = await mkdtemp(join(tmpdir(), 'vetra-hosted-smoke-'));
    const certFile = join(directory, 'test-cert.pem'),
      keyFile = join(directory, 'test-key.pem');
    const hostname = 'workspace.test';
    const children = [];
    let gateway, mongo, admin, browser;
    try {
      execFileSync(
        process.env.VETRA_TEST_OPENSSL || 'openssl',
        [
          'req',
          '-x509',
          '-newkey',
          'rsa:2048',
          '-nodes',
          '-keyout',
          keyFile,
          '-out',
          certFile,
          '-days',
          '1',
          '-subj',
          '/CN=' + hostname,
        ],
        { windowsHide: true, stdio: 'ignore' },
      );
      const socket = net.createServer();
      const dbPort = await listen(socket);
      await new Promise((resolve) => socket.close(resolve));
      mongo = spawn(
        process.env.VETRA_TEST_MONGOD_BINARY,
        [
          '--bind_ip',
          '127.0.0.1',
          '--port',
          String(dbPort),
          '--replSet',
          'test',
          '--setParameter',
          'enableTestCommands=1',
          '--dbpath',
          directory,
          '--logpath',
          join(directory, 'mongo.log'),
        ],
        { windowsHide: true, stdio: 'ignore' },
      );
      const dbHost = '127.0.0.1:' + dbPort;
      admin = new MongoClient('mongodb://' + dbHost + '/?directConnection=true', {
        serverSelectionTimeoutMS: 15000,
      });
      await admin.connect();
      await admin
        .db('admin')
        .command({ replSetInitiate: { _id: 'test', members: [{ _id: 0, host: dbHost }] } });

      const ports = [];
      const statusWorkers = [];
      let statusCounter = 0;
      let nativeOrigin;
      gateway = https.createServer(
        { cert: await readFile(certFile), key: await readFile(keyFile) },
        (request, response) => {
          const pathname = new URL(request.url, 'https://' + hostname).pathname;
          // PIN acceptance is always on A. Reads, saves and logout execute on B; status reads alternate.
          const worker =
            pathname === '/api/access/unlock'
              ? 0
              : pathname === '/api/access/status'
                ? statusCounter++ % 2
                : 1;
          if (pathname === '/api/access/status') statusWorkers.push(worker);
          if (pathname === '/api/access/unlock') nativeOrigin = request.headers.origin;
          const host = hostname + ':' + gateway.address().port;
          const upstream = http.request(
            {
              hostname: '127.0.0.1',
              port: ports[worker],
              path: request.url,
              method: request.method,
              headers: {
                ...request.headers,
                host,
                'x-forwarded-host': host,
                'x-forwarded-proto': 'https',
                'x-forwarded-for': '192.0.2.1',
              },
            },
            (result) => {
              response.writeHead(result.statusCode, result.headers);
              result.pipe(response);
            },
          );
          upstream.on('error', () => {
            response.writeHead(502);
            response.end();
          });
          request.pipe(upstream);
        },
      );
      const externalPort = await listen(gateway);
      const origin = 'https://' + hostname + ':' + externalPort;
      const pin = '0' + String(randomInt(1_000_000, 10_000_000));
      const salt = randomBytes(16);
      const environment = {
        ...process.env,
        NODE_ENV: 'production',
        VERCEL: '1',
        VERCEL_ENV: 'production',
        VERCEL_TARGET_ENV: 'production',
        VETRA_WORKSPACE_ORIGIN: origin,
        VERCEL_PROJECT_PRODUCTION_URL: new URL(origin).host,
        NEXT_TELEMETRY_DISABLED: '1',
        WORKSPACE_PIN_HASH:
          'scrypt:' + salt.toString('hex') + ':' + scryptSync(pin, salt, 64).toString('hex'),
        MONGODB_URI: 'mongodb://' + dbHost + '/?replicaSet=test',
        MONGODB_DB: 'hosted_smoke',
        CLOUDINARY_CLOUD_NAME: '',
        CLOUDINARY_API_KEY: '',
        CLOUDINARY_API_SECRET: '',
        FLASH_MCH_ID: '',
        FLASH_API_KEY: '',
      };
      for (let i = 0; i < 2; i++) {
        const child = fork(join(__dirname, 'hosted-next-worker.cjs'), [], {
          env: { ...environment, VETRA_SITE_ACCESS_DIRECTORY: join(directory, 'worker-' + i) },
          execArgv: [],
          windowsHide: true,
          stdio: ['ignore', 'ignore', 'inherit', 'ipc'],
        });
        children.push(child);
        const ready = await Promise.race([
          once(child, 'message'),
          once(child, 'exit').then(() => {
            throw new Error('Test worker exited before startup');
          }),
        ]);
        assert.ok(ready[0].port, ready[0].error);
        ports.push(ready[0].port);
      }

      browser = await chromium.launch({
        executablePath: process.env.VETRA_TEST_CHROMIUM,
        args: ['--no-proxy-server', '--host-resolver-rules=MAP ' + hostname + ' 127.0.0.1'],
      });
      const context = await browser.newContext({
        ignoreHTTPSErrors: true,
        serviceWorkers: 'block',
      });
      await context.route('**/*', (route) =>
        new URL(route.request().url()).origin === origin ? route.continue() : route.abort(),
      );
      await context.addInitScript(() => localStorage.setItem('vetra-marketing.locale', 'en'));
      const page = await context.newPage();
      page.setDefaultTimeout(10000);
      const errors = [];
      page.on('pageerror', (error) => errors.push(error.message));
      const get = (path) =>
        page.evaluate(async (target) => (await fetch(target, { cache: 'no-store' })).status, path);
      await page.goto(origin + '/groups');
      await page.waitForURL(origin + '/unlock?next=%2Fgroups');
      const visitor = await context.newPage();
      assert.equal((await visitor.goto(origin + '/api/workspace')).status(), 401);
      assert.equal((await visitor.goto(origin + '/api/access/status')).status(), 401);
      await visitor.close();
      await page.bringToFront();
      await page.locator('#pin').fill(pin);
      await page.locator('#pin').press('Enter');
      await page.waitForURL(origin + '/groups');
      assert.equal(nativeOrigin, origin);
      const cookie = (await context.cookies()).find((c) => c.name === 'vetra_session');
      assert.ok(cookie?.secure && cookie.httpOnly && cookie.sameSite === 'Strict');
      assert.equal(await get('/api/access/status'), 200);
      assert.equal(await get('/api/access/status'), 200);
      assert.equal(await get('/api/workspace'), 404);
      const imported = await page.evaluate(
        async (body) =>
          (
            await fetch('/api/workspace', {
              method: 'POST',
              headers: { 'Content-Type': 'application/json' },
              body: JSON.stringify(body),
            })
          ).status,
        { workspace: await fixtureWorkspace(), expectedRevision: null, operationId: randomUUID() },
      );
      assert.equal(imported, 200);
      await page.reload();
      await page.getByRole('button', { name: 'Edit Hosted smoke group' }).waitFor();
      assert.equal(await get('/api/workspace'), 200);
      const chunk = await page.locator('script[src*="/_next/static/"]').first().getAttribute('src');
      assert.equal(await get(chunk), 200);
      assert.equal(new Set(statusWorkers).size, 2);
      await page.getByRole('button', { name: 'Edit Hosted smoke group' }).click();
      const notes = page.getByRole('textbox', { name: 'Posting notes', exact: true });
      await notes.fill('Pending notes during outage');
      // MongoDB's own test hook fails one session query, then lets the next request succeed.
      await admin.db('admin').command({
        configureFailPoint: 'failCommand',
        mode: { times: 1 },
        data: { failCommands: ['aggregate'], appName: 'vetra-marketing', errorCode: 50 },
      });
      const failedCheck = page.waitForResponse(
        (response) => new URL(response.url()).pathname === '/api/access/status',
      );
      await page.evaluate(() => window.dispatchEvent(new Event('online')));
      assert.equal((await failedCheck).status(), 503);
      await page.getByRole('button', { name: 'Retry', exact: true }).click();
      assert.equal(await notes.inputValue(), 'Pending notes during outage');
      await page.getByRole('button', { name: 'Close group editor' }).click();
      await page.evaluate(async () =>
        fetch('/api/access/lock', { method: 'POST' }).then((r) => r.status),
      );
      assert.equal(await get('/api/workspace'), 401);
      assert.equal(await get(chunk), 401);
      // Reintroduce the original test cookie after logout; both instances must observe revocation.
      await context.addCookies([cookie]);
      assert.equal(await get('/api/access/status'), 401);
      assert.equal(await get('/api/access/status'), 401);
      await page.goto(origin + '/orders');
      await page.waitForURL(origin + '/unlock?next=%2Forders');
      assert.deepEqual(errors, []);
    } finally {
      if (browser) await browser.close();
      if (gateway) {
        gateway.closeAllConnections();
        await new Promise((resolve) => gateway.close(resolve));
      }
      await Promise.all(children.map(stop));
      if (admin) await admin.close();
      await stop(mongo);
      await rm(directory, { recursive: true, force: true, maxRetries: 5, retryDelay: 100 });
    }
  },
);
