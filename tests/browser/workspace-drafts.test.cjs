// Set VETRA_TEST_BROWSER_URL and VETRA_TEST_WORKSPACE_PIN for a disposable local app.
// node --import tsx --test tests/browser/workspace-drafts.test.cjs
const assert = require('node:assert/strict');
const test = require('node:test');
const { createEmptyWorkspace } = require('../../src/lib/data.ts');
const { newCustomer } = require('../../src/lib/customer-data.ts');
const { serializeWorkspace } = require('../../src/lib/workspace-storage.ts');
const { unlockTestContext } = require('./access-fixture.cjs');

const app = process.env.VETRA_TEST_BROWSER_URL;
test(
  'unsaved drafts survive history and failed saves, and stay outside the read-only cache',
  { skip: !app, timeout: 120_000 },
  async (t) => {
    const base = new URL(app).origin;
    assert.ok(['localhost', '127.0.0.1', '[::1]'].includes(new URL(base).hostname));
    const { chromium } = require(process.env.VETRA_TEST_PLAYWRIGHT || 'playwright-core');
    const browser = await chromium.launch({ executablePath: process.env.VETRA_TEST_CHROMIUM });
    t.after(() => browser.close());
    const context = await browser.newContext({ serviceWorkers: 'block', reducedMotion: 'reduce' });
    await unlockTestContext(context, base);
    await context.addInitScript(() => localStorage.setItem('vetra-marketing.locale', 'en'));
    const source = createEmptyWorkspace();
    source.groups.push({
      id: 'test-group',
      companyId: 'vetra',
      name: 'Test group',
      facebookId: '12345678',
      notes: 'Saved note',
      category: '',
    });
    source.companies.push({
      ...source.companies[0],
      id: 'second-company',
      name: 'Second test company',
      sortOrder: 10,
    });
    source.customers.push({ ...newCustomer('second-company'), name: 'Saved test customer' });
    source.products.push({
      id: 'test-product',
      name: 'Test product',
      companyIds: ['vetra'],
      imageUrl: '',
      sortOrder: 0,
    });
    let workspace = serializeWorkspace(source);
    let writes = 0;
    let rejectNextWrite;
    let mode = 'online';
    const scope = 'a'.repeat(32);
    await context.route('**/*', async (route) => {
      const request = route.request();
      const url = new URL(request.url());
      if (url.origin !== base) return route.abort();
      if (url.pathname === '/api/access/status')
        return route.fulfill({ json: { authenticated: true, expiresAt: Date.now() + 3_600_000 } });
      if (url.pathname === '/api/workspace') {
        if (request.method() === 'POST') {
          writes++;
          if (rejectNextWrite) {
            await rejectNextWrite;
            rejectNextWrite = undefined;
            return route.fulfill({
              status: 503,
              json: { code: 'WORKSPACE_SERVICE_UNAVAILABLE', databaseScope: scope },
            });
          }
          assert.equal(mode, 'online');
          workspace = request.postDataJSON().workspace;
        }
        if (mode === 'denied')
          return route.fulfill({ status: 403, json: { code: 'LOCAL_ACCESS_REQUIRED' } });
        if (mode !== 'online')
          return route.fulfill({
            status: 503,
            json: {
              code: 'WORKSPACE_SERVICE_UNAVAILABLE',
              databaseScope: mode === 'different' ? 'b'.repeat(32) : scope,
            },
          });
        return route.fulfill({
          json: { configured: true, workspace, revision: 'test-' + writes, databaseScope: scope },
        });
      }
      if (url.pathname.startsWith('/api/') || request.method() !== 'GET') return route.abort();
      return route.continue();
    });
    const page = await context.newPage();
    page.setDefaultTimeout(6000);
    const errors = [];
    page.on('pageerror', (error) => errors.push(error.message));
    const button = (name) => page.getByRole('button', { name, exact: true });
    const navigate = async (name) => {
      await page.locator('button[aria-controls="workspace-navigation"]').click();
      await page.locator('#workspace-navigation nav').getByText(name, { exact: true }).click();
      await page.locator('#workspace-navigation').waitFor({ state: 'hidden' });
    };

    await page.goto(base + '/groups');
    await button('Edit Test group').click();
    const notes = page.getByRole('textbox', { name: 'Posting notes', exact: true });
    await notes.fill('My group draft');
    page.once('dialog', (dialog) => dialog.dismiss());
    await button('Add group').click();
    assert.equal(await notes.inputValue(), 'My group draft');
    await button('Edit Test group').click();
    assert.equal(await notes.inputValue(), 'My group draft');
    await page.getByRole('link', { name: 'Home', exact: true }).click();
    await page.waitForURL(base + '/');
    await page.goBack();
    assert.equal(await notes.inputValue(), 'My group draft');

    const beforeSave = writes;
    let release;
    rejectNextWrite = new Promise((resolve) => {
      release = resolve;
    });
    const posted = page.waitForRequest(
      (request) => request.method() === 'POST' && request.url() === base + '/api/workspace',
    );
    await button('Save group').evaluate((element) => {
      element.click();
      element.click();
    });
    await posted;
    assert.ok(await notes.isDisabled());
    await navigate('Orders');
    await notes.waitFor({ state: 'hidden' });
    release();
    const cacheOffer = button('Open last synced copy · Read only');
    await cacheOffer.waitFor();
    await page.goBack();
    assert.equal(await notes.inputValue(), 'My group draft');
    assert.equal(writes, beforeSave + 1);
    assert.equal(workspace.groups.find((group) => group.id === 'test-group').notes, 'Saved note');
    page.once('dialog', (dialog) => dialog.dismiss());
    await cacheOffer.click();
    assert.equal(await notes.inputValue(), 'My group draft');

    await page.getByRole('button', { name: /^Select company:/ }).click();
    await page
      .getByRole('dialog')
      .getByRole('button', { name: /Second test company/ })
      .click();
    assert.equal(await notes.inputValue(), 'My group draft');
    await button('Save group').click();
    await notes.waitFor({ state: 'hidden' });
    await cacheOffer.waitFor({ state: 'hidden' });
    const savedGroup = workspace.groups.find((group) => group.id === 'test-group');
    assert.equal(savedGroup.notes, 'My group draft');
    assert.equal(savedGroup.companyId, 'vetra');

    await navigate('Orders');
    await button('New order').click();
    const orderNotes = page.locator('dialog[open] textarea').last();
    await orderNotes.fill('My order draft');
    await page.goBack();
    await orderNotes.waitFor({ state: 'hidden' });
    await page.goForward();
    assert.equal(await orderNotes.inputValue(), 'My order draft');
    await button('Close order editor').click();
    await button('Discard changes').click();

    await navigate('Customers');
    await button('Add customer').click();
    const customerNotes = page.getByPlaceholder('Add a note', { exact: true });
    await customerNotes.fill('My customer draft');
    await page.goBack();
    await customerNotes.waitFor({ state: 'hidden' });
    await page.goForward();
    assert.equal(await customerNotes.inputValue(), 'My customer draft');
    await page.goBack();
    await button('Search workspace').click();
    await page.getByRole('combobox').fill('Saved test customer');
    await page.getByRole('option', { name: /Saved test customer/ }).click();
    await page
      .getByText('Save or close your open customer draft before opening another customer.', {
        exact: true,
      })
      .waitFor();
    assert.equal(await customerNotes.inputValue(), 'My customer draft');
    await button('Close customer editor').click();
    await button('Discard changes').click();

    await navigate('Companies');
    await button('Edit Second test company').click();
    const companyName = page.getByLabel('Company name', { exact: true });
    await companyName.fill('Temporary company draft');
    await navigate('Products');
    await button('Add product').click();
    const productName = page.getByLabel('Product name', { exact: true });
    await productName.fill('My product draft');
    await page.goBack();
    assert.equal(await companyName.inputValue(), 'Temporary company draft');
    await page.goForward();
    assert.equal(await productName.inputValue(), 'My product draft');
    await navigate('Facebook groups');
    await page.getByRole('button', { name: /^Select company:/ }).click();
    await page
      .getByRole('dialog')
      .getByRole('button', { name: /VETRA STORE/i })
      .click();
    await button('Edit Test group').click();
    await notes.fill('Never committed');
    rejectNextWrite = Promise.resolve();
    await button('Save group').click();
    await cacheOffer.waitFor();
    const afterSave = writes;
    mode = 'offline';
    page.once('dialog', (dialog) => dialog.accept());
    await cacheOffer.click();
    assert.match(await page.locator('main').innerText(), /Last synced .* ICT/);
    await navigate('Products');
    await productName.waitFor({ state: 'hidden' });
    await navigate('Companies');
    await companyName.waitFor({ state: 'hidden' });
    await navigate('Facebook groups');
    assert.equal(await button('Edit Test group').count(), 0);
    await page.getByText('My group draft', { exact: true }).waitFor();
    for (const failure of ['different', 'denied']) {
      mode = failure;
      await page.reload();
      await page.getByText('Workspace connection unavailable', { exact: true }).waitFor();
      assert.equal(await button('Open last synced workspace · Read only').count(), 0);
    }
    mode = 'offline';
    await page.reload();
    await button('Open last synced workspace · Read only').click();
    mode = 'online';
    await button('Reconnect to MongoDB').click();
    await button('Edit Test group').waitFor();
    assert.equal(writes, afterSave);
    assert.deepEqual(errors, []);
  },
);
