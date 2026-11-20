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
      const activity = '/api/access/activity';
      const current = await get('/api/access/status', cookie);
      const initial = await current.json();
      assert.equal(current.headers.get('set-cookie'), null);
      assert.equal((await get(activity, cookie)).status, 405);
      for (const sender of [null, 'https://unrelated.example.test']) {
        const response = await fetch(new URL(activity, origin), {
          method: 'POST',
          redirect: 'manual',
          headers: { Cookie: cookie, ...(sender && { Origin: sender }) },
        });
        assert.equal(response.status, 403);
        assert.equal(response.headers.get('set-cookie'), null);
      }
      assert.deepEqual(await (await get('/api/access/status', cookie)).json(), initial);
      const beforeActivity = Date.now();
      const refresh = await post(activity, null, cookie);
      const sevenDays = 7 * 24 * 60 * 60;
      assert.equal(refresh.status, 200);
      assert.match(refresh.headers.get('cache-control'), /no-store/);
      const renewed = await refresh.json();
      assert.equal(renewed.authenticated, true);
      assert.ok(renewed.expiresAt >= beforeActivity + sevenDays * 1000);
      assert.ok(renewed.expiresAt <= Date.now() + sevenDays * 1000);
      const refreshedCookie = refresh.headers.get('set-cookie');
      assert.ok(refreshedCookie?.split(';', 1)[0] === cookie);
      assert.match(refreshedCookie, /; HttpOnly(?:;|$)/);
      assert.match(refreshedCookie, /; SameSite=Strict(?:;|$)/);
      assert.match(refreshedCookie, /; Path=\/(?:;|$)/);
      assert.equal(/; Secure(?:;|$)/.test(refreshedCookie), new URL(origin).protocol === 'https:');
      assert.equal(
        refreshedCookie.match(/; Expires=([^;]+)/i)?.[1],
        new Date(renewed.expiresAt).toUTCString(),
      );
      const age = Number(refreshedCookie.match(/; Max-Age=(\d+)/i)?.[1]);
      assert.ok(age >= sevenDays - 2 && age <= sevenDays);
      const status = await get('/api/access/status', cookie);
      assert.equal(status.status, 200);
      assert.equal(status.headers.get('set-cookie'), null);
      assert.deepEqual(await status.json(), renewed);
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
    const revoked = await post('/api/access/activity', null, cookie);
    assert.equal(revoked.status, 401);
    assert.equal(revoked.headers.get('set-cookie'), null);
    assert.equal((await get('/orders', cookie)).status, 303);
  },
);
