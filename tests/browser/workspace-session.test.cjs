// Run only against a disposable local server configured with VETRA_TEST_WORKSPACE_PIN.
const assert = require('node:assert/strict');
const test = require('node:test');
const { createEmptyWorkspace } = require('../../src/lib/data.ts');
const { serializeWorkspace, WORKSPACE_KEY } = require('../../src/lib/workspace-storage.ts');
const { unlockTestContext } = require('./access-fixture.cjs');

const app = process.env.VETRA_TEST_BROWSER_URL;
const hideTab = (page) =>
  page.evaluate(() => {
    Object.defineProperty(document, 'visibilityState', { configurable: true, value: 'hidden' });
    window.dispatchEvent(new Event('blur'));
    document.dispatchEvent(new Event('visibilitychange'));
  });
const returnToTab = (page) =>
  page.evaluate(() => {
    delete document.visibilityState;
    document.dispatchEvent(new Event('visibilitychange'));
    window.dispatchEvent(new Event('focus'));
  });

test(
  'workspace access shields loaded drafts, cached records, other tabs and history',
  { skip: !app, timeout: 120_000 },
  async (t) => {
    const base = new URL(app).origin;
    const { chromium } = require(process.env.VETRA_TEST_PLAYWRIGHT || 'playwright-core');
    const browser = await chromium.launch({ executablePath: process.env.VETRA_TEST_CHROMIUM });
    t.after(() => browser.close());
    const source = createEmptyWorkspace();
    source.products.push({
      id: 'session-test-product',
      name: 'Session test product',
      companyIds: ['vetra'],
      imageUrl: '',
      sortOrder: 0,
    });
    const workspace = serializeWorkspace(source);
    const scope = 'c'.repeat(32);
    const snapshot = {
      configured: true,
      workspace,
      revision: 'session-test-1',
      databaseScope: scope,
    };

    async function fixture(t) {
      const context = await browser.newContext({
        serviceWorkers: 'block',
        reducedMotion: 'reduce',
      });
      t.after(() => context.close());
      await unlockTestContext(context, base);
      const mock = { reads: 0, renewals: 0 };
      await context.addInitScript(() => localStorage.setItem('vetra-marketing.locale', 'en'));
      await context.route('**/*', async (route) => {
        const { pathname, origin } = new URL(route.request().url());
        if (origin !== base) return route.abort();
        if (pathname === '/api/access/status')
          return mock.status ? mock.status(route) : route.continue();
        if (pathname === '/api/access/activity') {
          mock.renewals++;
          return mock.activity ? mock.activity(route) : route.continue();
        }
        if (pathname === '/api/access/lock') return mock.lock ? mock.lock(route) : route.continue();
        if (pathname === '/api/workspace' && route.request().method() === 'GET') {
          mock.reads++;
          return mock.workspace ? mock.workspace(route) : route.fulfill({ json: snapshot });
        }
        if (pathname === '/api/workspace' && route.request().method() === 'POST' && mock.save)
          return mock.save(route);
        if (pathname.startsWith('/api/') || route.request().method() !== 'GET')
          return route.abort();
        return route.continue();
      });
      const page = await context.newPage();
      page.setDefaultTimeout(8000);
      const lock = page.getByRole('button', { name: 'Lock workspace', exact: true });
      const revoke = async () => {
        const response = await context.request.post(base + '/api/access/lock', {
          headers: { Origin: base },
          maxRedirects: 0,
        });
        assert.equal(response.status(), 303);
        await response.dispose();
      };
      return { mock, page, lock, context, revoke };
    }

    await t.test(
      'the initial session check gates all workspace reads and recovery copies',
      async (t) => {
        const { mock, page, lock } = await fixture(t);
        mock.status = (route) => route.abort('internetdisconnected');
        await page.goto(base + '/');
        const retry = page.getByRole('button', { name: 'Retry', exact: true });
        await retry.waitFor();
        assert.equal(mock.reads, 0);
        assert.equal(await lock.count(), 0);
        assert.equal(await page.getByRole('button', { name: /last synced/i }).count(), 0);
        mock.status = null;
        await retry.click();
        await lock.waitFor();
        await page.waitForFunction(
          () =>
            document.querySelector('main') &&
            !document.querySelector('dialog[data-vetra-shield]').open,
        );
        assert.ok(mock.reads > 0);
      },
    );

    await t.test(
      'a routine tab switch verifies once in the background and leaves the focused draft editable',
      async (t) => {
        const { mock, page } = await fixture(t);
        await page.goto(base + '/products');
        await page.getByRole('button', { name: 'Edit Session test product' }).click();
        const name = page.getByLabel('Product name', { exact: true });
        const shield = page.locator('dialog[data-vetra-shield]');
        await name.fill('Unsaved draft');
        let release;
        const gate = new Promise((resolve) => {
          release = resolve;
        });
        let calls = 0;
        mock.status = async (route) => {
          calls++;
          await gate;
          await route.fulfill({ json: { authenticated: true, expiresAt: Date.now() + 60000 } });
        };
        const request = page.waitForRequest((r) => r.url().endsWith('/api/access/status'));
        await hideTab(page);
        assert.equal(await shield.isVisible(), false);
        await returnToTab(page);
        await request;
        assert.equal(await shield.isVisible(), false);
        assert.equal(await name.evaluate((el) => el === document.activeElement), true);
        await name.press('End');
        await name.pressSequentially(' continued');
        assert.equal(await name.inputValue(), 'Unsaved draft continued');
        const response = page.waitForResponse((r) => r.url().endsWith('/api/access/status'));
        release();
        await response;
        assert.equal(calls, 1);
        assert.equal(await shield.isVisible(), false);
      },
    );

    await t.test(
      'idle checks never renew; trusted input renews immediately and coalesces a final update',
      async (t) => {
        const { mock, page } = await fixture(t);
        const now = Date.now();
        await page.clock.install({ time: new Date(now) });
        const status = { authenticated: true, expiresAt: now + 7 * 86400_000 };
        mock.status = (route) => route.fulfill({ json: status });
        mock.activity = (route) => {
          assert.equal(route.request().method(), 'POST');
          return route.fulfill({ json: status });
        };
        const response = () =>
          page.waitForResponse((r) => r.url().endsWith('/api/access/activity'));
        await page.goto(base + '/products');
        const edit = page.getByRole('button', { name: 'Edit Session test product' });
        await edit.waitFor();
        await hideTab(page);
        const checked = page.waitForResponse((r) => r.url().endsWith('/api/access/status'));
        await returnToTab(page);
        await checked;
        await page.evaluate(() => {
          for (const type of ['keydown', 'input', 'pointerdown', 'click', 'wheel', 'touchmove'])
            document.dispatchEvent(new Event(type, { bubbles: true }));
        });
        await page.clock.fastForward(300_000);
        assert.equal(mock.renewals, 0);

        const first = response();
        await edit.click();
        await first;
        const name = page.getByLabel('Product name', { exact: true });
        await name.fill('Draft from keyboard');
        await name.pressSequentially(' and mouse');
        await page.mouse.wheel(0, 60);
        await page.clock.fastForward(50_000);
        assert.equal(mock.renewals, 1);
        const trailing = response();
        await page.clock.fastForward(11_000);
        await trailing;
        assert.equal(mock.renewals, 2);
        await page.clock.fastForward(900_000);
        assert.equal(mock.renewals, 2);
        assert.equal(await name.inputValue(), 'Draft from keyboard and mouse');

        const scroll = response();
        await page.mouse.wheel(0, 120);
        await scroll;
        await name.press('End');
        const final = response();
        await hideTab(page);
        await final;
        assert.equal(mock.renewals, 4);
        await page.clock.fastForward(900_000);
        assert.equal(mock.renewals, 4);
      },
    );

    await t.test(
      'a foreground interaction renews a nearly expired session while a resume check is pending',
      async (t) => {
        const { mock, page } = await fixture(t);
        const now = Date.now();
        await page.clock.install({ time: new Date(now) });
        mock.status = (route) =>
          route.fulfill({ json: { authenticated: true, expiresAt: now + 5000 } });
        mock.activity = (route) =>
          route.fulfill({ json: { authenticated: true, expiresAt: now + 7 * 86400_000 } });
        await page.goto(base + '/products');
        const edit = page.getByRole('button', { name: 'Edit Session test product' });
        await edit.waitFor();
        let release;
        const gate = new Promise((resolve) => {
          release = resolve;
        });
        mock.status = async (route) => {
          await gate;
          await route
            .fulfill({ json: { authenticated: true, expiresAt: now + 5000 } })
            .catch(() => {});
        };
        await hideTab(page);
        const checking = page.waitForRequest((r) => r.url().endsWith('/api/access/status'));
        await returnToTab(page);
        await checking;
        const renewed = page.waitForResponse((r) => r.url().endsWith('/api/access/activity'));
        await edit.click();
        await renewed;
        release();
        const name = page.getByLabel('Product name', { exact: true });
        await name.fill('Kept past the old deadline');
        await page.clock.fastForward(6000);
        assert.equal(await page.locator('dialog[data-vetra-shield]').isVisible(), false);
        assert.equal(await name.inputValue(), 'Kept past the old deadline');
      },
    );

    await t.test(
      'another tab can renew the same session while an idle tab only reads the new deadline',
      async (t) => {
        const { mock, page, context, lock } = await fixture(t);
        const now = Date.now();
        let expiresAt = now + 8_000;
        await page.clock.install({ time: new Date(now) });
        mock.status = (route) => route.fulfill({ json: { authenticated: true, expiresAt } });
        mock.activity = (route) => {
          expiresAt = now + 7 * 86400_000;
          return route.fulfill({ json: { authenticated: true, expiresAt } });
        };
        await page.goto(base + '/products');
        await lock.waitFor();
        await hideTab(page);
        const second = await context.newPage();
        await second.goto(base + '/products');
        const renewed = second.waitForResponse((r) => r.url().endsWith('/api/access/activity'));
        await second.getByRole('button', { name: 'Edit Session test product' }).click();
        await renewed;
        assert.equal(mock.renewals, 1);
        const rechecked = page.waitForResponse((r) => r.url().endsWith('/api/access/status'));
        await page.clock.fastForward(9_000);
        await rechecked;
        await page.bringToFront();
        await returnToTab(page);
        await lock.waitFor();
        assert.equal(mock.renewals, 1);
        assert.equal(await page.locator('dialog[data-vetra-shield]').isVisible(), false);
      },
    );

    await t.test(
      'a failed activity request keeps the draft covered until a successful status retry',
      async (t) => {
        const { mock, page } = await fixture(t);
        let release;
        const gate = new Promise((resolve) => {
          release = resolve;
        });
        mock.activity = async (route) => {
          await gate;
          await route.fulfill({ status: 503, body: '' });
        };
        await page.goto(base + '/products');
        const request = page.waitForRequest((r) => r.url().endsWith('/api/access/activity'));
        await page.getByRole('button', { name: 'Edit Session test product' }).click();
        await request;
        const name = page.getByLabel('Product name', { exact: true });
        await name.fill('Unsaved during activity outage');
        release();
        const retry = page.getByRole('button', { name: 'Retry', exact: true });
        await retry.waitFor();
        assert.equal(await name.isVisible(), false);
        await retry.click();
        await name.waitFor();
        assert.equal(await name.inputValue(), 'Unsaved during activity outage');
        assert.equal(mock.renewals, 1);
      },
    );

    await t.test(
      'a failed background check shields the draft, and a back-forward cache restore rechecks before uncovering it',
      async (t) => {
        const { mock, page } = await fixture(t);
        await page.goto(base + '/products');
        await page.getByRole('button', { name: 'Edit Session test product' }).click();
        const name = page.getByLabel('Product name', { exact: true });
        await name.fill('Unsaved session draft');
        await hideTab(page);
        mock.status = (route) => route.fulfill({ status: 503, body: '' });
        await returnToTab(page);
        const retry = page.getByRole('button', { name: 'Retry', exact: true });
        await retry.waitFor();
        await page.keyboard.press('Escape');
        assert.ok(await retry.isVisible());
        mock.status = null;
        await retry.click();
        await name.waitFor();
        assert.equal(await name.inputValue(), 'Unsaved session draft');
        await page.evaluate(() =>
          window.dispatchEvent(new PageTransitionEvent('pagehide', { persisted: true })),
        );
        assert.equal(await page.getByRole('textbox', { name: 'Product name' }).count(), 0);
        let release;
        const gate = new Promise((resolve) => {
          release = resolve;
        });
        mock.status = async (route) => {
          await gate;
          await route.continue();
        };
        const restored = page.waitForRequest((r) => r.url().endsWith('/api/access/status'));
        await page.evaluate(() =>
          window.dispatchEvent(new PageTransitionEvent('pageshow', { persisted: true })),
        );
        await restored;
        assert.ok(await page.locator('dialog[data-vetra-shield]').isVisible());
        release();
        await name.waitFor();
        assert.equal(await name.inputValue(), 'Unsaved session draft');
      },
    );

    await t.test(
      'an unverified private save shields the existing draft and restores it after revalidation',
      async (t) => {
        const { mock, page } = await fixture(t);
        await page.goto(base + '/products');
        await page.getByRole('button', { name: 'Edit Session test product' }).click();
        const name = page.getByLabel('Product name', { exact: true });
        await name.fill('Unsaved after private API outage');
        mock.save = (route) =>
          route.fulfill({
            status: 503,
            headers: { 'X-Vetra-Session': 'unavailable' },
            json: { code: 'SESSION_VERIFICATION_UNAVAILABLE' },
          });
        await page.getByRole('button', { name: 'Save', exact: true }).click();
        const retry = page.getByRole('button', { name: 'Retry', exact: true });
        await retry.waitFor();
        assert.equal(await page.getByRole('textbox', { name: 'Product name' }).count(), 0);
        assert.equal(new URL(page.url()).pathname, '/products');
        await retry.click();
        await name.waitFor();
        assert.equal(await name.inputValue(), 'Unsaved after private API outage');
      },
    );

    await t.test(
      'manual lock retries a failed revocation, locks both tabs and preserves stored recovery data across Back',
      async (t) => {
        const { mock, page, lock, context } = await fixture(t);
        await page.setViewportSize({ width: 390, height: 844 });
        await page.goto(base + '/groups');
        await lock.waitFor();
        await page.goto(base + '/products');
        await lock.waitFor();
        await page.evaluate(
          (key) => localStorage.setItem(key, 'synthetic preserved backup'),
          WORKSPACE_KEY,
        );
        const other = await context.newPage();
        await other.goto(base + '/posts');
        await other.getByRole('button', { name: 'Add post', exact: true }).first().click();
        await other
          .getByPlaceholder('https://', { exact: true })
          .fill('https://example.com/unsaved');
        const unloadDialogs = [];
        other.on('dialog', async (dialog) => {
          unloadDialogs.push(dialog.type());
          await dialog.dismiss();
        });
        mock.lock = (route) => route.fulfill({ status: 503, body: '' });
        await lock.click();
        const retry = page.getByRole('button', { name: 'Retry lock', exact: true });
        await retry.waitFor();
        assert.equal(new URL(page.url()).pathname, '/products');
        assert.equal(await lock.count(), 0);
        mock.lock = null;
        await retry.click();
        await page.waitForURL(base + '/unlock?next=%2Fproducts');
        await other.waitForURL(base + '/unlock?next=%2Fposts');
        assert.deepEqual(unloadDialogs, []);
        assert.equal(
          await page.evaluate((key) => localStorage.getItem(key), WORKSPACE_KEY),
          'synthetic preserved backup',
        );
        await page.goBack();
        await page.waitForURL(base + '/unlock?next=%2Fgroups');
        assert.equal(await lock.count(), 0);
      },
    );

    await t.test(
      'an open, untouched tab returns to unlock at the advertised expiration',
      async (t) => {
        const { mock, page, lock, revoke } = await fixture(t);
        let expiresAt;
        mock.status = async (route) => {
          if (!expiresAt) expiresAt = Date.now() + 2500;
          if (Date.now() < expiresAt)
            return route.fulfill({ json: { authenticated: true, expiresAt } });
          await revoke();
          return route.fulfill({ status: 401, body: '' });
        };
        await page.goto(base + '/products');
        await lock.waitFor();
        await page.waitForURL(base + '/unlock?next=%2Fproducts', { timeout: 8000 });
      },
    );

    await t.test(
      'expiry covers the workspace immediately while an earlier background check is still pending',
      async (t) => {
        const { mock, page, lock, revoke } = await fixture(t);
        let calls = 0;
        let release;
        const gate = new Promise((resolve) => {
          release = resolve;
        });
        mock.status = async (route) => {
          if (++calls === 1)
            return route.fulfill({ json: { authenticated: true, expiresAt: Date.now() + 2500 } });
          await gate;
          await route.fulfill({ status: 401, body: '' });
        };
        await page.goto(base + '/products');
        await lock.waitFor();
        const request = page.waitForRequest((r) => r.url().endsWith('/api/access/status'));
        await hideTab(page);
        await returnToTab(page);
        await request;
        const shield = page.locator('dialog[data-vetra-shield]');
        assert.equal(await shield.isVisible(), false);
        await shield.waitFor();
        assert.equal(calls, 2);
        await page.waitForFunction(
          () =>
            document.documentElement.hasAttribute('data-vetra-covered') &&
            document.querySelector('dialog[data-vetra-shield]')?.matches(':modal') &&
            document.querySelector('main')?.closest('[inert]'),
        );
        await lock.waitFor({ state: 'hidden' });
        await revoke();
        release();
        await page.waitForURL(base + '/unlock?next=%2Fproducts');
      },
    );

    await t.test(
      'a private API 401 after a confirmed snapshot blocks even a matching outage payload',
      async (t) => {
        const { mock, page, revoke } = await fixture(t);
        await page.goto(base + '/products');
        await page.getByRole('button', { name: 'Edit Session test product' }).waitFor();
        mock.workspace = async (route) => {
          await revoke();
          return route.fulfill({
            status: 401,
            json: { code: 'WORKSPACE_SERVICE_UNAVAILABLE', databaseScope: scope },
          });
        };
        await page.reload();
        await page.waitForURL(base + '/unlock?next=%2Fproducts');
        assert.equal(await page.getByRole('button', { name: /last synced/i }).count(), 0);
      },
    );
  },
);
