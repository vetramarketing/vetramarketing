import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import test from 'node:test';
import {
  createPostTableFixture,
  Element,
  type PostTableFixtureOptions,
} from './helpers/post-table-fixture';

const source = readFileSync('public/console-scripts/facebook-copy-post-table-html.js', 'utf8');
const fixture = (options: PostTableFixtureOptions = {}) =>
  createPostTableFixture(source, { captureClipboard: true, ...options });
const copiedMessages = (app: ReturnType<typeof fixture>) =>
  app.logs.filter((message) => message.startsWith('Copied post table outerHTML'));

for (const label of ['คลังเนื้อหา', 'Content library', ' CONTENT   LIBRARY ']) {
  test(`scrolls then copies exact table outerHTML for ${label}, excluding surrounding UI`, async () => {
    const app = fixture({ label });
    app.panel.append(new Element('nav', {}, 'Unrelated navigation'));
    assert.equal(app.copies.length, 0, 'Copy must wait for scrolling to finish.');
    await app.finish();
    assert.equal(app.copies.length, 1);
    assert.equal(app.copies[0].html, app.table.outerHTML);
    assert.equal(app.copies[0].method, 'devtools');
    assert.doesNotMatch(app.copies[0].html, /Unrelated navigation|<html/);
    assert.ok(app.copies[0].at >= 8000);
    assert.ok(app.scrolls.length > 0);
    assert.equal(copiedMessages(app).length, 1);
    assert.match(copiedMessages(app)[0], /2 rendered data rows/);
    assert.match(copiedMessages(app)[0], /virtualized rows may be missing/);
    assert.equal(app.errors.length, 0);
    assert.equal(app.window.postTableScrollRunning, false);
    assert.equal(app.listeners.size, 0);
  });
}

test('sorts Viewers descending and waits for late rows before copying the resulting markup', async () => {
  const app = fixture({ viewersSort: 'none', sortDelay: 700, newRowsAt: 5000 });
  assert.equal(app.scrolls.length, 0);
  assert.equal(app.copies.length, 0);
  await app.finish();
  assert.deepEqual(app.clicks, [{ label: 'ผู้ชม', at: 0 }]);
  assert.ok(app.scrolls.every((scroll) => scroll.at >= 1200));
  assert.equal(app.tbody.children.length, 3);
  assert.equal(app.copies.length, 1);
  assert.equal(app.copies[0].html, app.table.outerHTML);
  assert.ok(app.copies[0].at >= 13000);
  assert.match(copiedMessages(app)[0], /3 rendered data rows/);
});

test('retains the DevTools copy helper captured before asynchronous scrolling', async () => {
  const app = fixture({ expireDevtoolsCopy: true });
  await app.finish();
  assert.equal(app.copies.length, 1);
  assert.equal(app.copies[0].method, 'devtools');
  assert.equal(app.errors.length, 0);
});

for (const headers of [
  ['Preview', 'Views', 'Viewers'],
  ['ตัวอย่าง', 'ยอดดู', 'ผู้ชม'],
]) {
  test(`falls back to paired post and viewer headers: ${headers.join('/')}`, async () => {
    const app = fixture({ label: '', headers });
    await app.finish();
    assert.equal(app.copies.length, 1);
  });
}

for (const target of ['none', 'horizontal'] as const) {
  test(`copies the current exact snapshot when there is no vertical scroller: ${target}`, async () => {
    const app = fixture({ target });
    await app.finish();
    assert.equal(app.scrolls.length, 0);
    assert.equal(app.elapsed, 0);
    assert.equal(app.copies.length, 1);
    assert.equal(app.copies[0].html, app.table.outerHTML);
    assert.equal(app.listeners.size, 0);
  });
}

test('ignores a hidden duplicate table', async () => {
  const app = fixture({ hiddenDuplicate: true });
  await app.finish();
  assert.equal(app.copies.length, 1);
});

for (const options of [
  { missing: true },
  { duplicate: true },
  { label: 'Orders', headers: ['Product', 'Units'] },
  { headers: ['Preview', 'Views'] },
  { duplicateViewersHeader: true },
  { viewersSort: 'none', sortButtonDisabled: true },
  { viewersSort: 'none', sortFails: true },
  { loaderUntil: 60000 },
  { detachAt: 200 },
  { unreachableBottom: true },
  { endless: true },
] satisfies PostTableFixtureOptions[]) {
  test(`leaves the clipboard unchanged when the scrolling workflow cannot complete: ${JSON.stringify(options)}`, async () => {
    const app = fixture(options);
    await app.finish();
    assert.equal(app.copies.length, 0);
    assert.equal(copiedMessages(app).length, 0);
    assert.equal(app.listeners.size, 0);
    assert.notEqual(app.window.postTableScrollRunning, true);
  });
}

for (const stop of ['Escape', 'command', 'flag']) {
  test(`cancels both scrolling and copying on ${stop}`, async () => {
    const app = fixture();
    if (stop === 'Escape') app.pressKey('Escape');
    if (stop === 'command') app.window.stopPostTableScroll!();
    if (stop === 'flag') app.window.stopPostTableScrollRequested = true;
    await app.finish();
    assert.equal(app.copies.length, 0);
    assert.equal(copiedMessages(app).length, 0);
    assert.equal(app.window.postTableScrollRunning, false);
    assert.equal(app.listeners.size, 0);
  });
}

test('Escape during sorting prevents every scroll and copy', async () => {
  const app = fixture({ viewersSort: 'none', sortDelay: 5000, sortStopAt: 200 });
  await app.finish();
  assert.equal(app.scrolls.length, 0);
  assert.equal(app.copies.length, 0);
  assert.equal(app.listeners.size, 0);
});

test('a duplicate paste does not copy early or disrupt the active scroll run', async () => {
  const app = fixture();
  const stop = app.window.stopPostTableScroll;
  await app.runAgain();
  assert.equal(app.copies.length, 0);
  assert.equal(app.window.stopPostTableScroll, stop);
  assert.equal(app.listeners.size, 1);
  await app.finish();
  assert.equal(app.copies.length, 1);
  assert.equal(app.listeners.size, 0);
});

for (const options of [{ duplicateOnCleanup: true }, { replaceOnCleanup: true }]) {
  test(`rechecks the selected table before copying: ${JSON.stringify(options)}`, async () => {
    const app = fixture(options);
    await app.finish();
    assert.equal(app.copies.length, 0);
    assert.equal(copiedMessages(app).length, 0);
    assert.equal(app.listeners.size, 0);
  });
}

test('uses the clipboard API after scrolling when DevTools copy is unavailable', async () => {
  const app = fixture({ devtools: false });
  await app.finish();
  assert.equal(app.copies.length, 1);
  assert.equal(app.copies[0].method, 'clipboard');
  assert.equal(app.copies[0].html, app.table.outerHTML);
  assert.ok(app.copies[0].at >= 8000);
  assert.equal(copiedMessages(app).length, 1);
});

for (const options of [
  { devtools: false, clipboardDenied: true },
  { devtools: false, clipboardMissing: true },
  { copyFails: true },
]) {
  test(`reports copy failures without false success: ${JSON.stringify(options)}`, async () => {
    const app = fixture(options);
    await app.finish();
    assert.equal(app.copies.length, 0);
    assert.equal(copiedMessages(app).length, 0);
    assert.equal(app.errors.length, 1);
    assert.equal(app.listeners.size, 0);
  });
}

test('a scroll exception releases control without copying', async () => {
  const app = fixture({ throwOnScroll: true });
  await assert.rejects(app.finish(), /Simulated scroll failure/);
  assert.equal(app.copies.length, 0);
  assert.equal(app.window.postTableScrollRunning, false);
  assert.equal(app.listeners.size, 0);
});
