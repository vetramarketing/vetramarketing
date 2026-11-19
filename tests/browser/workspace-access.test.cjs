const assert = require('node:assert/strict');
const test = require('node:test');

const base = process.env.VETRA_TEST_BROWSER_URL;
const pin = process.env.VETRA_TEST_WORKSPACE_PIN;

// Use a disposable local instance and its test PIN. Only session endpoints receive writes.
test(
  'the PIN gates pages, workspace APIs and the application bundle throughout a session',
  {
    skip: !base || !pin,
  },
  async () => {
    const origin = new URL(base).origin;
    assert.ok(['localhost', '127.0.0.1', '[::1]'].includes(new URL(origin).hostname));
    const get = (path, cookie) =>
      fetch(new URL(path, origin), {
        redirect: 'manual',
        headers: cookie ? { Cookie: cookie } : {},
      });
    const post = (path, body, cookie) =>
      fetch(new URL(path, origin), {
        method: 'POST',
        redirect: 'manual',
        body,
        headers: { Origin: origin, ...(cookie && { Cookie: cookie }) },
      });
    for (const route of ['/', '/orders', '/products', '/settings', '/customers']) {
      const response = await get(route);
      assert.equal(response.status, 303, route);
      const redirect = new URL(response.headers.get('location'), origin);
      assert.equal(redirect.origin, origin);
      assert.equal(redirect.pathname, '/unlock');
      assert.equal(redirect.searchParams.get('next') || '/', route);
    }
    for (const route of [
      '/api/workspace',
      '/api/access/status',
      '/api/shipping/capabilities',
      '/api/workspace/labels/test',
      '/console-scripts/facebook-copy-joined-groups-html.js',
      '/product/Clean%20ESHAN%20honey%20jar%20cutout.png',
    ]) {
      const response = await get(route);
      assert.equal(response.status, 401, route);
      assert.match(response.headers.get('cache-control'), /no-store/);
    }
    const lockScreen = await get('/unlock?next=/orders');
    assert.equal(lockScreen.status, 200);
    const screen = await lockScreen.text();
    assert.match(screen, /type="password"/);
    assert.doesNotMatch(screen, /\/_next\/static\//);
    for (const asset of ['/access/unlock.css', '/access/unlock.js', '/logo_white.svg']) {
      assert.equal((await get(asset)).status, 200);
    }

    const accepted = await post(
      '/api/access/unlock',
      new URLSearchParams({ pin, next: '/orders' }),
    );
    assert.equal(accepted.status, 303);
    assert.equal(new URL(accepted.headers.get('location'), origin).pathname, '/orders');
    const session = accepted.headers.get('set-cookie');
    assert.ok(session?.includes('HttpOnly') && session.includes('SameSite=Strict'));
    const cookie = session.split(';', 1)[0];
    try {
      const status = await get('/api/access/status', cookie);
      assert.equal(status.status, 200);
      assert.ok((await status.json()).expiresAt > Date.now());
      const page = await get('/orders', cookie);
      assert.equal(page.status, 200);
      assert.match(page.headers.get('cache-control'), /no-store/);
      const chunk = (await page.text()).match(/src="(\/_next\/static\/[^"]+\.js)"/)?.[1];
      assert.ok(chunk, 'The signed-in page loads its application bundle');
      assert.equal((await get(chunk)).status, 401);
      const privateChunk = await get(chunk, cookie);
      assert.equal(privateChunk.status, 200);
      assert.match(privateChunk.headers.get('cache-control'), /no-store/);
    } finally {
      assert.equal((await post('/api/access/lock', null, cookie)).status, 303);
    }
    assert.equal((await get('/api/access/status', cookie)).status, 401);
    assert.equal((await get('/orders', cookie)).status, 303);
  },
);
