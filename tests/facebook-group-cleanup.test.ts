import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import test from 'node:test';
import { runInNewContext } from 'node:vm';

const source = readFileSync(
  new URL('../public/console-scripts/facebook-remove-vetra-group-posts.js', import.meta.url),
  'utf8',
);

type Options = {
  hostname?: string;
  initialPosts?: number;
  addedPosts?: number;
  loadAtMs?: number;
  growHeightOnLoad?: boolean;
  loaderUntilMs?: number;
  loaderRole?: 'status' | 'progressbar';
  loaderLabel?: string;
  hiddenLoader?: boolean;
  layoutGrowth?: boolean;
  endlessPosts?: boolean;
  cannotReachBottom?: boolean;
  stopAtMs?: number;
  useDocumentElement?: boolean;
  accept?: boolean;
  duplicateId?: boolean;
  targetReadyAtMs?: number;
  menuDelayMs?: number;
  missingMenuItem?: boolean;
  disabledMenuItem?: boolean;
  dialog?: boolean;
  dialogDelayMs?: number;
  dialogCloseDelayMs?: number;
  missingConfirm?: boolean;
  disabledConfirm?: boolean;
  confirmReadyDelayMs?: number;
  detachOnRequest?: boolean;
  rerenderOnRequest?: boolean;
};

/** Exercises the real console script against a simulated feed; no Facebook connection. */
function fixture(options: Options = {}) {
  let now = 0;
  let timerId = 0;
  let done = false;
  let failure: unknown;
  let added = false;
  let nextId = options.initialPosts ?? 3;
  let menu: { article: Article; openedAt: number } | null = null;
  let dialog: { article: Article; openedAt: number; confirmedAt?: number } | null = null;
  const timers = new Map<number, { at: number; callback: () => void }>();
  const scrolls: { at: number; behavior: string }[] = [];
  const confirmations: { at: number; message: string }[] = [];
  const clicks: { at: number; action: string; id: number }[] = [];
  const requests: { at: number; id: number; connected: number }[] = [];
  const sleeps: { at: number; duration: number }[] = [];
  const messages: { level: string; message: string }[] = [];
  const root = { scrollHeight: 1600, scrollTop: 0, clientHeight: 800 };
  const randomValues = [0, 0.5, 0.999999];
  let randomIndex = 0;

  function control(
    text: string,
    click: () => void,
    attrs: Record<string, string | null> = {},
    available = () => true,
  ) {
    return {
      innerText: text,
      textContent: text,
      get isConnected() {
        return available();
      },
      get disabled() {
        return attrs['disabled'] === 'true';
      },
      getAttribute(name: string) {
        return attrs[name] ?? null;
      },
      hasAttribute(name: string) {
        return attrs[name] !== null && attrs[name] !== undefined;
      },
      getClientRects: () => (available() ? [{ width: 100, height: 30 }] : []),
      getBoundingClientRect: () => ({ top: 740, bottom: 770, width: 100, height: 30 }),
      click,
    };
  }

  function request(article: Article) {
    requests.push({
      at: now,
      id: article.id,
      connected: articles.filter((item) => item.isConnected).length,
    });
    if (options.detachOnRequest) {
      article.isConnected = false;
      articles = articles.filter((item) => item !== article);
    }
    if (options.rerenderOnRequest) articles = articles.map((item) => new Article(item.id));
  }

  class Article {
    isConnected = true;
    href: string;
    innerText: string;
    textContent: string;
    constructor(readonly id: number) {
      this.href = `https://www.facebook.com/groups/demo/posts/${id}/?tracking=source`;
      this.innerText = this.textContent = `VETRA ออกแบบ สร้าง เว็บไซต์ Post ${id}`;
    }
    getAttribute() {
      return null;
    }
    getClientRects() {
      return this.isConnected ? [{ width: 500, height: 400 }] : [];
    }
    querySelector(selector: string) {
      if (selector.includes('a[href')) return { href: this.href };
      if (now < (options.targetReadyAtMs ?? 0)) return null;
      return control(
        'Actions for VETRA ออกแบบ สร้าง เว็บไซต์',
        () => {
          clicks.push({ at: now, action: 'menu', id: this.id });
          assert.ok(!isDialogVisible(), 'The next post menu must not open over an existing dialog');
          menu = { article: this, openedAt: now };
        },
        { 'aria-haspopup': 'menu' },
      );
    }
    querySelectorAll(selector: string) {
      const found = this.querySelector(selector);
      return found ? [found] : [];
    }
    scrollIntoView(settings: { behavior: string; block: string }) {
      assert.deepEqual({ ...settings }, { behavior: 'instant', block: 'center' });
    }
  }
  let articles = Array.from({ length: options.initialPosts ?? 3 }, (_, i) => new Article(i + 1));
  if (options.duplicateId && articles.length) articles.push(new Article(articles[0].id));

  const window = {
    stopGroupPostDeletion: false,
    innerHeight: 800,
    scrollTo({ top, behavior }: { top: number; behavior: string }) {
      scrolls.push({ at: now, behavior });
      if (options.layoutGrowth || options.endlessPosts) root.scrollHeight += 800;
      if (options.endlessPosts) articles = [new Article(++nextId)];
      root.scrollTop = Math.max(
        0,
        Math.min(top, root.scrollHeight - window.innerHeight) -
          (options.cannotReachBottom ? 100 : 0),
      );
    },
  };
  const loader = control(options.loaderLabel ?? 'Loading…', () => {}, {
    role: options.loaderRole ?? 'progressbar',
    'aria-hidden': options.hiddenLoader ? 'true' : null,
  });
  function isDialogVisible() {
    return Boolean(
      dialog &&
      now >= dialog.openedAt + (options.dialogDelayMs ?? 0) &&
      (dialog.confirmedAt === undefined ||
        now < dialog.confirmedAt + (options.dialogCloseDelayMs ?? 0)),
    );
  }
  const confirmationDialog = {
    ...control('Delete post?', () => {}, { role: 'dialog' }, isDialogVisible),
    get isConnected() {
      return isDialogVisible();
    },
    querySelectorAll() {
      if (!dialog || options.missingConfirm) return [];
      if (now < dialog.openedAt + (options.confirmReadyDelayMs ?? 0)) return [];
      return [
        control(
          'Delete post',
          () => {
            assert.ok(dialog);
            assert.equal(
              options.disabledConfirm,
              undefined,
              'Disabled confirmation must not be clicked',
            );
            clicks.push({ at: now, action: 'confirm', id: dialog.article.id });
            dialog.confirmedAt = now;
            request(dialog.article);
          },
          {
            'aria-disabled': options.disabledConfirm ? 'true' : null,
            disabled: options.disabledConfirm ? 'true' : null,
          },
          isDialogVisible,
        ),
      ];
    },
    querySelector() {
      return this.querySelectorAll()[0] ?? null;
    },
  };
  function menuItems() {
    if (!menu || options.missingMenuItem || now < menu.openedAt + (options.menuDelayMs ?? 0))
      return [];
    const current = menu;
    return [
      control(
        'Delete post',
        () => {
          assert.equal(
            options.disabledMenuItem,
            undefined,
            'Disabled menu option must not be clicked',
          );
          clicks.push({ at: now, action: 'delete', id: current.article.id });
          menu = null;
          if (options.dialog ?? true) dialog = { article: current.article, openedAt: now };
          else request(current.article);
        },
        { role: 'menuitem', 'aria-disabled': options.disabledMenuItem ? 'true' : null },
        () => menu === current,
      ),
    ];
  }
  const document = {
    scrollingElement: options.useDocumentElement ? null : root,
    documentElement: root,
    querySelectorAll(selector: string) {
      if (selector === '[role="article"]') return articles;
      if (selector.includes('[role="progressbar"]'))
        return now < (options.loaderUntilMs ?? 0) ? [loader] : [];
      if (selector.includes('[role="menuitem"]')) return menuItems();
      if (selector.includes('[role="dialog"]') || selector.includes('[role="alertdialog"]'))
        return isDialogVisible() ? [confirmationDialog] : [];
      if (selector.includes('[role="menu"]')) return menu ? [control('', () => {})] : [];
      return [];
    },
    querySelector(selector: string) {
      return this.querySelectorAll(selector)[0] ?? null;
    },
    createElement() {
      throw new Error('This snippet must not install another panel.');
    },
  };
  class VirtualDate extends Date {
    static now() {
      return now;
    }
  }
  const math = Object.create(Math) as Math;
  math.random = () => randomValues[randomIndex++ % randomValues.length];
  const execution = runInNewContext(source, {
    document,
    window,
    location: { hostname: options.hostname ?? 'www.facebook.com' },
    Date: VirtualDate,
    Math: math,
    getComputedStyle: () => ({ display: 'block', visibility: 'visible', opacity: '1' }),
    console: Object.fromEntries(
      ['log', 'warn', 'error', 'table'].map((level) => [
        level,
        (...values: unknown[]) => messages.push({ level, message: values.join(' ') }),
      ]),
    ),
    confirm(message: string) {
      confirmations.push({ at: now, message });
      return options.accept ?? false;
    },
    setTimeout(callback: () => void, duration: number) {
      sleeps.push({ at: now, duration });
      timers.set(++timerId, { at: now + duration, callback });
      return timerId;
    },
  }) as Promise<void>;
  execution.then(
    () => {
      done = true;
    },
    (error: unknown) => {
      failure = error;
      done = true;
    },
  );
  async function finish() {
    for (let step = 0; step < 15000; step++) {
      for (let microtask = 0; microtask < 16; microtask++) await Promise.resolve();
      if (done) {
        if (failure) throw failure;
        return;
      }
      const next = [...timers.entries()].sort((a, b) => a[1].at - b[1].at)[0];
      assert.ok(next, 'Snippet is pending without a scheduled timer');
      timers.delete(next[0]);
      now = next[1].at;
      if (!added && options.loadAtMs !== undefined && now >= options.loadAtMs) {
        for (let index = 0; index < (options.addedPosts ?? 2); index++)
          articles.push(new Article(++nextId));
        if (options.growHeightOnLoad !== false) root.scrollHeight += 1200;
        added = true;
      }
      if (options.stopAtMs !== undefined && now >= options.stopAtMs)
        window.stopGroupPostDeletion = true;
      next[1].callback();
    }
    assert.fail('Snippet exceeded its test timer budget');
  }
  return {
    finish,
    scrolls,
    confirmations,
    clicks,
    requests,
    sleeps,
    messages,
    get elapsed() {
      return now;
    },
  };
}

test('100ms instant scrolling waits for three quiet seconds before confirmation; cancel does not click', async () => {
  const app = fixture();
  await app.finish();
  assert.ok(app.scrolls.length >= 30 && app.scrolls.length <= 33);
  assert.ok(app.sleeps.every((sleep) => sleep.duration === 100));
  assert.ok(app.scrolls.every((scroll) => scroll.behavior === 'instant'));
  assert.ok(app.confirmations[0].at >= 3000 && app.confirmations[0].at <= 3300);
  assert.match(app.confirmations[0].message, /3/);
  assert.deepEqual(app.clicks, []);
});

test('new post identities reset the quiet period even without a feed-height change', async () => {
  for (const growHeightOnLoad of [false, true]) {
    const app = fixture({ loadAtMs: 2500, addedPosts: 2, growHeightOnLoad });
    await app.finish();
    assert.equal(app.confirmations.length, 1);
    assert.ok(app.confirmations[0].at >= 5500 && app.confirmations[0].at <= 5800);
    assert.match(app.confirmations[0].message, /5/);
    assert.deepEqual(app.clicks, []);
  }
});

test('visible English and Thai loading indicators defer completion', async () => {
  for (const loader of [
    { loaderRole: 'progressbar' as const, loaderLabel: '' },
    { loaderRole: 'status' as const, loaderLabel: 'Loading…' },
    { loaderRole: 'status' as const, loaderLabel: 'กำลังโหลด...' },
  ]) {
    const app = fixture({ ...loader, loaderUntilMs: 5000 });
    await app.finish();
    assert.equal(app.confirmations.length, 1);
    assert.ok(app.confirmations[0].at >= 7900 && app.confirmations[0].at <= 8300);
  }
});

test('hidden loaders and unchanged posts with layout growth do not prevent quiet completion', async () => {
  for (const options of [
    { hiddenLoader: true, loaderUntilMs: 200000 },
    { layoutGrowth: true },
    { useDocumentElement: true },
  ]) {
    const app = fixture(options);
    await app.finish();
    assert.equal(app.confirmations.length, 1);
    assert.ok(app.elapsed >= 3000 && app.elapsed <= 3300);
  }
});

test('stalled loading or an unreachable bottom aborts before confirmation or clicks', async () => {
  for (const options of [{ loaderUntilMs: 200000 }, { cannotReachBottom: true }]) {
    const app = fixture({ ...options, accept: true });
    await app.finish();
    assert.ok(app.elapsed >= 10000 && app.elapsed <= 10300);
    assert.deepEqual(app.confirmations, []);
    assert.deepEqual(app.clicks, []);
    assert.ok(app.messages.some((item) => /stall/i.test(item.message)));
  }
});

test('continuous new posts reach the scroll cap without asking to delete a partial list', async () => {
  const app = fixture({ endlessPosts: true, accept: true });
  await app.finish();
  assert.equal(app.elapsed, 600000);
  assert.deepEqual(app.confirmations, []);
  assert.deepEqual(app.clicks, []);
});

test('stop flag halts fast scrolling before confirmation', async () => {
  const app = fixture({ stopAtMs: 300, accept: true });
  await app.finish();
  assert.equal(app.scrolls.length, 3);
  assert.deepEqual(app.confirmations, []);
  assert.deepEqual(app.clicks, []);
});

test('wrong hosts and empty feeds cannot reach a deletion action', async () => {
  for (const hostname of ['example.com', 'notfacebook.com', 'facebook.com.example.com']) {
    const app = fixture({ hostname, accept: true });
    await app.finish();
    assert.deepEqual(app.scrolls, []);
    assert.deepEqual(app.clicks, []);
  }
  const empty = fixture({ initialPosts: 0, accept: true });
  await empty.finish();
  assert.deepEqual(empty.confirmations, []);
  assert.deepEqual(empty.clicks, []);
});

test('requests continue at randomized 200–800ms intervals while all posts remain connected', async () => {
  const app = fixture({ accept: true, initialPosts: 4 });
  await app.finish();
  assert.equal(app.requests.length, 4);
  assert.equal(new Set(app.requests.map((item) => item.id)).size, 4);
  assert.ok(app.requests.every((item) => item.connected === 4));
  const gaps = app.requests.slice(1).map((item, i) => item.at - app.requests[i].at);
  assert.ok(
    gaps.every((gap) => gap >= 200 && gap <= 800),
    JSON.stringify(gaps),
  );
  assert.equal(new Set(gaps).size, 3, 'Math.random must affect each request interval');
  assert.ok(!app.messages.some((item) => /Verified removed: [1-9]|✅ Deleted/.test(item.message)));
  assert.ok(app.messages.some((item) => /request/i.test(item.message) && /4/.test(item.message)));
});

test('processed permalink IDs are skipped even when cards stay connected or are recreated', async () => {
  for (const rerenderOnRequest of [false, true]) {
    const app = fixture({ accept: true, duplicateId: true, rerenderOnRequest });
    await app.finish();
    assert.equal(app.requests.length, 3);
    assert.equal(new Set(app.requests.map((item) => item.id)).size, 3);
  }
});

test('immediate disappearance does not add a verification delay between requests', async () => {
  const app = fixture({ accept: true, detachOnRequest: true });
  await app.finish();
  assert.equal(app.requests.length, 3);
  assert.ok(app.requests[1].at - app.requests[0].at <= 800);
});

test('delayed menus and confirmation dialogs are polled before their controls are clicked', async () => {
  const app = fixture({ accept: true, initialPosts: 2, menuDelayMs: 400, dialogDelayMs: 400 });
  await app.finish();
  assert.equal(app.requests.length, 2);
  for (const request of app.requests) {
    const menu = app.clicks.find((item) => item.id === request.id && item.action === 'menu');
    const remove = app.clicks.find((item) => item.id === request.id && item.action === 'delete');
    assert.ok(menu && remove);
    assert.ok(remove.at - menu.at >= 400);
    assert.ok(request.at - remove.at >= 400);
  }
});

test('the next menu waits for the prior confirmation dialog to close', async () => {
  const app = fixture({ accept: true, dialogCloseDelayMs: 600 });
  await app.finish();
  assert.equal(app.requests.length, 3);
  const secondMenu = app.clicks.find(
    (item) => item.action === 'menu' && item.id === app.requests[1].id,
  );
  assert.ok(secondMenu);
  assert.ok(secondMenu.at - app.requests[0].at >= 600);
});

test('missing or disabled delete/confirmation controls stop without touching another post', async () => {
  for (const options of [
    { missingMenuItem: true },
    { disabledMenuItem: true },
    { missingConfirm: true },
    { disabledConfirm: true },
  ]) {
    const app = fixture({ ...options, accept: true });
    await app.finish();
    assert.deepEqual(app.requests, []);
    assert.equal(app.clicks.filter((item) => item.action === 'menu').length, 1);
    assert.ok(
      app.messages.some((item) => /stopp|not found|unavailable|disabled/i.test(item.message)),
    );
  }
});

test('stop during target, menu, dialog, or confirmation polling prevents the next click', async () => {
  for (const options of [
    { targetReadyAtMs: 6000, expectedActions: [] },
    { menuDelayMs: 2000, expectedActions: ['menu'] },
    { dialogDelayMs: 2000, expectedActions: ['menu', 'delete'] },
    { confirmReadyDelayMs: 1500, expectedActions: ['menu', 'delete'] },
  ]) {
    const app = fixture({ ...options, accept: true, stopAtMs: 3400 });
    await app.finish();
    assert.deepEqual(
      app.clicks.map((item) => item.action),
      options.expectedActions,
    );
    assert.deepEqual(app.requests, []);
  }
});

test('stop during the random request delay prevents opening another post', async () => {
  const app = fixture({ accept: true, stopAtMs: 3200 });
  await app.finish();
  assert.equal(app.requests.length, 1);
  assert.equal(app.clicks.filter((item) => item.action === 'menu').length, 1);
});

test('stop while waiting for the prior confirmation dialog to close prevents the next post', async () => {
  const app = fixture({ accept: true, dialogCloseDelayMs: 2000, stopAtMs: 3400 });
  await app.finish();
  assert.equal(app.requests.length, 1);
  assert.equal(app.clicks.filter((item) => item.action === 'menu').length, 1);
});

test('a late dialog cannot be mistaken for a completed request and applied to the next post', async () => {
  const app = fixture({ accept: true, dialogDelayMs: 2200 });
  await app.finish();
  assert.deepEqual(app.requests, []);
  assert.deepEqual(
    app.clicks.map((item) => item.action),
    ['menu', 'delete'],
  );
  assert.ok(app.messages.some((item) => /submitted: 0\/3/.test(item.message)));
});

test('an absent confirmation with a connected post stops before moving to another post', async () => {
  const app = fixture({ accept: true, dialog: false });
  await app.finish();
  assert.equal(
    app.requests.length,
    1,
    'The menu action may submit directly, but that is uncertain',
  );
  assert.equal(app.clicks.filter((item) => item.action === 'menu').length, 1);
  assert.ok(app.messages.some((item) => /submitted: 0\/3/.test(item.message)));
});

test('a direct removal without a dialog may proceed once the original card is already gone', async () => {
  const app = fixture({ accept: true, dialog: false, detachOnRequest: true });
  await app.finish();
  assert.equal(app.requests.length, 3);
  assert.equal(new Set(app.requests.map((item) => item.id)).size, 3);
  assert.equal(app.clicks.filter((item) => item.action === 'confirm').length, 0);
  assert.ok(app.messages.some((item) => /submitted: 3\/3/.test(item.message)));
  assert.ok(!app.messages.some((item) => /Verified removed|✅ Deleted/.test(item.message)));
});

test('a confirmation button that renders later is awaited and clicked once', async () => {
  const app = fixture({ accept: true, initialPosts: 1, confirmReadyDelayMs: 1000 });
  await app.finish();
  assert.equal(app.requests.length, 1);
  const remove = app.clicks.find((item) => item.action === 'delete');
  assert.ok(remove);
  assert.equal(app.requests[0].at - remove.at, 1000);
  assert.equal(app.clicks.filter((item) => item.action === 'confirm').length, 1);
});

test('an uncleared confirmation dialog reaches a bounded timeout without a second request', async () => {
  const app = fixture({ accept: true, dialogCloseDelayMs: 20000 });
  await app.finish();
  assert.equal(app.requests.length, 1);
  assert.equal(app.clicks.filter((item) => item.action === 'menu').length, 1);
  assert.ok(app.elapsed - app.requests[0].at >= 5000);
  assert.ok(app.elapsed - app.requests[0].at <= 5300);
  assert.ok(app.messages.some((item) => /still open/.test(item.message)));
});

test('late loader clearance permits newly rendered cards to finish loading before confirmation', async () => {
  const app = fixture({ loaderUntilMs: 9500, loadAtMs: 10200 });
  await app.finish();
  assert.equal(app.confirmations.length, 1);
  assert.ok(app.confirmations[0].at >= 13200 && app.confirmations[0].at <= 13500);
  assert.match(app.confirmations[0].message, /5/);
});
