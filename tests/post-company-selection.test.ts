import assert from 'node:assert/strict';
import test from 'node:test';
import {
  POST_COMPANY_SELECTION_KEY,
  readPostCompanySelection,
  writePostCompanySelection,
} from '../src/lib/post-company-selection';

function storage(values = new Map<string, string>()) {
  return {
    values,
    getItem: (key: string) => values.get(key) ?? null,
    setItem: (key: string, value: string) => void values.set(key, value),
  };
}

test('first-time visits default to All without writing any data', () => {
  const browser = storage();
  assert.equal(readPostCompanySelection(browser), 'all');
  assert.equal(browser.values.size, 0);
});

test('a company selection persists across new storage clients and All replaces it', () => {
  const values = new Map([['workspace', 'preserved data']]);
  assert.equal(writePostCompanySelection(storage(values), 'vetra-software'), true);
  assert.equal(readPostCompanySelection(storage(values)), 'vetra-software');
  assert.equal(writePostCompanySelection(storage(values), 'all'), true);
  assert.equal(readPostCompanySelection(storage(values)), 'all');
  assert.equal(values.get('workspace'), 'preserved data');
  assert.equal(values.size, 2);
});

test('malformed saved preferences fall back to All and are left intact', () => {
  for (const value of ['', '   ', 'x'.repeat(101)]) {
    const browser = storage(new Map([[POST_COMPANY_SELECTION_KEY, value]]));
    assert.equal(readPostCompanySelection(browser), 'all');
    assert.equal(browser.values.get(POST_COMPANY_SELECTION_KEY), value);
  }
});

test('invalid selections cannot overwrite the previous preference', () => {
  const browser = storage(new Map([[POST_COMPANY_SELECTION_KEY, 'vetra']]));
  for (const value of ['', '   ', 'x'.repeat(101)]) {
    assert.equal(writePostCompanySelection(browser, value), false);
  }
  assert.equal(readPostCompanySelection(browser), 'vetra');
});

test('unavailable storage does not crash reading or claim to have saved a choice', () => {
  const unavailable = {
    getItem() {
      throw new Error('Storage blocked');
    },
    setItem() {
      throw new Error('Storage full');
    },
  };
  assert.equal(readPostCompanySelection(unavailable), 'all');
  assert.equal(writePostCompanySelection(unavailable, 'vetra'), false);
});
