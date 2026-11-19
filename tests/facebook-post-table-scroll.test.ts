import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import test from 'node:test';
import {
  createPostTableFixture,
  type PostTableFixtureOptions as Options,
} from './helpers/post-table-fixture';

const source = readFileSync(
  new URL('../public/console-scripts/facebook-post-table-fast-scroll.js', import.meta.url),
  'utf8',
);

const fixture = (options: Options = {}) => createPostTableFixture(source, options);

for (const target of ['panel', 'root', 'table', 'tbody'] as const) {
  test(`scrolls the ${target} instantly every 100 ms and preserves horizontal position`, async () => {
    const app = fixture({ target });
    await app.finish();
    assert.ok(app.scrolls.length >= 80);
    assert.ok(
      app.scrolls.every(
        (scroll) =>
          scroll.element === app.scroller && scroll.behavior === 'instant' && scroll.left === 175,
      ),
    );
    assert.ok(app.delays.every((delay) => delay === 100));
    assert.ok(app.elapsed >= 8000 && app.elapsed < 12000);
    assert.equal(app.window.postTableScrollRunning, false);
    assert.equal(app.listeners.size, 0);
    assert.equal(Object.hasOwn(app.window, 'stopPostTableScroll'), false);
    assert.match(app.messages.at(-1)!, /does not confirm every post loaded/);
  });
}

test('uses the outer scrolling panel when an inner table accepts scrollTo without moving', async () => {
  const app = fixture({ target: 'inert-table' });
  await app.finish();
  assert.ok(app.scrolls.some((scroll) => scroll.element === app.table));
  assert.ok(app.scrolls.some((scroll) => scroll.element === app.panel));
  assert.ok(app.panel.scrollTop > 0);
  assert.equal(app.window.postTableScrollRunning, false);
  assert.equal(app.listeners.size, 0);
});

test('advances by viewport-sized steps instead of skipping directly to the distant bottom', async () => {
  const app = fixture({ target: 'table' });
  await app.finish();
  const forward = app.scrolls.filter((scroll) => scroll.element === app.table);
  assert.ok(forward[0].top > 0 && forward[0].top <= app.table.clientHeight);
  assert.ok(forward.some((scroll) => scroll.top > app.table.clientHeight));
  assert.ok(app.table.scrollTop >= app.table.scrollHeight - app.table.clientHeight - 2);
});

test('finds an outer scrolling panel through a nested clipping wrapper', async () => {
  const app = fixture({ target: 'wrapped-panel' });
  await app.finish();
  assert.ok(app.scrolls.some((scroll) => scroll.element === app.panel));
  assert.ok(app.panel.scrollTop > 0);
});

test('waits for delayed rows even when the page has no accessible loading indicator', async () => {
  const app = fixture({ newRowsAt: 5000 });
  await app.finish();
  assert.equal(app.tbody.children.length, 3);
  assert.ok(app.elapsed >= 13000);
});

test('retries the bottom with real upward and downward movement to trigger another load', async () => {
  const app = fixture({ loadAfterBoundaryRetry: true });
  await app.finish();
  assert.equal(app.tbody.children.length, 3);
  assert.ok(
    app.scrolls.some((scroll, index) => index > 0 && scroll.top < app.scrolls[index - 1].top),
  );
  assert.equal(app.scroller.scrollLeft, 175);
  assert.ok(app.scroller.scrollTop >= 2398);
});

for (const [label, headers] of [
  ['Content library', ['Preview', 'Views', 'Viewers']],
  ['unlabeled', ['Post', 'Viewers']],
  ['unlabeled', ['โพสต์', 'ผู้ชม']],
] as const) {
  test(`detects English/Thai label or headers: ${label}, ${headers.join('/')}`, async () => {
    const app = fixture({ label, headers: [...headers] });
    await app.finish();
    assert.ok(app.scrolls.length);
  });
}

for (const options of [
  { missing: true },
  { duplicate: true },
  { label: 'Unrelated', headers: ['Name', 'Views'] },
  { target: 'none' },
  { target: 'horizontal' },
] satisfies Options[]) {
  test(`fails closed without scrolling: ${JSON.stringify(options)}`, async () => {
    const app = fixture(options);
    await app.finish();
    assert.equal(app.scrolls.length, 0);
    assert.equal(app.listeners.size, 0);
    assert.match(app.messages.join('\n'), /Nothing scrolled/);
  });
}

test('ignores a hidden duplicate table', async () => {
  const app = fixture({ hiddenDuplicate: true });
  await app.finish();
  assert.ok(app.scrolls.length);
});

for (const options of [{ newRowsAt: 2500 }, { replaceRowsAt: 2500 }]) {
  test(`new or recycled row indexes restart the quiet interval: ${JSON.stringify(options)}`, async () => {
    const app = fixture(options);
    await app.finish();
    assert.ok(app.elapsed >= 10500 && app.elapsed < 15000);
  });
}

test('waits eight quiet seconds after loading disappears', async () => {
  const app = fixture({ loaderUntil: 2500 });
  await app.finish();
  assert.ok(app.elapsed >= 10500 && app.elapsed < 15000);
});

test('allows one bounded render grace when a spinner disappears near the stall deadline', async () => {
  const app = fixture({ loaderUntil: 29900 });
  await app.finish();
  assert.ok(app.elapsed >= 30000 && app.elapsed <= 32900);
});

test('hidden loading indicators do not delay completion', async () => {
  const app = fixture({ loaderUntil: 20000, hiddenLoader: true });
  await app.finish();
  assert.ok(app.elapsed >= 8000 && app.elapsed < 12000);
});

for (const options of [{ loaderUntil: 60000 }, { loaderFlicker: true }]) {
  test(`no forward progress stops after thirty seconds: ${JSON.stringify(options)}`, async () => {
    const app = fixture(options);
    await app.finish();
    assert.ok(app.elapsed >= 30000 && app.elapsed <= 34000);
    assert.match(app.messages.at(-1)!, /30 seconds/);
  });
}

test('reports an unusable container when scrolling cannot reach its claimed bottom', async () => {
  const app = fixture({ unreachableBottom: true });
  await app.finish();
  assert.ok(app.elapsed < 30000);
  assert.match(app.messages.at(-1)!, /container did not move/);
  assert.equal(app.window.postTableScrollRunning, false);
  assert.equal(app.listeners.size, 0);
});

test('stops at ten minutes even if new row content never stops', async () => {
  const app = fixture({ endless: true });
  await app.finish();
  assert.equal(app.elapsed, 600000);
  assert.match(app.messages.at(-1)!, /10-minute limit/);
});

test('stops when the table is replaced, before another scroll', async () => {
  const app = fixture({ detachAt: 200 });
  await app.finish();
  assert.equal(app.scrolls.length, 2);
  assert.match(app.messages.at(-1)!, /replaced/);
  assert.equal(app.listeners.size, 0);
});

for (const stop of ['Escape', 'command', 'flag']) {
  test(`stops immediately on ${stop} and cleans up`, async () => {
    const app = fixture();
    if (stop === 'Escape') app.pressKey('Escape');
    if (stop === 'command') app.window.stopPostTableScroll!();
    if (stop === 'flag') app.window.stopPostTableScrollRequested = true;
    await app.finish();
    assert.equal(app.scrolls.length, 1);
    assert.equal(app.elapsed, 100);
    assert.equal(app.window.postTableScrollRunning, false);
    assert.equal(app.listeners.size, 0);
  });
}

test('duplicate paste leaves the existing run and stop command intact', async () => {
  const app = fixture();
  const stop = app.window.stopPostTableScroll;
  await app.runAgain();
  assert.equal(app.window.stopPostTableScroll, stop);
  assert.equal(app.listeners.size, 1);
  assert.equal(app.scrolls.length, 1);
  stop!();
  await app.finish();
});

test('composition and unrelated keys do not stop the run', async () => {
  const app = fixture();
  app.pressKey('Enter');
  app.pressKey('Escape', true);
  await app.finish();
  assert.ok(app.elapsed >= 8000 && app.elapsed < 12000);
});

test('restores a preexisting command descriptor after stopping', async () => {
  const commandDescriptor = {
    value: () => undefined,
    writable: false,
    enumerable: true,
    configurable: true,
  };
  const app = fixture({ commandDescriptor });
  app.pressKey('Escape');
  await app.finish();
  assert.deepEqual(
    Object.getOwnPropertyDescriptor(app.window, 'stopPostTableScroll'),
    commandDescriptor,
  );
});

test('preserves a non-configurable host command while Escape remains usable', async () => {
  const commandDescriptor = {
    value: () => undefined,
    writable: false,
    enumerable: false,
    configurable: false,
  };
  const app = fixture({ commandDescriptor });
  app.pressKey('Escape');
  await app.finish();
  assert.deepEqual(
    Object.getOwnPropertyDescriptor(app.window, 'stopPostTableScroll'),
    commandDescriptor,
  );
  assert.equal(app.scrolls.length, 1);
});

for (const [label, viewersLabel] of [
  ['คลังเนื้อหา', 'ผู้ชม'],
  ['Content library', 'Viewers'],
] as const) {
  for (const viewersSort of ['none', 'ascending'] as const) {
    test(`activates only ${viewersLabel} descending from ${viewersSort} before scrolling`, async () => {
      const app = fixture({
        label,
        headers: ['Preview', 'Views', viewersLabel],
        viewersSort,
        sortDelay: 700,
      });
      assert.equal(app.scrolls.length, 0);
      await app.finish();
      assert.deepEqual(app.clicks, [{ label: viewersLabel, at: 0 }]);
      assert.equal(app.sortCompletedAt, 700);
      assert.ok(app.scrolls.length > 0);
      assert.ok(app.scrolls.every((scroll) => scroll.at >= 1200));
      assert.equal(app.window.postTableScrollRunning, false);
      assert.equal(app.listeners.size, 0);
    });
  }
}

test('keeps an already selected descending Viewers sort without toggling it', async () => {
  const app = fixture({ viewersSort: 'descending' });
  assert.equal(app.scrolls.length, 1);
  await app.finish();
  assert.deepEqual(app.clicks, []);
});

for (const target of ['panel', 'table', 'root'] as const) {
  test(`restarts a ${target} already at the bottom from the top before scrolling forward`, async () => {
    const app = fixture({ target, initialTop: 2000, viewersSort: 'descending' });
    assert.equal(app.scrolls.length, 1);
    assert.equal(app.scrolls[0].element, app.scroller);
    assert.equal(app.scrolls[0].top, 0);
    assert.equal(app.scrolls[0].left, 175);
    await app.finish();
    const firstForward = app.scrolls.find((scroll) => scroll.top > 0);
    assert.ok(firstForward);
    assert.ok(firstForward.at >= 100, 'Allow rendering after the reset before advancing.');
    assert.ok(firstForward.top <= app.scroller.clientHeight);
    assert.deepEqual(app.clicks, []);
    assert.equal(app.window.postTableScrollRunning, false);
  });
}

test('Escape during the startup reset wait prevents every forward scroll', async () => {
  const app = fixture({ target: 'table', initialTop: 2000, sortStopAt: 100 });
  await app.finish();
  assert.equal(app.scrolls.length, 1);
  assert.equal(app.scrolls[0].top, 0);
  assert.equal(app.elapsed, 100);
  assert.equal(app.scroller.scrollLeft, 175);
  assert.equal(app.window.postTableScrollRunning, false);
  assert.equal(app.listeners.size, 0);
});

test('settles an initial ascending sort before one additional click selects descending', async () => {
  const app = fixture({ viewersSort: 'none', sortFirstAscending: true, sortDelay: 300 });
  await app.finish();
  assert.deepEqual(
    app.clicks.map((click) => click.label),
    ['ผู้ชม', 'ผู้ชม'],
  );
  assert.ok(app.clicks[1].at >= 800);
  assert.ok(app.scrolls.length > 0);
  assert.ok(app.scrolls.every((scroll) => scroll.at >= app.clicks[1].at + 800));
  assert.equal(app.window.postTableScrollRunning, false);
});

test('reacquires a table replaced by Viewers sorting and scrolls only the refreshed table', async () => {
  const app = fixture({
    target: 'table',
    viewersSort: 'none',
    sortReplaceTable: true,
    sortDelay: 300,
  });
  await app.finish();
  assert.notEqual(app.table, app.originalTable);
  assert.equal(app.originalTable.isConnected, false);
  assert.ok(app.scrolls.length > 0);
  assert.ok(app.scrolls.every((scroll) => scroll.element === app.table));
  assert.ok(app.scrolls.every((scroll) => scroll.at >= 800));
});

for (const options of [
  { headers: ['Preview', 'Views'] },
  { duplicateViewersHeader: true },
  { viewersSort: 'none', sortButtonDisabled: true },
] satisfies Options[]) {
  test(`does not scroll when Viewers sorting is unavailable or ambiguous: ${JSON.stringify(options)}`, async () => {
    const app = fixture(options);
    await app.finish();
    assert.equal(app.scrolls.length, 0);
    assert.deepEqual(app.clicks, []);
    assert.match(app.messages.join('\n'), /Viewers|ผู้ชม/);
    assert.equal(app.window.postTableScrollRunning, false);
    assert.equal(app.listeners.size, 0);
  });
}

test('stops without scrolling when Viewers sorting never finishes', async () => {
  const app = fixture({ viewersSort: 'none', sortFails: true });
  await app.finish();
  assert.equal(app.clicks.length, 1);
  assert.equal(app.scrolls.length, 0);
  assert.ok(app.elapsed >= 15000 && app.elapsed <= 15100);
  assert.match(app.messages.join('\n'), /sort|Sort/);
  assert.equal(app.window.postTableScrollRunning, false);
  assert.equal(app.listeners.size, 0);
});

test('Escape can cancel while Viewers sorting is still loading', async () => {
  const app = fixture({ viewersSort: 'none', sortDelay: 5000, sortStopAt: 200 });
  await app.finish();
  assert.equal(app.clicks.length, 1);
  assert.equal(app.scrolls.length, 0);
  assert.ok(app.elapsed <= 300);
  assert.equal(app.window.postTableScrollRunning, false);
  assert.equal(app.listeners.size, 0);
  assert.equal(Object.hasOwn(app.window, 'stopPostTableScroll'), false);
});

test('a duplicate paste during Viewers sorting does not click or install another run', async () => {
  const app = fixture({ viewersSort: 'none', sortDelay: 500 });
  await app.runAgain();
  assert.equal(app.clicks.length, 1);
  assert.equal(app.listeners.size, 1);
  await app.finish();
  assert.equal(app.clicks.length, 1);
});

test('a scroll exception releases the running flag and keyboard listener', async () => {
  const app = fixture({ throwOnScroll: true });
  await assert.rejects(app.finish(), /Simulated scroll failure/);
  assert.equal(app.window.postTableScrollRunning, false);
  assert.equal(app.listeners.size, 0);
  assert.equal(Object.hasOwn(app.window, 'stopPostTableScroll'), false);
});
