import assert from 'node:assert/strict';
import test, { type TestContext } from 'node:test';
import { copyScriptCode } from '../src/lib/script-clipboard';

const source = '\tconst text = "ภาษาไทย 😀";\r\nconsole.log(text);\r// final line\n  ';

function browser(
  t: TestContext,
  options: {
    writeText?: (value: string) => Promise<void>;
    modal?: boolean;
    commandResult?: boolean;
    dispatchCopy?: boolean;
    clipboardData?: boolean;
    setDataThrows?: boolean;
    commandThrows?: boolean;
  } = {},
) {
  const descriptors = new Map(
    ['document', 'navigator', 'HTMLElement'].map((key) => [
      key,
      Object.getOwnPropertyDescriptor(globalThis, key),
    ]),
  );
  t.after(() => {
    for (const [key, descriptor] of descriptors) {
      if (descriptor) Object.defineProperty(globalThis, key, descriptor);
      else Reflect.deleteProperty(globalThis, key);
    }
  });
  const listeners = new Set<(event: ClipboardEvent) => void>();
  const state = {
    text: '',
    mimeType: '',
    commands: 0,
    selected: false,
    prevented: false,
    parent: null as ElementMock | null,
    active: null as ElementMock | null,
  };
  class ElementMock {
    style = { cssText: '' };
    readOnly = false;
    storedValue = '';
    get value() {
      return this.storedValue;
    }
    set value(value: string) {
      this.storedValue = value.replace(/\r\n?/g, '\n');
    }
    setAttribute() {}
    closest() {
      return options.modal ? modal : null;
    }
    appendChild() {
      state.parent = this;
    }
    focus() {
      state.active = this;
    }
    select() {
      state.selected = true;
    }
    remove() {
      state.parent = null;
    }
  }
  const active = new ElementMock();
  const body = new ElementMock();
  const modal = new ElementMock();
  const field = new ElementMock();
  state.active = active;
  const documentMock = {
    get activeElement() {
      return state.active;
    },
    body,
    createElement: () => field,
    addEventListener: (_type: string, listener: (event: ClipboardEvent) => void) =>
      listeners.add(listener),
    removeEventListener: (_type: string, listener: (event: ClipboardEvent) => void) =>
      listeners.delete(listener),
    execCommand: (command: string) => {
      assert.equal(command, 'copy');
      assert.equal(state.parent, options.modal ? modal : body);
      assert.equal(state.active, field);
      assert.equal(state.selected, true);
      state.commands += 1;
      if (options.commandThrows) throw new Error('Denied command');
      if (options.dispatchCopy !== false) {
        const event = {
          preventDefault: () => {
            state.prevented = true;
          },
          clipboardData:
            options.clipboardData === false
              ? null
              : {
                  setData: (mimeType: string, value: string) => {
                    if (options.setDataThrows) throw new Error('Denied clipboard data');
                    state.mimeType = mimeType;
                    state.text = value;
                  },
                },
        } as unknown as ClipboardEvent;
        for (const listener of listeners) listener(event);
      }
      return options.commandResult !== false;
    },
  };
  Object.defineProperty(globalThis, 'document', { configurable: true, value: documentMock });
  Object.defineProperty(globalThis, 'navigator', {
    configurable: true,
    value: { clipboard: options.writeText ? { writeText: options.writeText } : undefined },
  });
  Object.defineProperty(globalThis, 'HTMLElement', { configurable: true, value: ElementMock });
  return { state, active, field, listeners };
}

test('Clipboard API receives source text verbatim without invoking a fallback', async (t) => {
  const received: string[] = [];
  const { state, listeners } = browser(t, {
    writeText: async (value) => {
      received.push(value);
    },
  });
  await copyScriptCode(source);
  assert.deepEqual(received, [source]);
  assert.equal(state.commands, 0);
  assert.equal(listeners.size, 0);
});

test('denied Clipboard API falls back inside a modal and preserves original line endings', async (t) => {
  const { state, active, field, listeners } = browser(t, {
    modal: true,
    writeText: async () => {
      throw new Error('Denied API');
    },
  });
  await copyScriptCode(source);
  assert.notEqual(
    field.value,
    source,
    'The textarea mock reproduces browser newline normalization.',
  );
  assert.equal(state.text, source);
  assert.equal(state.mimeType, 'text/plain');
  assert.equal(state.prevented, true);
  assert.equal(state.commands, 1);
  assert.equal(state.parent, null);
  assert.equal(state.active, active);
  assert.equal(listeners.size, 0);
});

test('fallback works without the Clipboard API outside a dialog', async (t) => {
  const { state, active, listeners } = browser(t);
  await copyScriptCode(source);
  assert.equal(state.text, source);
  assert.equal(state.active, active);
  assert.equal(state.parent, null);
  assert.equal(listeners.size, 0);
});

test('fallback rejects false success and always removes listeners and restores focus', async (t) => {
  for (const options of [
    { commandResult: false },
    { dispatchCopy: false },
    { clipboardData: false },
    { setDataThrows: true },
    { commandThrows: true },
  ]) {
    await t.test(JSON.stringify(options), async (child) => {
      const { state, active, listeners } = browser(child, options);
      await assert.rejects(copyScriptCode(source));
      assert.equal(state.parent, null);
      assert.equal(state.active, active);
      assert.equal(listeners.size, 0);
    });
  }
});

test('blank code is rejected without changing the clipboard or focus', async (t) => {
  const { state, active, listeners } = browser(t);
  await assert.rejects(copyScriptCode(' \t\r\n'), /no code/i);
  assert.equal(state.commands, 0);
  assert.equal(state.active, active);
  assert.equal(listeners.size, 0);
});
