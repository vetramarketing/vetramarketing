import assert from 'node:assert/strict';
import test, { type TestContext } from 'node:test';
import { isTrustedWorkspaceRequest } from '../src/lib/server/workspace-request';
import { lockRequest, unlockRequest } from '../src/lib/server/site-access-handlers';
import { isLocalShippingRequest, readShippingConfiguration } from '../src/lib/shipping/config';

const domain = 'marketing.example.test';
const production = 'https://' + domain;
const other = 'https://branch.example.test';
const local = 'http://127.0.0.1:3100';

function setup(t: TestContext) {
  const values: Record<string, string | undefined> = {
    VERCEL: '1',
    VERCEL_ENV: 'production',
    VERCEL_TARGET_ENV: undefined,
    VERCEL_PROJECT_PRODUCTION_URL: domain,
    VETRA_WORKSPACE_ORIGIN: undefined,
    WORKSPACE_PIN_HASH: undefined,
    MONGODB_URI: undefined,
    AWS_LAMBDA_FUNCTION_NAME: 'test-function',
    PORT: '3100',
  };
  function replace(settings: typeof values) {
    for (const [name, value] of Object.entries(settings)) {
      if (value === undefined) delete process.env[name];
      else process.env[name] = value;
    }
  }
  const previous = Object.fromEntries(Object.keys(values).map((name) => [name, process.env[name]]));
  replace(values);
  t.after(() => replace(previous));
}
function request(origin: string, method: string, headers: Record<string, string> = {}) {
  return new Request(origin + '/api/workspace', {
    method,
    headers: { host: new URL(origin).host, ...headers },
  });
}

test('authenticated production workspace requests use one HTTPS host and accept normal platform proxy metadata', (t) => {
  setup(t);
  const platform = {
    'x-forwarded-host': domain,
    'x-forwarded-proto': 'https',
    'x-forwarded-for': '198.51.100.35',
    forwarded: 'for=198.51.100.35;proto=https',
    'x-vercel-id': 'test-id',
  };
  for (const method of ['GET', 'HEAD'])
    assert.ok(
      isTrustedWorkspaceRequest(
        request(production, method, { ...platform, 'sec-fetch-site': 'none' }),
      ),
    );
  for (const method of ['POST', 'PUT', 'PATCH', 'DELETE']) {
    assert.ok(
      isTrustedWorkspaceRequest(
        request(production, method, {
          ...platform,
          origin: production,
          'sec-fetch-site': 'same-origin',
        }),
      ),
    );
    assert.equal(isTrustedWorkspaceRequest(request(production, method, platform)), false);
    assert.equal(
      isTrustedWorkspaceRequest(request(production, method, { ...platform, origin: other })),
      false,
    );
  }
  for (const headers of [
    { host: new URL(other).host },
    { 'x-forwarded-host': new URL(other).host },
    { 'x-forwarded-proto': 'http' },
    { 'sec-fetch-site': 'cross-site' },
    { origin: 'null' },
  ] as Record<string, string>[]) {
    assert.equal(isTrustedWorkspaceRequest(request(production, 'GET', headers)), false);
  }
  assert.equal(isTrustedWorkspaceRequest(request(other, 'GET', { host: domain })), false);
  assert.equal(isTrustedWorkspaceRequest(request('http://' + domain, 'GET', platform)), false);
  assert.equal(
    isLocalShippingRequest(
      request(production, 'POST', { origin: production }),
      readShippingConfiguration({ VETRA_LOCAL_SHIPPING_ENABLED: 'true' }),
    ),
    false,
  );
});

test('production configuration cannot grant workspace access to aliases, previews, or other runtimes', (t) => {
  setup(t);
  process.env.VETRA_WORKSPACE_ORIGIN = other;
  assert.equal(isTrustedWorkspaceRequest(request(other, 'GET')), false);
  delete process.env.VERCEL_PROJECT_PRODUCTION_URL;
  assert.ok(isTrustedWorkspaceRequest(request(other, 'POST', { origin: other })));
  for (const setting of [
    local,
    'https://localhost:3100',
    'https://*.example.test',
    other + '/path',
    other + '?q=x',
    'https://user@branch.example.test',
  ]) {
    process.env.VETRA_WORKSPACE_ORIGIN = setting;
    assert.equal(isTrustedWorkspaceRequest(request(other, 'GET')), false);
  }
  process.env.VETRA_WORKSPACE_ORIGIN = other;
  process.env.VERCEL_ENV = 'preview';
  assert.equal(isTrustedWorkspaceRequest(request(other, 'GET')), false);
  process.env.VERCEL_ENV = 'production';
  process.env.VERCEL_TARGET_ENV = 'staging';
  assert.equal(isTrustedWorkspaceRequest(request(other, 'GET')), false);
  delete process.env.VERCEL;
  assert.equal(isTrustedWorkspaceRequest(request(other, 'GET')), false);
});

test('the local workspace accepts direct loopback access and matching-origin writes', (t) => {
  setup(t);
  delete process.env.VERCEL;
  delete process.env.AWS_LAMBDA_FUNCTION_NAME;
  assert.ok(isTrustedWorkspaceRequest(request(local, 'GET')));
  assert.ok(isTrustedWorkspaceRequest(request(local, 'PUT', { origin: local })));
  assert.equal(isTrustedWorkspaceRequest(request(local, 'PUT')), false);
  assert.equal(
    isTrustedWorkspaceRequest(request(local, 'GET', { 'x-forwarded-for': '198.51.100.35' })),
    false,
  );
  assert.equal(isTrustedWorkspaceRequest(request(production, 'GET')), false);
});

test('PIN and lock endpoints apply the same verified origin and send Secure cookies on hosted HTTPS', async (t) => {
  setup(t);
  const denied = request(other, 'POST', { origin: other });
  assert.equal((await unlockRequest(denied)).status, 403);
  assert.equal((await lockRequest(denied)).status, 403);
  assert.equal((await lockRequest(request(production, 'GET'))).status, 403);
  // An empty verifier and an empty cookie require no external service or persistent writes.
  const same = () => request(production, 'POST', { origin: production });
  const unavailable = await unlockRequest(same());
  assert.match(unavailable.headers.get('location') ?? '', /error=unavailable/);
  assert.equal(unavailable.headers.has('set-cookie'), false);
  const locked = await lockRequest(same());
  assert.equal(locked.status, 303);
  assert.match(locked.headers.get('set-cookie') ?? '', /; Secure(;|$)/);
  assert.match(locked.headers.get('set-cookie') ?? '', /; Max-Age=0(;|$)/);
});
