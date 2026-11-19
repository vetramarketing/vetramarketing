import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import test from 'node:test';
import { runInNewContext } from 'node:vm';

const source = readFileSync(
  new URL('../public/console-scripts/facebook-very-fast-auto-scroll.js', import.meta.url),
  'utf8',
);

/** Runs the real scroll-only snippet on a virtual page, with no external website or actions. */
function scrollFixture(
  options: {
    growAtMs?: number;
    countOnlyGrowth?: boolean;
    loaderUntilMs?: number;
    loaderFlickerAfterMs?: number;
    hiddenLoader?: 'aria' | 'layout' | 'style';
    loaderRole?: 'status' | 'progressbar';
    loaderLabel?: string;
    endlessGrowth?: boolean;
    cannotReachBottom?: boolean;
    reachBottomAtMs?: number;
    stopAtMs?: number;
    alreadyRunning?: boolean;
    fallbackRoot?: boolean;
    throwOnScroll?: boolean;
    commandDescriptor?: PropertyDescriptor;
    replaceItemAtMs?: number;
    rerenderItemAtMs?: number;
    layoutGrowth?: boolean;
    noArticles?: boolean;
    articlesWithoutLinks?: boolean;
    loaderTop?: number;
    loaderBottom?: number;
    storyLinks?: boolean;
    trackingChangeAtMs?: number;
    groupList?: boolean;
    groupHandles?: boolean;
    heightOscillation?: boolean;
    continuousRerender?: boolean;
  } = {},
) {
  let now = 0;
  let grown = false;
  let itemReplaced = false;
  let itemRerendered = false;
  let trackingChanged = false;
  let nextPostId = 2;
  let timerId = 0;
  let finished = false;
  let failure: unknown;
  const timers = new Map<number, { at: number; callback: () => void }>();
  const delays: number[] = [];
  const scrolls: { at: number; top: number; behavior: string }[] = [];
  const messages: string[] = [];
  const keyListeners = new Set<(event: KeyboardEvent) => void>();
  const listenerChanges = { added: 0, removed: 0 };
  const root = { scrollHeight: 1600, scrollTop: 0, clientHeight: 800 };
  const makeArticle = (id: number) => {
    const anchor = {
      href: options.groupList
        ? `https://www.facebook.com/groups/${options.groupHandles ? `group-${id}` : id}/`
        : options.storyLinks
          ? `https://www.facebook.com/story.php?story_fbid=${id}&id=owner`
          : `https://www.facebook.com/groups/demo/posts/${id}/`,
      getAttribute(name: string) {
        return name === 'href' ? this.href : null;
      },
    };
    return {
      anchor,
      textContent: `${options.groupList ? 'Group' : 'Post'} ${id}: unchanged content`,
      getAttribute(name: string) {
        return name === 'role' ? (options.groupList ? 'listitem' : 'article') : null;
      },
      querySelector() {
        return options.articlesWithoutLinks ? null : anchor;
      },
      querySelectorAll() {
        return options.articlesWithoutLinks ? [] : [anchor];
      },
    };
  };
  const articles = options.noArticles ? [] : [makeArticle(1), makeArticle(2)];
  const window = {
    fastAutoScrollRunning: options.alreadyRunning ?? false,
    stopFastAutoScroll: false,
    innerHeight: 800,
    location: { href: 'https://www.facebook.com/groups/joins/' },
    scrollTo({ top, behavior }: { top: number; behavior: string }) {
      scrolls.push({ at: now, top, behavior });
      if (options.throwOnScroll) throw new Error('Simulated scroll error');
      if (options.endlessGrowth || options.layoutGrowth) root.scrollHeight += 800;
      if (options.heightOscillation) root.scrollHeight = scrolls.length % 2 ? 1700 : 1600;
      if (options.continuousRerender && articles.length) articles[0] = makeArticle(1);
      // A virtualized endless feed reuses its visible cards instead of retaining thousands of nodes.
      if (options.endlessGrowth && !options.noArticles) articles[0] = makeArticle(++nextPostId);
      root.scrollTop = Math.max(
        0,
        Math.min(top, root.scrollHeight - window.innerHeight) -
          (options.cannotReachBottom ||
          (options.reachBottomAtMs !== undefined && now < options.reachBottomAtMs)
            ? 100
            : 0),
      );
    },
    getComputedStyle() {
      return {
        display: 'block',
        visibility: options.hiddenLoader === 'style' ? 'hidden' : 'visible',
      };
    },
  };
  const commandWindow = window as typeof window & { stopScroll?: () => void };
  if (options.commandDescriptor)
    Object.defineProperty(window, 'stopScroll', options.commandDescriptor);
  const loader = {
    innerText: options.loaderLabel ?? 'Loading…',
    textContent: options.loaderLabel ?? 'Loading…',
    getAttribute(name: string) {
      if (name === 'role') return options.loaderRole ?? 'progressbar';
      if (name === 'aria-hidden') return options.hiddenLoader === 'aria' ? 'true' : null;
      if (name === 'aria-label') return options.loaderLabel ?? 'Loading…';
      return null;
    },
    getClientRects: () => (options.hiddenLoader === 'layout' ? [] : [{ width: 100, height: 20 }]),
    getBoundingClientRect: () => ({
      top: options.loaderTop ?? 650,
      bottom: options.loaderBottom ?? 700,
    }),
  };
  const document = {
    baseURI: 'https://www.facebook.com/groups/joins/',
    scrollingElement: options.fallbackRoot ? null : root,
    documentElement: root,
    querySelectorAll(selector: string) {
      if (selector === '[role="article"]') return options.groupList ? [] : articles;
      if (selector === '[role="listitem"]') return options.groupList ? articles : [];
      if (selector === '[role="article"], [role="listitem"]') return articles;
      if (selector.includes('[role="progressbar"]') || selector.includes('[role="status"]')) {
        const flickering =
          options.loaderFlickerAfterMs !== undefined &&
          now >= options.loaderFlickerAfterMs &&
          Math.floor((now - options.loaderFlickerAfterMs) / 500) % 2 === 1;
        return now < (options.loaderUntilMs ?? 0) || flickering ? [loader] : [];
      }
      throw new Error('Scroll-only code must not query action controls: ' + selector);
    },
    createElement() {
      throw new Error('Scroll-only code must not insert a panel or other elements.');
    },
    addEventListener(type: string, listener: (event: KeyboardEvent) => void, capture: boolean) {
      assert.equal(type, 'keydown');
      assert.equal(capture, true, 'Escape should work even if a page control handles bubbling');
      keyListeners.add(listener);
      listenerChanges.added += 1;
    },
    removeEventListener(type: string, listener: (event: KeyboardEvent) => void, capture: boolean) {
      assert.equal(type, 'keydown');
      assert.equal(capture, true);
      assert.ok(keyListeners.delete(listener), 'Remove the same listener that was registered');
      listenerChanges.removed += 1;
    },
  };
  class VirtualDate extends Date {
    static now() {
      return now;
    }
  }
  const context = {
    document,
    window,
    Date: VirtualDate,
    URL,
    console: Object.fromEntries(
      ['log', 'warn', 'error'].map((level) => [
        level,
        (...values: unknown[]) => messages.push(values.join(' ')),
      ]),
    ),
    getComputedStyle: window.getComputedStyle,
    setTimeout(callback: () => void, delay: number) {
      delays.push(delay);
      timers.set(++timerId, { at: now + delay, callback });
      return timerId;
    },
    clearTimeout(id: number) {
      timers.delete(id);
    },
    confirm() {
      throw new Error('Scroll-only code must not request a deletion confirmation.');
    },
    fetch() {
      throw new Error('Scroll-only code must not make network requests.');
    },
  };
  const runAgain = () => runInNewContext(source, context) as Promise<void>;
  const execution = runAgain();
  Promise.resolve(execution).then(
    () => {
      finished = true;
    },
    (error: unknown) => {
      failure = error;
      finished = true;
    },
  );

  async function finish() {
    for (let step = 0; step < 10000; step++) {
      for (let microtask = 0; microtask < 8; microtask++) await Promise.resolve();
      if (finished) {
        if (failure) throw failure;
        return;
      }
      const next = [...timers.entries()].sort((a, b) => a[1].at - b[1].at)[0];
      assert.ok(next, 'Auto-scroll is pending without a scheduled timer');
      timers.delete(next[0]);
      now = next[1].at;
      if (!grown && options.growAtMs !== undefined && now >= options.growAtMs) {
        if (!options.noArticles)
          for (let index = 0; index < 3; index++) articles.push(makeArticle(++nextPostId));
        if (!options.countOnlyGrowth) root.scrollHeight += 1200;
        grown = true;
      }
      if (
        !itemReplaced &&
        options.replaceItemAtMs !== undefined &&
        now >= options.replaceItemAtMs
      ) {
        articles[0].anchor.href = makeArticle(++nextPostId).anchor.href;
        itemReplaced = true;
      }
      if (
        !itemRerendered &&
        options.rerenderItemAtMs !== undefined &&
        now >= options.rerenderItemAtMs
      ) {
        articles[0] = makeArticle(1);
        itemRerendered = true;
      }
      if (
        !trackingChanged &&
        options.trackingChangeAtMs !== undefined &&
        now >= options.trackingChangeAtMs
      ) {
        articles[0].anchor.href += '?tracking=changed#fragment';
        trackingChanged = true;
      }
      if (options.stopAtMs !== undefined && now >= options.stopAtMs)
        window.stopFastAutoScroll = true;
      next[1].callback();
    }
    assert.fail('Auto-scroll exceeded its virtual timer budget');
  }
  return {
    finish,
    scrolls,
    delays,
    messages,
    window: commandWindow,
    runAgain,
    listenerChanges,
    get listenerCount() {
      return keyListeners.size;
    },
    pressKey(key: string, isComposing = false) {
      const event = {
        key,
        isComposing,
        preventDefault() {
          assert.fail('The stop shortcut should not cancel the page’s keyboard action');
        },
        stopPropagation() {
          assert.fail('The stop shortcut should not block the page’s keyboard handlers');
        },
      } as unknown as KeyboardEvent;
      for (const listener of [...keyListeners]) listener(event);
    },
    get elapsed() {
      return now;
    },
  };
}

test('scroll-only script advances instantly every 100ms and stops at a stable bottom', async () => {
  const app = scrollFixture();
  await app.finish();
  assert.ok(app.scrolls.length > 1);
  assert.ok(app.scrolls.every((scroll) => scroll.behavior === 'instant'));
  assert.ok(app.delays.every((delay) => delay === 100));
  for (let index = 1; index < app.scrolls.length; index++)
    assert.equal(app.scrolls[index].at - app.scrolls[index - 1].at, 100);
  assert.ok(app.elapsed >= 3000 && app.elapsed <= 3300, String(app.elapsed));
  assert.equal(app.window.fastAutoScrollRunning, false);
  assert.equal(app.listenerCount, 0);
  assert.deepEqual(app.listenerChanges, { added: 1, removed: 1 });
  assert.equal(Object.hasOwn(app.window, 'stopScroll'), false);
});

test('late content restarts the quiet-bottom wait, including count-only feed updates', async () => {
  for (const countOnlyGrowth of [false, true]) {
    const app = scrollFixture({ growAtMs: 2500, countOnlyGrowth });
    await app.finish();
    assert.ok(app.elapsed >= 5500, 'New content must receive a fresh 3-second quiet interval');
    assert.ok(app.elapsed <= 5800, String(app.elapsed));
    assert.equal(app.window.fastAutoScrollRunning, false);
  }
});

test('visible progress and loading text delay completion until loading settles', async () => {
  for (const settings of [
    { loaderRole: 'progressbar' as const },
    { loaderRole: 'status' as const, loaderLabel: 'Loading…' },
    { loaderRole: 'status' as const, loaderLabel: 'Loading more posts…' },
    { loaderRole: 'status' as const, loaderLabel: 'กำลังโหลด...' },
    { loaderRole: 'status' as const, loaderLabel: 'กำลังโหลดโพสต์เพิ่มเติม…' },
  ]) {
    const app = scrollFixture({ ...settings, loaderUntilMs: 5000 });
    await app.finish();
    assert.ok(app.elapsed >= 7900 && app.elapsed <= 8200, String(app.elapsed));
    assert.equal(app.window.fastAutoScrollRunning, false);
  }
});

test('content rendered just after a loader clears receives its own quiet interval', async () => {
  const app = scrollFixture({ loaderUntilMs: 5000, growAtMs: 5200 });
  await app.finish();
  assert.ok(app.elapsed >= 8200 && app.elapsed <= 8500, String(app.elapsed));
  assert.ok(app.messages.some((message) => message.includes('no new items')));
  assert.equal(app.window.fastAutoScrollRunning, false);
});

test('a loader clearing near the inactivity deadline leaves time for delayed group cards to render', async () => {
  const app = scrollFixture({ groupList: true, loaderUntilMs: 9500, growAtMs: 10200 });
  await app.finish();
  assert.ok(app.elapsed >= 13200 && app.elapsed <= 13500, String(app.elapsed));
  assert.ok(app.messages.some((message) => message.includes('no new items')));
  assert.equal(app.window.fastAutoScrollRunning, false);
});

test('a late loader disappearance gets a full three-second quiet interval without new cards', async () => {
  const app = scrollFixture({ loaderUntilMs: 9500 });
  await app.finish();
  assert.ok(app.elapsed >= 12500 && app.elapsed <= 12800, String(app.elapsed));
  assert.equal(app.window.fastAutoScrollRunning, false);
});

test('repeated loader flicker cannot extend its one-time render grace indefinitely', async () => {
  const app = scrollFixture({ loaderUntilMs: 9500, loaderFlickerAfterMs: 9500 });
  await app.finish();
  assert.ok(app.elapsed >= 12500 && app.elapsed <= 13000, String(app.elapsed));
  assert.equal(app.window.fastAutoScrollRunning, false);
  assert.equal(app.listenerCount, 0);
  assert.equal(Object.hasOwn(app.window, 'stopScroll'), false);
});

test('hidden loading indicators do not keep a completed page scrolling', async () => {
  for (const hiddenLoader of ['aria', 'layout', 'style'] as const) {
    const app = scrollFixture({ loaderUntilMs: 600000, hiddenLoader });
    await app.finish();
    assert.ok(app.elapsed >= 3000 && app.elapsed <= 3300, hiddenLoader);
  }
});

test('unrelated loading indicators above or well below the viewport do not keep scrolling active', async () => {
  for (const rectangle of [
    { loaderTop: 50, loaderBottom: 100 },
    { loaderTop: 1100, loaderBottom: 1150 },
  ]) {
    const app = scrollFixture({ ...rectangle, loaderUntilMs: 600000 });
    await app.finish();
    assert.ok(app.elapsed >= 3000 && app.elapsed <= 3300, String(app.elapsed));
    assert.ok(app.messages.some((message) => message.includes('no new items')));
  }
});

test('a bottom loader without new items automatically stops after ten seconds and removes hooks', async () => {
  const app = scrollFixture({ loaderUntilMs: 600000 });
  await app.finish();
  assert.ok(app.elapsed >= 10000 && app.elapsed <= 10300, String(app.elapsed));
  assert.ok(app.messages.some((message) => message.includes('10 seconds')));
  assert.equal(app.window.fastAutoScrollRunning, false);
  assert.equal(app.listenerCount, 0);
  assert.equal(Object.hasOwn(app.window, 'stopScroll'), false);
});

test('new items near the stalled-loader limit restart the timeout', async () => {
  const app = scrollFixture({ loaderUntilMs: 600000, growAtMs: 9500 });
  await app.finish();
  assert.ok(app.elapsed >= 19500 && app.elapsed <= 19700, String(app.elapsed));
  assert.ok(app.messages.some((message) => message.includes('10 seconds')));
});

test('reaching the bottom cannot restart a stalled loader deadline without new content', async () => {
  const app = scrollFixture({ loaderUntilMs: 600000, reachBottomAtMs: 5000 });
  await app.finish();
  assert.ok(app.elapsed >= 10000 && app.elapsed <= 10300, String(app.elapsed));
  assert.ok(app.messages.some((message) => message.includes('10 seconds')));
});

test('new items in reused article nodes restart idle time even when count and height stay the same', async () => {
  for (const storyLinks of [false, true]) {
    const app = scrollFixture({ replaceItemAtMs: 2500, storyLinks });
    await app.finish();
    assert.ok(app.elapsed >= 5500 && app.elapsed <= 5800, String(app.elapsed));
  }
});

test('re-rendering the same permalink or changing tracking parameters does not create a new item', async () => {
  for (const change of [{ rerenderItemAtMs: 2500 }, { trackingChangeAtMs: 2500 }]) {
    const app = scrollFixture(change);
    await app.finish();
    assert.ok(app.elapsed >= 3000 && app.elapsed <= 3300, String(app.elapsed));
  }
});

test('layout-only page height changes do not keep an unchanged identified feed scrolling', async () => {
  const app = scrollFixture({ layoutGrowth: true });
  await app.finish();
  assert.ok(app.elapsed >= 3000 && app.elapsed <= 3300, String(app.elapsed));
  assert.equal(app.window.fastAutoScrollRunning, false);
});

test('articles without links detect new content and pages without articles use height growth', async () => {
  for (const page of [{ articlesWithoutLinks: true }, { noArticles: true }]) {
    const app = scrollFixture({ ...page, growAtMs: 2500 });
    await app.finish();
    assert.ok(app.elapsed >= 5500 && app.elapsed <= 5800, String(app.elapsed));
  }
});

test('joined-group IDs stop unchanged lists despite continuously growing page layout', async () => {
  for (const groupHandles of [false, true]) {
    const app = scrollFixture({ groupList: true, groupHandles, layoutGrowth: true });
    await app.finish();
    assert.ok(app.elapsed >= 3000 && app.elapsed <= 3300, String(app.elapsed));
    assert.equal(app.window.fastAutoScrollRunning, false);
  }
});

test('new joined-group cards restart the quiet interval even without a height increase', async () => {
  const app = scrollFixture({ groupList: true, growAtMs: 2500, countOnlyGrowth: true });
  await app.finish();
  assert.ok(app.elapsed >= 5500 && app.elapsed <= 5800, String(app.elapsed));
});

test('new group IDs in recycled listitem nodes restart the idle deadline', async () => {
  const app = scrollFixture({ groupList: true, groupHandles: true, replaceItemAtMs: 2500 });
  await app.finish();
  assert.ok(app.elapsed >= 5500 && app.elapsed <= 5800, String(app.elapsed));
});

test('group layout growth cannot defeat the inactivity deadline when scrolling never reaches bottom', async () => {
  const app = scrollFixture({ groupList: true, layoutGrowth: true, cannotReachBottom: true });
  await app.finish();
  assert.ok(app.elapsed >= 10000 && app.elapsed <= 10300, String(app.elapsed));
  assert.equal(app.window.fastAutoScrollRunning, false);
  assert.equal(app.listenerCount, 0);
});

test('recreated linkless articles with unchanged text do not look like newly loaded content', async () => {
  const app = scrollFixture({ articlesWithoutLinks: true, continuousRerender: true });
  await app.finish();
  assert.ok(app.elapsed >= 3000 && app.elapsed <= 3300, String(app.elapsed));
  assert.equal(app.window.fastAutoScrollRunning, false);
});

test('generic page height oscillation does not count as endless new content', async () => {
  const app = scrollFixture({ noArticles: true, heightOscillation: true });
  await app.finish();
  assert.ok(app.elapsed >= 3000 && app.elapsed <= 3500, String(app.elapsed));
  assert.equal(app.window.fastAutoScrollRunning, false);
});

test('the stop flag ends the current run before another scroll', async () => {
  const app = scrollFixture({ stopAtMs: 300 });
  await app.finish();
  assert.equal(app.elapsed, 300);
  assert.deepEqual(
    app.scrolls.map((scroll) => scroll.at),
    [0, 100, 200],
  );
  assert.equal(app.window.fastAutoScrollRunning, false);
  assert.equal(app.window.stopFastAutoScroll, true);
});

test('a second paste does not overlap an already-running scroll job', async () => {
  const app = scrollFixture({ alreadyRunning: true });
  await app.finish();
  assert.equal(app.scrolls.length, 0);
  assert.equal(app.delays.length, 0);
  assert.equal(app.window.fastAutoScrollRunning, true, 'The existing run retains its flag');
});

test('an endless feed is bounded to ten minutes and releases the running flag', async () => {
  const app = scrollFixture({ endlessGrowth: true });
  await app.finish();
  assert.ok(app.elapsed >= 600000 && app.elapsed <= 600100, String(app.elapsed));
  assert.ok(app.scrolls.length <= 6001);
  assert.equal(app.window.fastAutoScrollRunning, false);
});

test('an unreachable bottom stops after ten seconds without new items instead of running for ten minutes', async () => {
  const app = scrollFixture({ cannotReachBottom: true });
  await app.finish();
  assert.ok(app.elapsed >= 10000 && app.elapsed <= 10300, String(app.elapsed));
  assert.equal(app.window.fastAutoScrollRunning, false);
  assert.equal(app.listenerCount, 0);
  assert.equal(Object.hasOwn(app.window, 'stopScroll'), false);
});

test('documentElement remains usable when scrollingElement is unavailable', async () => {
  const app = scrollFixture({ fallbackRoot: true });
  await app.finish();
  assert.ok(app.scrolls.length > 1);
  assert.equal(app.window.fastAutoScrollRunning, false);
});

test('a scroll failure still releases the running flag', async () => {
  const app = scrollFixture({ throwOnScroll: true });
  await assert.rejects(app.finish(), /Simulated scroll error/);
  assert.equal(app.scrolls.length, 1);
  assert.equal(app.window.fastAutoScrollRunning, false);
  assert.equal(app.listenerCount, 0);
  assert.equal(Object.hasOwn(app.window, 'stopScroll'), false);
});

test('Escape stops the current scroll run without cancelling the page keyboard event', async () => {
  const app = scrollFixture();
  assert.equal(app.listenerCount, 1);
  app.pressKey('Escape');
  await app.finish();
  assert.equal(app.window.stopFastAutoScroll, true);
  assert.equal(app.window.fastAutoScrollRunning, false);
  assert.equal(app.scrolls.length, 1, 'No further scroll follows Escape');
  assert.equal(app.elapsed, 100);
  assert.equal(app.listenerCount, 0);
  assert.equal(Object.hasOwn(app.window, 'stopScroll'), false);
});

test('the short stopScroll command stops before another scroll and removes its hook', async () => {
  const app = scrollFixture();
  assert.equal(typeof app.window.stopScroll, 'function');
  app.window.stopScroll!();
  await app.finish();
  assert.equal(app.window.stopFastAutoScroll, true);
  assert.equal(app.window.fastAutoScrollRunning, false);
  assert.equal(app.scrolls.length, 1);
  assert.equal(app.listenerCount, 0);
  assert.equal(Object.hasOwn(app.window, 'stopScroll'), false);
});

test('other keys and Escape during input composition do not stop scrolling', async () => {
  const app = scrollFixture();
  app.pressKey('s');
  app.pressKey('Enter');
  app.pressKey('Escape', true);
  assert.equal(app.window.stopFastAutoScroll, false);
  await app.finish();
  assert.ok(app.scrolls.length > 1);
  assert.ok(app.elapsed >= 3000);
  assert.equal(app.window.stopFastAutoScroll, false);
  assert.equal(app.listenerCount, 0);
});

test('a duplicate paste leaves the original command and single keyboard listener in place', async () => {
  const app = scrollFixture();
  const command = app.window.stopScroll;
  await app.runAgain();
  assert.equal(app.window.stopScroll, command);
  assert.equal(app.listenerCount, 1);
  assert.deepEqual(app.listenerChanges, { added: 1, removed: 0 });
  app.pressKey('Escape');
  await app.finish();
  assert.deepEqual(app.listenerChanges, { added: 1, removed: 1 });
});

test('normal completion restores an existing host stopScroll command and its descriptor', async () => {
  let hostCalls = 0;
  const hostCommand = () => {
    hostCalls += 1;
  };
  const commandDescriptor = {
    value: hostCommand,
    writable: false,
    configurable: true,
    enumerable: true,
  };
  const app = scrollFixture({ commandDescriptor });
  assert.notEqual(app.window.stopScroll, hostCommand);
  await app.finish();
  assert.deepEqual(Object.getOwnPropertyDescriptor(app.window, 'stopScroll'), commandDescriptor);
  assert.equal(hostCalls, 0);
  assert.equal(app.listenerCount, 0);
});

test('manual stopping also restores a host accessor without reading it', async () => {
  let hostReads = 0;
  const hostGetter = () => {
    hostReads += 1;
    return () => undefined;
  };
  const commandDescriptor = {
    get: hostGetter,
    set: undefined,
    configurable: true,
    enumerable: false,
  };
  const app = scrollFixture({ commandDescriptor });
  app.window.stopScroll!();
  await app.finish();
  assert.deepEqual(Object.getOwnPropertyDescriptor(app.window, 'stopScroll'), commandDescriptor);
  assert.equal(hostReads, 0);
  assert.equal(app.listenerCount, 0);
});

test('a replacement installed by the page during scrolling survives cleanup', async () => {
  const app = scrollFixture();
  const replacement = () => undefined;
  app.window.stopScroll = replacement;
  app.pressKey('Escape');
  await app.finish();
  assert.equal(app.window.stopScroll, replacement);
  assert.equal(app.listenerCount, 0);
});

test('a non-configurable host command stays intact while Escape and the old stop flag work', async () => {
  const hostCommand = () => undefined;
  const commandDescriptor = {
    value: hostCommand,
    writable: false,
    configurable: false,
    enumerable: true,
  };
  for (const stop of ['Escape', 'flag']) {
    const app = scrollFixture({ commandDescriptor });
    assert.equal(app.window.stopScroll, hostCommand);
    if (stop === 'Escape') app.pressKey('Escape');
    else app.window.stopFastAutoScroll = true;
    await app.finish();
    assert.equal(app.scrolls.length, 1);
    assert.deepEqual(Object.getOwnPropertyDescriptor(app.window, 'stopScroll'), commandDescriptor);
    assert.equal(app.listenerCount, 0);
    assert.equal(app.window.fastAutoScrollRunning, false);
  }
});
