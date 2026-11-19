import assert from 'node:assert/strict';
import { runInNewContext } from 'node:vm';

export class Element {
  parentElement: Element | null = null;
  children: Element[] = [];
  isConnected = true;
  hidden = false;
  scrollHeight = 400;
  clientHeight = 400;
  scrollTop = 0;
  scrollLeft = 175;
  overflowY = 'visible';
  visibility = 'visible';
  display = 'block';
  disabled = false;
  onClick?: () => void;
  onScroll?: (position: { top: number; left: number; behavior: string }) => void;

  constructor(
    readonly tagName: string,
    readonly attributes: Record<string, string> = {},
    public text = '',
  ) {}

  get textContent(): string {
    return this.text + this.children.map((child) => child.textContent).join('');
  }

  get outerHTML(): string {
    const escape = (value: string) =>
      value.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/"/g, '&quot;');
    const attributes = Object.entries(this.attributes)
      .map(([name, value]) => ` ${name}="${escape(value)}"`)
      .join('');
    return `<${this.tagName}${attributes}>${escape(this.text)}${this.children.map((child) => child.outerHTML).join('')}</${this.tagName}>`;
  }

  append(...children: Element[]) {
    for (const child of children) child.parentElement = this;
    this.children.push(...children);
    return this;
  }

  getAttribute(name: string) {
    return this.attributes[name] ?? null;
  }

  contains(other: Element): boolean {
    return this === other || this.children.some((child) => child.contains(other));
  }

  matches(selector: string): boolean {
    return selector.split(',').some((part) => {
      const value = part.trim();
      const attribute = /^\[([^=\]]+)(?:="([^"]*)")?\]$/.exec(value);
      if (attribute)
        return attribute[2] === undefined
          ? attribute[1] in this.attributes
          : this.attributes[attribute[1]] === attribute[2];
      if (value === 'tbody tr')
        return this.tagName === 'tr' && !!this.parentElement?.closest('tbody');
      return this.tagName === value;
    });
  }

  closest(selector: string): Element | null {
    return this.matches(selector) ? this : this.parentElement?.closest(selector) || null;
  }

  descendants(): Element[] {
    return this.children.flatMap((child) => [child, ...child.descendants()]);
  }

  querySelectorAll(selector: string) {
    return this.descendants().filter((child) => child.matches(selector));
  }

  querySelector(selector: string) {
    return this.querySelectorAll(selector)[0] || null;
  }

  getClientRects() {
    return this.hidden ? [] : [{ top: 0, bottom: 400 }];
  }

  getBoundingClientRect() {
    return { top: 0, bottom: 400 };
  }

  scrollTo(position: { top: number; left: number; behavior: string }) {
    this.onScroll?.(position);
  }

  click() {
    if (!this.disabled) this.onClick?.();
  }
}

export type PostTableFixtureOptions = {
  target?:
    | 'panel'
    | 'root'
    | 'table'
    | 'tbody'
    | 'none'
    | 'horizontal'
    | 'clipped'
    | 'wrapped-panel'
    | 'inert-table';
  label?: string;
  headers?: string[];
  missing?: boolean;
  duplicate?: boolean;
  hiddenDuplicate?: boolean;
  loaderUntil?: number;
  hiddenLoader?: boolean;
  loaderFlicker?: boolean;
  newRowsAt?: number;
  replaceRowsAt?: number;
  detachAt?: number;
  endless?: boolean;
  unreachableBottom?: boolean;
  throwOnScroll?: boolean;
  loadAfterBoundaryRetry?: boolean;
  viewersSort?: 'ascending' | 'descending' | 'none';
  sortDelay?: number;
  sortFails?: boolean;
  sortReplaceTable?: boolean;
  sortButtonDisabled?: boolean;
  sortFirstAscending?: boolean;
  duplicateViewersHeader?: boolean;
  sortStopAt?: number;
  initialTop?: number;
  commandDescriptor?: PropertyDescriptor;
  captureClipboard?: boolean;
  devtools?: boolean;
  expireDevtoolsCopy?: boolean;
  clipboardDenied?: boolean;
  clipboardMissing?: boolean;
  copyFails?: boolean;
  duplicateOnCleanup?: boolean;
  replaceOnCleanup?: boolean;
};

export function createPostTableFixture(source: string, options: PostTableFixtureOptions = {}) {
  let now = 0;
  let done = false;
  let failure: unknown;
  let added = false;
  let replaced = false;
  let serial = 1;
  let reachedBoundary = false;
  let leftBoundary = false;
  let sortRequestedAt: number | undefined;
  let sortCompletedAt: number | undefined;
  const clicks: { label: string; at: number }[] = [];
  const timers: { callback: () => void; delay: number }[] = [];
  const delays: number[] = [];
  const messages: string[] = [];
  const logs: string[] = [];
  const warnings: string[] = [];
  const errors: string[] = [];
  const copies: { html: string; at: number; method: 'devtools' | 'clipboard' }[] = [];
  const listeners = new Set<(event: { key: string; isComposing?: boolean }) => void>();
  const scrolls: { element: Element; at: number; top: number; left: number; behavior: string }[] =
    [];
  const root = new Element('html');
  const body = new Element('body');
  const panel = new Element('div');
  let table = new Element('table', {
    role: 'grid',
    'aria-label': options.label ?? 'คลังเนื้อหา',
  });
  const tbody = new Element('tbody');
  const headers = (options.headers ?? ['ตัวอย่าง', 'ยอดดู', 'ผู้ชม']).map((text) => {
    const header = new Element('th', { role: 'columnheader' });
    const button = new Element('button', { role: 'button', 'aria-label': text }, text);
    header.append(button);
    if (/^(?:Viewers|ผู้ชม)$/.test(text)) {
      if ((options.viewersSort ?? 'descending') !== 'none')
        header.attributes['aria-sort'] = options.viewersSort ?? 'descending';
      button.disabled = !!options.sortButtonDisabled;
      if (button.disabled) button.attributes['aria-disabled'] = 'true';
      button.onClick = header.onClick = () => {
        clicks.push({ label: text, at: now });
        sortRequestedAt = now;
        sortCompletedAt = undefined;
        table.attributes['aria-busy'] = 'true';
      };
    } else {
      button.onClick = header.onClick = () => clicks.push({ label: text, at: now });
    }
    return header;
  });
  if (options.duplicateViewersHeader) {
    headers.push(new Element('th', { role: 'columnheader' }, 'Viewers'));
  }
  const makeRow = (index: number) =>
    new Element('tr', { role: 'row', 'data-index': String(index) }).append(
      new Element('td', { role: 'gridcell' }, 'Repeated long post '.repeat(100) + index),
    );
  table.append(
    new Element('thead').append(new Element('tr', { role: 'row' }).append(...headers)),
    tbody.append(makeRow(0), makeRow(1)),
    new Element('tbody', { 'aria-hidden': 'true' }).append(
      new Element('tr').append(new Element('td')),
    ),
  );
  root.append(body.append(panel));
  if (!options.missing) panel.append(table);
  if (options.duplicate || options.hiddenDuplicate) {
    const duplicate = new Element('table', { role: 'grid', 'aria-label': 'Content library' });
    duplicate.hidden = !!options.hiddenDuplicate;
    panel.append(duplicate);
  }
  const target = options.target ?? 'panel';
  let scroller =
    target === 'root' || target === 'clipped'
      ? root
      : target === 'tbody'
        ? tbody
        : target === 'table'
          ? table
          : panel;
  if (target !== 'none') {
    scroller.scrollHeight = 2400;
    scroller.overflowY =
      target === 'horizontal' ? 'hidden' : target === 'root' ? 'visible' : 'auto';
  }
  if (target === 'clipped') {
    panel.overflowY = 'hidden';
    panel.scrollHeight = 2000;
  }
  if (target === 'wrapped-panel') {
    const wrapper = new Element('div');
    wrapper.overflowY = 'hidden';
    wrapper.scrollHeight = 2000;
    panel.children = [];
    panel.append(wrapper.append(table));
  }
  if (target === 'inert-table') {
    table.overflowY = 'auto';
    table.scrollHeight = 2400;
  }
  if (options.initialTop !== undefined) scroller.scrollTop = options.initialTop;
  for (const element of [root, panel, table, tbody]) {
    element.onScroll = (position) => {
      scrolls.push({ element, at: now, ...position });
      if (options.throwOnScroll) throw new Error('Simulated scroll failure');
      if (target === 'inert-table' && element === table) return;
      const bottom = Math.max(
        0,
        element.scrollHeight - element.clientHeight - (options.unreachableBottom ? 20 : 0),
      );
      // Real scrolling clamps the requested position; repeatedly requesting the
      // bottom emits no new movement and cannot retrigger a lazy-load boundary.
      element.scrollTop = Math.min(bottom, Math.max(0, position.top));
      element.scrollLeft = position.left;
      if (element === scroller && options.loadAfterBoundaryRetry) {
        if (reachedBoundary && element.scrollTop < bottom - 1) leftBoundary = true;
        if (leftBoundary && element.scrollTop >= bottom - 1 && !added) {
          tbody.append(makeRow(2));
          element.scrollHeight += 400;
          added = true;
        }
        if (element.scrollTop >= bottom - 1) reachedBoundary = true;
      }
      if (options.endless) {
        tbody.children[0].text = 'New row ' + ++serial;
      }
    };
  }
  const originalTable = table;
  const completeSort = () => {
    if (sortCompletedAt !== undefined || sortRequestedAt === undefined || options.sortFails) return;
    if (now < sortRequestedAt + (options.sortDelay ?? 0)) return;
    sortCompletedAt = now;
    for (const header of headers)
      if (/^(?:Viewers|ผู้ชม)$/.test(header.textContent))
        header.attributes['aria-sort'] =
          options.sortFirstAscending && clicks.length === 1 ? 'ascending' : 'descending';
    table.attributes['aria-busy'] = 'false';
    tbody.children[0].text = 'Sorted viewer rows';
    if (options.sortReplaceTable) {
      const replacement = new Element('table', { ...table.attributes });
      replacement.append(...table.children);
      replacement.scrollHeight = table.scrollHeight;
      replacement.overflowY = table.overflowY;
      replacement.onScroll = (position) => {
        scrolls.push({ element: replacement, at: now, ...position });
        replacement.scrollTop = Math.min(
          replacement.scrollHeight - replacement.clientHeight,
          Math.max(0, position.top),
        );
        replacement.scrollLeft = position.left;
      };
      const parent = table.parentElement!;
      parent.children[parent.children.indexOf(table)] = replacement;
      replacement.parentElement = parent;
      table.isConnected = false;
      if (scroller === table) scroller = replacement;
      table = replacement;
    }
  };
  const loader = new Element('div', { role: 'progressbar' }, 'Loading…');
  loader.hidden = !!options.hiddenLoader;
  if (options.loaderUntil !== undefined || options.loaderFlicker) scroller.append(loader);
  const window: {
    innerHeight: number;
    scrollTo: (position: { top: number; left: number; behavior: string }) => void;
    postTableScrollRunning?: boolean;
    stopPostTableScrollRequested?: boolean;
    stopPostTableScroll?: () => void;
  } = { innerHeight: 400, scrollTo: (position) => root.scrollTo(position) };
  if (options.commandDescriptor)
    Object.defineProperty(window, 'stopPostTableScroll', options.commandDescriptor);
  const document = {
    body,
    documentElement: root,
    scrollingElement: root,
    querySelectorAll: (selector: string) => root.querySelectorAll(selector),
    addEventListener(type: string, listener: (event: { key: string }) => void, capture: boolean) {
      assert.equal(type, 'keydown');
      assert.equal(capture, true);
      listeners.add(listener);
    },
    removeEventListener(
      type: string,
      listener: (event: { key: string }) => void,
      capture: boolean,
    ) {
      assert.equal(type, 'keydown');
      assert.equal(capture, true);
      assert.ok(listeners.delete(listener));
      if (options.duplicateOnCleanup)
        panel.append(new Element('table', { 'aria-label': 'Content library' }));
      if (options.replaceOnCleanup) {
        const replacement = new Element('table', { ...table.attributes });
        replacement.append(...table.children);
        const parent = table.parentElement!;
        parent.children[parent.children.indexOf(table)] = replacement;
        replacement.parentElement = parent;
        table.isConnected = false;
        table = replacement;
      }
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
    getComputedStyle: (element: Element) => element,
    setTimeout(callback: () => void, delay: number) {
      timers.push({ callback, delay });
      delays.push(delay);
    },
    console: {
      log(text: string) {
        messages.push(text);
        logs.push(text);
      },
      warn(text: string) {
        messages.push(text);
        warnings.push(text);
      },
      error(text: string) {
        messages.push(text);
        errors.push(text);
      },
    },
    fetch() {
      throw new Error('Scroll-only snippet must not make network requests.');
    },
    ...(options.devtools === false
      ? {}
      : {
          copy(html: string) {
            if (!options.captureClipboard)
              throw new Error('Scroll-only snippet must not modify the clipboard.');
            if (options.copyFails) throw new Error('Simulated DevTools copy failure');
            copies.push({ html, at: now, method: 'devtools' });
          },
        }),
    navigator: options.clipboardMissing
      ? {}
      : {
          clipboard: {
            async writeText(html: string) {
              if (!options.captureClipboard)
                throw new Error('Scroll-only snippet must not modify the clipboard.');
              if (options.clipboardDenied) throw new Error('Simulated clipboard denial');
              copies.push({ html, at: now, method: 'clipboard' });
            },
          },
        },
  };
  const runAgain = () => runInNewContext(source, context) as Promise<void>;
  runAgain().then(
    () => {
      done = true;
    },
    (error: unknown) => {
      failure = error;
      done = true;
    },
  );
  return {
    root,
    panel,
    tbody,
    get table() {
      return table;
    },
    originalTable,
    get scroller() {
      return scroller;
    },
    window,
    scrolls,
    messages,
    logs,
    warnings,
    errors,
    copies,
    delays,
    listeners,
    clicks,
    get sortCompletedAt() {
      return sortCompletedAt;
    },
    runAgain,
    get elapsed() {
      return now;
    },
    pressKey(key: string, isComposing = false) {
      for (const listener of listeners) listener({ key, isComposing });
    },
    async finish() {
      for (let step = 0; step < 7000; step++) {
        for (let microtask = 0; microtask < 6; microtask++) await Promise.resolve();
        if (done) {
          if (failure) throw failure;
          return;
        }
        const timer = timers.shift();
        assert.ok(timer, 'Pending scroll must have a timer.');
        if (options.expireDevtoolsCopy) delete context.copy;
        now += timer.delay;
        completeSort();
        if (options.sortStopAt !== undefined && now >= options.sortStopAt)
          for (const listener of listeners) listener({ key: 'Escape' });
        if (!added && options.newRowsAt !== undefined && now >= options.newRowsAt) {
          tbody.append(makeRow(2));
          added = true;
        }
        if (!replaced && options.replaceRowsAt !== undefined && now >= options.replaceRowsAt) {
          tbody.children[0].attributes['data-index'] = '20';
          replaced = true;
        }
        if (options.detachAt !== undefined && now >= options.detachAt) table.isConnected = false;
        if (options.loaderUntil !== undefined && now >= options.loaderUntil) loader.hidden = true;
        if (options.loaderFlicker) loader.hidden = Math.floor(now / 500) % 2 === 0;
        timer.callback();
      }
      assert.fail('Scroll did not finish within its time bound.');
    },
  };
}
