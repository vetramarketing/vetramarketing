import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import test from 'node:test';
import { runInNewContext } from 'node:vm';

const source = readFileSync(
  new URL('../public/console-scripts/facebook-remove-my-pending-group-posts.js', import.meta.url),
  'utf8',
).replace(/\r\n/g, '\n');
const original = readFileSync(
  new URL('./fixtures/facebook-pending-posts-user-original.js', import.meta.url),
  'utf8',
).replace(/\r\n/g, '\n');

const ARTICLE = '[role="article"]';
const LINK = 'a[href*="/pending_posts/"]';
const DELETE =
  '[role="button"][aria-label="ลบ"]:not([aria-disabled="true"]):not([aria-hidden="true"])';

/** The actual snippet runs against local objects and a virtual clock, never Facebook. */
function fixture(
  options: {
    hostname?: string;
    pendingPage?: boolean;
    initialPosts?: number;
    loadAt?: number;
    addedPosts?: number;
    loaderUntil?: number;
    hiddenLoader?: boolean;
    loaderRole?: 'status' | 'progressbar';
    loaderLabel?: string;
    loaderTop?: number;
    stopAt?: number;
    accept?: boolean;
    dialog?: boolean;
    missingConfirm?: boolean;
    missingDelete?: boolean;
    buttonReadyAt?: number;
    verifyFailure?: boolean;
    replaceUrlOnRemoval?: boolean;
    layoutGrowth?: boolean;
    unreachableBottom?: boolean;
    endlessPosts?: boolean;
    rerender?: boolean;
    noLinks?: boolean;
    fallbackRoot?: boolean;
  } = {},
) {
  let now = 0;
  let nextId = options.initialPosts ?? 2;
  let loaded = false;
  let finished = false;
  let failure: unknown;
  let timerId = 0;
  let activeDialog: Article | null = null;
  const timers = new Map<number, { at: number; callback: () => void }>();
  const delays: number[] = [];
  const scrolls: { at: number; behavior: string }[] = [];
  const confirmations: { at: number; message: string }[] = [];
  const clicks: { at: number; id: number; kind: 'delete' | 'confirm' }[] = [];
  const messages: string[] = [];
  const postScrolls: number[] = [];
  const root = { scrollHeight: 1600, scrollTop: 0, clientHeight: 800 };

  class Article {
    isConnected = true;
    href: string;
    textContent: string;
    constructor(readonly id: number) {
      this.href = `https://www.facebook.com/groups/demo/pending_posts/${id}/?tracking=source`;
      this.textContent = `Pending post ${id}`;
    }
    querySelector(selector: string) {
      if (selector === LINK) return options.noLinks ? null : { href: this.href };
      assert.equal(selector, DELETE, 'Retain the supplied Thai delete-button selector');
      if (options.missingDelete || now < (options.buttonReadyAt ?? 0)) return null;
      return {
        click: () => {
          clicks.push({ at: now, id: this.id, kind: 'delete' });
          if (options.dialog) activeDialog = this;
          else remove(this);
        },
      };
    }
    querySelectorAll(selector: string) {
      assert.equal(selector, LINK);
      return options.noLinks ? [] : [{ href: this.href }];
    }
    scrollIntoView(settings: { behavior: string; block: string }) {
      assert.deepEqual({ ...settings }, { behavior: 'instant', block: 'center' });
      postScrolls.push(now);
    }
  }
  let articles = Array.from({ length: nextId }, (_, i) => new Article(i + 1));
  function remove(article: Article) {
    if (options.verifyFailure) return;
    if (options.replaceUrlOnRemoval)
      article.href = article.href.replace(
        `/pending_posts/${article.id}/`,
        '/pending_posts/replacement/',
      );
    else article.isConnected = false;
    articles = articles.filter((item) => item !== article);
  }
  const window = {
    stopPendingDeletion: false,
    innerHeight: 800,
    scrollTo({ top, behavior }: { top: number; behavior: string }) {
      scrolls.push({ at: now, behavior });
      if (options.layoutGrowth || options.endlessPosts) root.scrollHeight += 800;
      if (options.endlessPosts) articles = [new Article(++nextId)];
      else if (options.rerender) articles = articles.map((item) => new Article(item.id));
      root.scrollTop = Math.max(
        0,
        Math.min(top, root.scrollHeight - window.innerHeight) -
          (options.unreachableBottom ? 100 : 0),
      );
    },
  };
  const loader = {
    innerText: options.loaderLabel ?? 'Loading…',
    getClientRects: () => (options.hiddenLoader ? [] : [{ width: 100, height: 20 }]),
    getBoundingClientRect: () => ({
      top: options.loaderTop ?? 650,
      bottom: (options.loaderTop ?? 650) + 20,
    }),
    getAttribute: (name: string) =>
      name === 'role' ? (options.loaderRole ?? 'progressbar') : null,
  };
  const dialog = {
    innerText: 'Delete post?',
    getClientRects: () => [{ width: 100, height: 20 }],
    querySelectorAll(selector: string) {
      assert.equal(selector, 'button, [role="button"]');
      return options.missingConfirm
        ? []
        : [
            {
              innerText: 'Delete post',
              getAttribute: () => null,
              click() {
                assert.ok(activeDialog);
                clicks.push({ at: now, id: activeDialog.id, kind: 'confirm' });
                remove(activeDialog);
                activeDialog = null;
              },
            },
          ];
    },
  };
  const document = {
    body: {
      innerText: options.pendingPage === false ? 'Other Facebook page' : 'โพสต์ของคุณ รอดำเนินการ',
    },
    scrollingElement: options.fallbackRoot ? null : root,
    documentElement: root,
    querySelectorAll(selector: string) {
      if (selector === ARTICLE) return articles;
      if (selector === '[role="status"], [role="progressbar"]')
        return now < (options.loaderUntil ?? 0) ? [loader] : [];
      assert.equal(selector, '[role="dialog"], [role="alertdialog"]');
      return activeDialog ? [dialog] : [];
    },
    querySelector(selector: string) {
      assert.equal(selector, ARTICLE);
      return articles[0] ?? null;
    },
    createElement() {
      assert.fail('The supplied snippet must not install a new panel');
    },
  };
  class VirtualDate extends Date {
    static now() {
      return now;
    }
  }
  const execution = runInNewContext(source, {
    document,
    window,
    Date: VirtualDate,
    location: { hostname: options.hostname ?? 'www.facebook.com' },
    getComputedStyle: () => ({ visibility: 'visible' }),
    console: Object.fromEntries(
      ['log', 'warn', 'error'].map((key) => [
        key,
        (...args: unknown[]) => messages.push(args.join(' ')),
      ]),
    ),
    confirm(message: string) {
      confirmations.push({ at: now, message });
      return options.accept ?? false;
    },
    setTimeout(callback: () => void, delay: number) {
      delays.push(delay);
      timers.set(++timerId, { at: now + delay, callback });
      return timerId;
    },
    fetch() {
      assert.fail('The snippet must not perform network requests');
    },
  }) as Promise<void>;
  execution.then(
    () => {
      finished = true;
    },
    (error: unknown) => {
      failure = error;
      finished = true;
    },
  );
  async function finish() {
    for (let step = 0; step < 12000; step++) {
      for (let microtask = 0; microtask < 8; microtask++) await Promise.resolve();
      if (finished) {
        if (failure) throw failure;
        return;
      }
      const next = [...timers.entries()].sort((a, b) => a[1].at - b[1].at)[0];
      assert.ok(next, 'Pending execution must have a timer');
      timers.delete(next[0]);
      now = next[1].at;
      if (!loaded && options.loadAt !== undefined && now >= options.loadAt) {
        for (let i = 0; i < (options.addedPosts ?? 3); i++) articles.push(new Article(++nextId));
        root.scrollHeight += 1200;
        loaded = true;
      }
      if (options.stopAt !== undefined && now >= options.stopAt) window.stopPendingDeletion = true;
      next[1].callback();
    }
    assert.fail('Snippet exceeded virtual timer budget');
  }
  return {
    finish,
    delays,
    scrolls,
    confirmations,
    clicks,
    messages,
    postScrolls,
    get elapsed() {
      return now;
    },
    get remaining() {
      return articles.length;
    },
  };
}

test('the supplied deletion flow is unchanged apart from the marked scroll block, loaded count and stop checks', () => {
  const block =
    /^  \/\/ Very-fast-scroll addition: finish loading before the original deletion flow\.\n[\s\S]*?^  \/\/ End very-fast-scroll addition\.\n\n/gm;
  const guard =
    /^ +if \(window\.stopPendingDeletion\) return console\.warn\("Deletion stopped\."\);\n/gm;
  assert.equal([...source.matchAll(block)].length, 1);
  assert.equal([...source.matchAll(guard)].length, 4);
  assert.equal(
    source.replace(block, '').replace(guard, '').replace('loaded pending posts?', 'pending posts?'),
    original,
  );
});

test('100ms instant scrolling finishes before counting and confirmation; cancelling never clicks delete', async () => {
  const app = fixture();
  await app.finish();
  assert.equal(app.confirmations.length, 1);
  assert.match(app.confirmations[0].message, /Delete all 2 loaded pending posts/);
  assert.ok(app.elapsed >= 3000 && app.elapsed <= 3300);
  assert.ok(app.delays.every((delay) => delay === 100));
  assert.ok(app.scrolls.every((scroll) => scroll.behavior === 'instant'));
  assert.equal(app.clicks.length, 0);
  assert.equal(app.postScrolls.length, 0);
});

test('posts loaded while scrolling are included in the original confirmation count', async () => {
  const app = fixture({ loadAt: 2500 });
  await app.finish();
  assert.match(app.confirmations[0].message, /Delete all 5 loaded pending posts/);
  assert.ok(app.elapsed >= 5500 && app.elapsed <= 5800);
});

test('loader clearance gets a quiet interval, including cards arriving after the usual stall deadline', async () => {
  for (const options of [
    { loaderUntil: 5000, loadAt: 5200, minimum: 8200 },
    { loaderUntil: 9500, loadAt: 10200, minimum: 13200 },
  ]) {
    const app = fixture(options);
    await app.finish();
    assert.equal(app.confirmations.length, 1);
    assert.ok(
      app.elapsed >= options.minimum && app.elapsed <= options.minimum + 300,
      String(app.elapsed),
    );
    assert.equal(app.clicks.length, 0);
  }
});

test('English and Thai visible loading statuses postpone confirmation', async () => {
  for (const loaderLabel of ['Loading more posts…', 'กำลังโหลดโพสต์เพิ่มเติม…']) {
    const app = fixture({ loaderUntil: 5000, loaderRole: 'status', loaderLabel });
    await app.finish();
    assert.ok(app.confirmations[0].at >= 8000);
  }
});

test('hidden or unrelated header loaders do not keep the finished list scrolling', async () => {
  for (const options of [{ hiddenLoader: true }, { loaderTop: 50 }]) {
    const app = fixture({ ...options, loaderUntil: 600000 });
    await app.finish();
    assert.equal(app.confirmations.length, 1);
    assert.ok(app.elapsed <= 3300);
  }
});

test('wrong page and spoofed Facebook host abort before scrolling or confirmation', async () => {
  for (const options of [
    { pendingPage: false },
    { hostname: 'notfacebook.com' },
    { hostname: 'facebook.com.evil.test' },
  ]) {
    const app = fixture(options);
    await app.finish();
    assert.equal(app.scrolls.length, 0);
    assert.equal(app.confirmations.length, 0);
    assert.equal(app.clicks.length, 0);
  }
});

test('stopping during fast scrolling prevents all deletion and confirmation', async () => {
  const app = fixture({ stopAt: 300, accept: true });
  await app.finish();
  assert.equal(app.elapsed, 300);
  assert.equal(app.scrolls.length, 3);
  assert.equal(app.confirmations.length, 0);
  assert.equal(app.clicks.length, 0);
});

test('stalled loading and unreachable bottom abort rather than deleting an incomplete list', async () => {
  for (const options of [
    { loaderUntil: 600000 },
    { unreachableBottom: true },
    { unreachableBottom: true, layoutGrowth: true },
  ]) {
    const app = fixture({ ...options, accept: true });
    await app.finish();
    assert.ok(app.elapsed >= 10000 && app.elapsed <= 10300);
    assert.equal(app.confirmations.length, 0);
    assert.equal(app.clicks.length, 0);
    assert.ok(app.messages.some((message) => message.includes('No posts were deleted')));
  }
});

test('endlessly new posts reach the ten-minute cap without confirming or deleting', async () => {
  const app = fixture({ endlessPosts: true, accept: true });
  await app.finish();
  assert.equal(app.elapsed, 600000);
  assert.equal(app.confirmations.length, 0);
  assert.equal(app.clicks.length, 0);
  assert.ok(app.messages.some((message) => message.includes('10-minute limit')));
});

test('unchanged recreated cards and layout growth are not mistaken for new pending posts', async () => {
  for (const options of [
    { rerender: true, layoutGrowth: true },
    { rerender: true, noLinks: true },
    { fallbackRoot: true },
  ]) {
    const app = fixture(options);
    await app.finish();
    assert.equal(app.confirmations.length, 1);
    assert.ok(app.elapsed <= 3300, String(app.elapsed));
  }
});

test('no loaded posts retains the supplied empty-page guard', async () => {
  const app = fixture({ initialPosts: 0, accept: true });
  await app.finish();
  assert.equal(app.confirmations.length, 0);
  assert.equal(app.clicks.length, 0);
  assert.ok(
    app.messages.some((message) => message.includes('Open the Facebook Pending Posts page')),
  );
});

test('confirmed deletion retains verification, optional Facebook dialog, and 1200ms spacing', async () => {
  for (const dialog of [false, true]) {
    const app = fixture({ accept: true, dialog });
    await app.finish();
    assert.equal(app.remaining, 0);
    assert.equal(app.clicks.filter((click) => click.kind === 'delete').length, 2);
    assert.equal(app.clicks.filter((click) => click.kind === 'confirm').length, dialog ? 2 : 0);
    assert.equal(app.delays.filter((delay) => delay === 1200).length, 2);
    assert.ok(app.clicks.every((click) => click.at >= app.confirmations[0].at));
    const deleteClicks = app.clicks.filter((click) => click.kind === 'delete');
    assert.equal(deleteClicks[1].at - deleteClicks[0].at, 700 + 250 + 1200);
    assert.ok(app.messages.includes('Finished. Verified deletions: 2/2'));
  }
});

test('the original URL-change verification remains supported', async () => {
  const app = fixture({ accept: true, replaceUrlOnRemoval: true });
  await app.finish();
  assert.equal(app.remaining, 0);
  assert.ok(app.messages.includes('Finished. Verified deletions: 2/2'));
});

test('missing delete or confirmation controls stop without another action', async () => {
  const noDelete = fixture({ accept: true, missingDelete: true });
  await noDelete.finish();
  assert.equal(noDelete.clicks.length, 0);
  assert.ok(noDelete.messages.includes('Delete button not found. Stopping.'));
  const noConfirm = fixture({ accept: true, dialog: true, missingConfirm: true });
  await noConfirm.finish();
  assert.equal(noConfirm.clicks.length, 1);
  assert.equal(noConfirm.clicks[0].kind, 'delete');
  assert.ok(noConfirm.messages.includes('Confirmation button not found. Stopping.'));
});

test('unverified removal stops before attempting a second post', async () => {
  const app = fixture({ accept: true, verifyFailure: true });
  await app.finish();
  assert.equal(app.clicks.length, 1);
  assert.equal(app.remaining, 2);
  assert.ok(app.messages.includes('Post removal could not be verified. Stopping.'));
  assert.ok(app.messages.includes('Finished. Verified deletions: 0/2'));
});

test('stop requests during delete-button waits or the post-click pause prevent further clicks', async () => {
  const waiting = fixture({ accept: true, buttonReadyAt: 8000, stopAt: 3400 });
  await waiting.finish();
  assert.equal(waiting.clicks.length, 0);
  const afterClick = fixture({ accept: true, dialog: true, stopAt: 3500 });
  await afterClick.finish();
  assert.equal(afterClick.clicks.length, 1);
  assert.equal(afterClick.clicks[0].kind, 'delete');
  assert.ok(afterClick.messages.includes('Deletion stopped.'));
});
