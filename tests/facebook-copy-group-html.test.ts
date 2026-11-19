import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import test from 'node:test';
import { runInNewContext } from 'node:vm';

const source = readFileSync(
  new URL('../public/console-scripts/facebook-copy-joined-groups-html.js', import.meta.url),
  'utf8',
);

/** Small read-only DOM fixture; the copied HTML is supplied verbatim, not reconstructed. */
class Element {
  parentElement: Element | null = null;
  children: Element[] = [];

  constructor(
    readonly tagName: string,
    readonly attributes: Record<string, string> = {},
    readonly textContent = '',
    readonly outerHTML = '',
  ) {}

  append(...children: Element[]) {
    children.forEach((child) => (child.parentElement = this));
    this.children.push(...children);
    return this;
  }

  getAttribute(name: string) {
    return this.attributes[name] ?? null;
  }

  contains(other: Element): boolean {
    return other === this || this.children.some((child) => child.contains(other));
  }

  matches(selector: string): boolean {
    return selector.split(',').some((part) => {
      const simple = part.trim();
      const role = /^\[role="([^"]+)"\]$/.exec(simple);
      if (role) return this.attributes.role === role[1];
      if (simple === 'a[href]') return this.tagName === 'a' && 'href' in this.attributes;
      return this.tagName === simple;
    });
  }

  querySelectorAll(selector: string): Element[] {
    const descendants = this.children.flatMap((child) => [child, ...child.descendants()]);
    if (selector === '[role="listitem"] a[href]') {
      return descendants.filter((node) => {
        if (!node.matches('a[href]')) return false;
        for (
          let ancestor = node.parentElement;
          ancestor && ancestor !== this;
          ancestor = ancestor.parentElement
        ) {
          if (ancestor.matches('[role="listitem"]')) return true;
        }
        return false;
      });
    }
    return descendants.filter((node) => node.matches(selector));
  }

  descendants(): Element[] {
    return this.children.flatMap((child) => [child, ...child.descendants()]);
  }
}

const link = (href: string) => new Element('a', { href });
const groupList = (...hrefs: string[]) =>
  new Element('div', { role: 'list' }).append(
    ...hrefs.map((href) => new Element('div', { role: 'listitem' }).append(link(href))),
  );
const section = (
  heading: string,
  hrefs = ['/groups/123/'],
  html = '<section><h2>Joined groups</h2><div role="list">original &amp; exact</div></section>',
) =>
  new Element('section', {}, '', html).append(
    new Element('header').append(new Element('h2', {}, heading)),
    groupList(...hrefs),
  );

async function runCopy(
  nodes: Element[],
  options: {
    devtools?: boolean;
    clipboard?: boolean;
    denyClipboard?: boolean;
    failCopy?: boolean;
  } = {},
) {
  const documentElement = new Element('html');
  const body = new Element('body');
  documentElement.append(body.append(...nodes));
  const copied: string[] = [];
  const clipboardWrites: string[] = [];
  const logs: string[] = [];
  const warnings: string[] = [];
  const errors: string[] = [];
  const context = {
    URL,
    document: {
      body,
      documentElement,
      querySelectorAll: (selector: string) => documentElement.querySelectorAll(selector),
    },
    navigator: {
      clipboard:
        options.clipboard === false
          ? undefined
          : {
              writeText: async (text: string) => {
                if (options.denyClipboard) throw new Error('Clipboard access denied');
                clipboardWrites.push(text);
              },
            },
    },
    console: {
      log: (message: string) => logs.push(message),
      warn: (message: string) => warnings.push(message),
      error: (message: string) => errors.push(message),
    },
    ...(options.devtools === false
      ? {}
      : {
          copy: (text: string) => {
            if (options.failCopy) throw new Error('Copy failed');
            copied.push(text);
          },
        }),
  };
  await runInNewContext(source, context);
  return { copied, clipboardWrites, logs, warnings, errors };
}

for (const heading of [
  'กลุ่มทั้งหมดที่คุณเข้าร่วม (162)',
  'กลุ่มที่คุณเข้าร่วม',
  "All groups you've joined (1,234)",
  'Groups you’ve joined',
  'Groups you have joined',
  'Your groups',
]) {
  test(`copies exact joined-section outerHTML for ${heading}`, async () => {
    const target = section(heading);
    const result = await runCopy([target]);
    assert.deepEqual(result.copied, [target.outerHTML]);
    assert.deepEqual(result.clipboardWrites, []);
    assert.match(result.logs[0], /1 loaded groups/);
    assert.equal(result.errors.length, 0);
  });
}

test('leaves clipboard untouched when the page has no matching heading', async () => {
  const result = await runCopy([section('Groups you manage')]);
  assert.deepEqual(result.copied, []);
  assert.deepEqual(result.clipboardWrites, []);
  assert.equal(result.logs.length, 0);
  assert.match(result.warnings[0], /Clipboard unchanged/);
});

test('does not associate a navigation heading with unrelated lists outside it', async () => {
  const navigation = new Element('nav').append(new Element('h2', {}, 'Your groups'));
  const result = await runCopy([navigation, groupList('/groups/unrelated/')]);
  assert.deepEqual(result.copied, []);
  assert.deepEqual(result.clipboardWrites, []);
});

test('does not collect unrelated list content from outside the joined section', async () => {
  const target = section('Your groups', ['/groups/right/']);
  const result = await runCopy([
    groupList('/groups/unrelated/'),
    target,
    section('Suggested groups', ['/groups/suggested/']),
  ]);
  assert.deepEqual(result.copied, [target.outerHTML]);
  assert.match(result.logs[0], /1 loaded groups/);
});

test('accepts relative and slug links and counts each group once across repeated anchors', async () => {
  const target = section('Your groups', [
    '/groups/123/',
    'https://www.facebook.com/groups/123/?ref=share',
    'https://m.facebook.com/groups/123',
    '/groups/my.group-name/?sorting_setting=CHRONOLOGICAL',
    'https://facebook.com/groups/my.group-name/#about',
  ]);
  const result = await runCopy([target]);
  assert.deepEqual(result.copied, [target.outerHTML]);
  assert.match(result.logs[0], /2 loaded groups/);
});

test('excludes navigation, external, malformed and post links from the group count', async () => {
  const target = section('Your groups', [
    '/groups/real/',
    '/groups/feed/',
    '/groups/discover/',
    '/groups/joins/',
    '/groups/create/',
    '/groups/categories/',
    '/groups/notifications/',
    '/groups/your_groups/',
    '/groups/123/posts/456/',
    'https://evilfacebook.com/groups/456/',
    'https://facebook.com.evil.example/groups/456/',
    'https://example.com/groups/456/',
    'javascript:alert(1)',
    'https://[bad-host/groups/456/',
  ]);
  const result = await runCopy([target]);
  assert.match(result.logs[0], /1 loaded groups/);
});

test('does not copy a section containing only navigation links and empty placeholders', async () => {
  const target = section('Your groups', ['/groups/feed/', '/groups/joins/']);
  target.children[1].append(new Element('div', { role: 'listitem' }));
  const result = await runCopy([target]);
  assert.deepEqual(result.copied, []);
  assert.deepEqual(result.clipboardWrites, []);
  assert.match(result.warnings[0], /No loaded joined-groups section/);
});

test('supports heading roles, normalized whitespace, and exact Unicode HTML', async () => {
  const target = new Element('div', {}, '', '<div>กลุ่มไทย &amp; café 👋</div>').append(
    new Element('div', { role: 'heading' }, '  Your\n groups ( 2 ) '),
    groupList('/groups/123/', '/groups/thai/'),
  );
  const result = await runCopy([target]);
  assert.deepEqual(result.copied, [target.outerHTML]);
  assert.match(result.logs[0], /2 loaded groups/);
});

test('copies nested matching sections only once using the outer section', async () => {
  const inner = section('Your groups', ['/groups/one/'], '<div>inner HTML</div>');
  const outer = new Element(
    'section',
    {},
    '',
    '<section>outer including inner HTML</section>',
  ).append(new Element('h2', {}, "All groups you've joined"), inner);
  const result = await runCopy([outer]);
  assert.deepEqual(result.copied, [outer.outerHTML]);
  assert.match(result.logs[0], /1 loaded groups/);
});

test('combines independent matching sections in document order without duplicate group counts', async () => {
  const first = section('Your groups', ['/groups/one/'], '<section>first</section>');
  const second = section(
    'กลุ่มที่คุณเข้าร่วม',
    ['/groups/one/', '/groups/two/'],
    '<section>second</section>',
  );
  const result = await runCopy([first, second]);
  assert.deepEqual(result.copied, [first.outerHTML + '\n\n' + second.outerHTML]);
  assert.match(result.logs[0], /2 loaded groups/);
});

test('uses Clipboard API when the Console copy helper is unavailable', async () => {
  const target = section('Your groups');
  const result = await runCopy([target], { devtools: false });
  assert.deepEqual(result.clipboardWrites, [target.outerHTML]);
  assert.deepEqual(result.copied, []);
  assert.equal(result.logs.length, 1);
  assert.deepEqual(result.errors, []);
});

test('reports denied clipboard access without claiming success', async () => {
  const result = await runCopy([section('Your groups')], {
    devtools: false,
    denyClipboard: true,
  });
  assert.deepEqual(result.clipboardWrites, []);
  assert.deepEqual(result.logs, []);
  assert.match(result.errors[0], /Could not copy/);
});

test('reports a missing clipboard API without claiming success', async () => {
  const result = await runCopy([section('Your groups')], { devtools: false, clipboard: false });
  assert.deepEqual(result.logs, []);
  assert.match(result.errors[0], /F12 Console/);
});

test('reports a failed Console copy without claiming success', async () => {
  const result = await runCopy([section('Your groups')], { failCopy: true });
  assert.deepEqual(result.copied, []);
  assert.deepEqual(result.logs, []);
  assert.match(result.errors[0], /Could not copy/);
});
