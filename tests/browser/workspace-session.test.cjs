// Run only against a disposable local server configured with VETRA_TEST_WORKSPACE_PIN.
const assert = require('node:assert/strict');
const test = require('node:test');
const { createEmptyWorkspace } = require('../../src/lib/data.ts');
const { serializeWorkspace, WORKSPACE_KEY } = require('../../src/lib/workspace-storage.ts');
const { unlockTestContext } = require('./access-fixture.cjs');

const app = process.env.VETRA_TEST_BROWSER_URL;
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
      const mock = { reads: 0 };
      await context.addInitScript(() => localStorage.setItem('vetra-marketing.locale', 'en'));
      await context.route('**/*', async (route) => {
        const { pathname, origin } = new URL(route.request().url());
        if (origin !== base) return route.abort();
        if (pathname === '/api/access/status')
          return mock.status ? mock.status(route) : route.continue();
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
      'a returning tab keeps its editor shielded through an outage and restores its draft after verification',
      async (t) => {
        const { mock, page } = await fixture(t);
        await page.goto(base + '/products');
        await page.getByRole('button', { name: 'Edit Session test product' }).click();
        const name = page.getByLabel('Product name', { exact: true });
        await name.fill('Unsaved session draft');
        await page.evaluate(() => {
          Object.defineProperty(document, 'visibilityState', {
            configurable: true,
            value: 'hidden',
          });
          document.dispatchEvent(new Event('visibilitychange'));
        });
        assert.equal(await page.getByRole('textbox', { name: 'Product name' }).count(), 0);
        assert.ok(await page.locator('dialog[data-vetra-shield]').isVisible());
        mock.status = (route) => route.fulfill({ status: 503, body: '' });
        await page.evaluate(() => {
          delete document.visibilityState;
          window.dispatchEvent(new PageTransitionEvent('pageshow', { persisted: true }));
        });
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
        await page.evaluate(() =>
          window.dispatchEvent(new PageTransitionEvent('pageshow', { persisted: true })),
        );
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
