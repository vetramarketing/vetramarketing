import assert from 'node:assert/strict';
import test from 'node:test';
import { openPostLinkInNewTab } from '../src/lib/open-post-link';

const url = 'https://www.facebook.com/groups/designg/posts/1810899433450636/?ref=share#comments';
type Failure = 'open' | 'opener' | 'document' | 'create' | 'append' | 'click';

/** A fake popup records operations without opening a tab or requesting a remote URL. */
function fixture(options: { blocked?: boolean; failure?: Failure; closeThrows?: boolean } = {}) {
  const events: string[] = [];
  const openCalls: unknown[][] = [];
  let opener: unknown = { parent: true };
  let closed = false;
  const anchor = {
    href: '',
    target: '',
    rel: '',
    click() {
      events.push('click');
      assert.equal(opener, null, 'The parent window must be inaccessible before navigation');
      if (options.failure === 'click') throw new Error('Navigation failed');
    },
  };
  const document = {
    createElement(tag: string) {
      events.push('create');
      assert.equal(tag, 'a');
      if (options.failure === 'create') throw new Error('Element creation failed');
      return anchor;
    },
    body: {
      appendChild(element: unknown) {
        events.push('append');
        assert.strictEqual(element, anchor);
        if (options.failure === 'append') throw new Error('Append failed');
      },
    },
  };
  const child = {
    get opener() {
      return opener;
    },
    set opener(value: unknown) {
      events.push('clear-opener');
      assert.equal(value, null);
      if (options.failure === 'opener') throw new Error('Opener access failed');
      opener = value;
    },
    get document() {
      events.push('document');
      if (options.failure === 'document') throw new Error('Document access failed');
      return document;
    },
    close() {
      events.push('close');
      if (options.closeThrows) throw new Error('Close failed');
      closed = true;
    },
  };
  const browser = {
    open(...args: unknown[]) {
      events.push('open');
      openCalls.push(args);
      if (options.failure === 'open') throw new Error('Popup failed');
      return options.blocked ? null : child;
    },
  } as unknown as Pick<Window, 'open'>;
  return {
    browser,
    events,
    openCalls,
    anchor,
    get closed() {
      return closed;
    },
  };
}

test('opens one blank tab synchronously, clears its opener, and navigates using a noreferrer self link', () => {
  const app = fixture();
  const result = openPostLinkInNewTab(url, app.browser);
  assert.equal(result, true);
  assert.deepEqual(app.openCalls, [['about:blank', '_blank']]);
  assert.deepEqual(app.events, [
    'open',
    'clear-opener',
    'document',
    'create',
    'document',
    'append',
    'click',
  ]);
  assert.equal(
    app.anchor.href,
    url,
    'Keep the selected destination exactly, including query and fragment',
  );
  assert.equal(app.anchor.target, '_self');
  assert.equal(app.anchor.rel, 'noreferrer');
  assert.equal(app.closed, false);
});

test('a blocked popup returns false without preparing or navigating another window', () => {
  const app = fixture({ blocked: true });
  assert.equal(openPostLinkInNewTab(url, app.browser), false);
  assert.deepEqual(app.events, ['open']);
  assert.equal(app.anchor.href, '');
  assert.equal(app.openCalls.length, 1);
});

test('a thrown popup error returns false without navigation or cleanup of another window', () => {
  const app = fixture({ failure: 'open' });
  assert.equal(openPostLinkInNewTab(url, app.browser), false);
  assert.deepEqual(app.events, ['open']);
  assert.equal(app.openCalls.length, 1);
});

test('empty, non-HTTPS, credentialed, or malformed destinations never call window.open', () => {
  for (const unsafe of [
    '',
    ' ',
    'not a URL',
    '/relative',
    '//facebook.com/post',
    'http://facebook.com/post',
    'javascript:alert(1)',
    'data:text/html,test',
    'file:///C:/test.html',
    'https://user:password@facebook.com/post',
    'https://user@facebook.com/post',
    'https://facebook.com/post\n',
    'https://facebook.com/some path',
  ]) {
    const app = fixture();
    assert.equal(openPostLinkInNewTab(unsafe, app.browser), false, unsafe);
    assert.deepEqual(app.events, [], unsafe);
  }
});

test('safe HTTPS links for other supported social platforms use the same navigation path', () => {
  for (const destination of [
    'https://www.instagram.com/p/example/',
    'https://www.tiktok.com/@example/video/123',
  ]) {
    const app = fixture();
    assert.equal(openPostLinkInNewTab(destination, app.browser), true);
    assert.equal(app.anchor.href, destination);
    assert.equal(app.openCalls.length, 1);
  }
});

test('setup failures close only the created popup and never attempt a second popup', () => {
  for (const failure of ['opener', 'document', 'create', 'append', 'click'] as const) {
    const app = fixture({ failure });
    assert.equal(openPostLinkInNewTab(url, app.browser), false, failure);
    assert.equal(app.openCalls.length, 1, failure);
    assert.equal(app.events.at(-1), 'close', failure);
    assert.equal(app.events.filter((event) => event === 'close').length, 1, failure);
    assert.equal(app.closed, true, failure);
    if (failure !== 'click') assert.ok(!app.events.includes('click'), failure);
  }
});

test('a failed cleanup does not turn a failed navigation into an exception or success', () => {
  const app = fixture({ failure: 'append', closeThrows: true });
  assert.equal(openPostLinkInNewTab(url, app.browser), false);
  assert.equal(app.events.at(-1), 'close');
  assert.ok(!app.events.includes('click'));
  assert.equal(app.openCalls.length, 1);
});
