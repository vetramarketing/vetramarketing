import assert from 'node:assert/strict';
import test from 'node:test';
import {
  readPostListReturnState,
  withPostListReturnState,
  type PostListReturnState,
} from '../src/lib/post-list-navigation';

const list: PostListReturnState = {
  companyId: 'vetra',
  productId: 'eshan-honey',
  search: 'ขนม coffee',
  platform: 'facebook',
  statusFilter: 'normal',
  sort: 'viewers',
  scrollX: 0,
  scrollY: 1452.5,
  tableScrollLeft: 120,
};

test('both directions for every post column survive browser history restoration', () => {
  for (const sort of [
    'viewers',
    'viewers-asc',
    'viewers-per-day',
    'viewers-per-day-asc',
    'comments',
    'comments-asc',
    'recent',
    'date-asc',
    'title',
    'title-desc',
    'group',
    'group-desc',
    'company',
    'company-desc',
  ] as const) {
    const selected = { ...list, sort };
    assert.deepEqual(readPostListReturnState(withPostListReturnState(null, selected)), selected);
  }
});

test('return state retains every filter and both scroll positions without changing router history', () => {
  const router = { __NA: true, tree: ['posts'], unrelated: { value: 1 } };
  const before = structuredClone(router);
  const saved = withPostListReturnState(router, list);
  assert.deepEqual(readPostListReturnState(saved), list);
  assert.deepEqual(router, before);
  assert.equal(saved.tree, router.tree);
  assert.equal(saved.unrelated, router.unrelated);
  assert.equal(saved.__NA, true);
  assert.equal((saved.vetraPostList as { version: number }).version, 6);
  assert.equal('storeId' in (saved.vetraPostList as object), false);
});

test('a remembered company overrides stale history without losing other list filters', () => {
  const history = withPostListReturnState({ __NA: true }, list);
  const before = structuredClone(history);
  assert.deepEqual(readPostListReturnState(history, { companyId: 'another-company' }), {
    ...list,
    companyId: 'another-company',
    productId: 'all',
    scrollX: 0,
    scrollY: 0,
    tableScrollLeft: 0,
  });
  assert.deepEqual(history, before);
  // Reading for Back/Forward still restores the user's deliberate company selection.
  assert.deepEqual(readPostListReturnState(history), list);
});

test('the same remembered company retains its product and list position', () => {
  const all = { ...list, companyId: 'all', productId: 'all' };
  const history = withPostListReturnState(null, all);
  assert.deepEqual(readPostListReturnState(history, { companyId: 'all' }), all);
  const productOnly = withPostListReturnState(null, { ...all, productId: list.productId });
  assert.deepEqual(readPostListReturnState(productOnly, { companyId: 'all' }), {
    ...all,
    productId: list.productId,
  });
  assert.deepEqual(
    readPostListReturnState(withPostListReturnState(null, list), { companyId: list.companyId }),
    list,
  );
});

test('remembering All resets stale company-specific history on the next visit', () => {
  assert.deepEqual(
    readPostListReturnState(withPostListReturnState(null, list), { companyId: 'all' }),
    { ...list, companyId: 'all', productId: 'all', scrollX: 0, scrollY: 0, tableScrollLeft: 0 },
  );
});

test('history entries keep independent list positions and replace only their own prior snapshot', () => {
  const first = withPostListReturnState(null, list);
  const later = {
    ...list,
    search: '',
    companyId: 'all',
    productId: 'all',
    scrollY: 0,
    sort: 'recent' as const,
  };
  const second = withPostListReturnState(first, later);
  assert.deepEqual(readPostListReturnState(first), list);
  assert.deepEqual(readPostListReturnState(second), later);
});

test('older post-list history restores its status choice without losing filters', () => {
  const { companyId, productId: _productId, statusFilter: _statusFilter, ...filters } = list;
  const oldList = { ...filters, storeId: companyId };
  assert.deepEqual(readPostListReturnState({ vetraPostList: { version: 1, ...oldList } }), {
    ...list,
    productId: 'all',
    statusFilter: 'normal',
  });
  assert.deepEqual(
    readPostListReturnState({
      vetraPostList: { version: 2, ...oldList, productId: list.productId },
    }),
    list,
  );
  assert.deepEqual(
    readPostListReturnState({
      vetraPostList: { version: 3, ...oldList, productId: list.productId, pendingOnly: true },
    }),
    { ...list, statusFilter: 'pending' },
  );
  assert.deepEqual(
    readPostListReturnState({
      vetraPostList: { version: 4, ...oldList, productId: list.productId, showPending: true },
    }),
    { ...list, statusFilter: 'all' },
  );
});

test('legacy store selection and sorting normalize to the company contract', () => {
  const { companyId, ...filters } = list;
  for (const version of [1, 2, 3, 4, 5]) {
    const legacy = {
      version,
      ...filters,
      storeId: companyId,
      sort: 'store',
      pendingOnly: false,
      showPending: false,
    };
    assert.deepEqual(readPostListReturnState({ vetraPostList: legacy }), {
      ...list,
      productId: version === 1 ? 'all' : list.productId,
      sort: 'company',
    });
  }
  assert.equal(
    readPostListReturnState({ vetraPostList: { version: 6, ...filters, storeId: companyId } }),
    null,
  );
  assert.equal(
    readPostListReturnState({ vetraPostList: { version: 6, ...list, sort: 'store' } }),
    null,
  );
});

test('each status filter survives browser history restoration', () => {
  for (const statusFilter of ['normal', 'pending', 'no-link', 'all'] as const) {
    const selected = { ...list, statusFilter };
    assert.deepEqual(readPostListReturnState(withPostListReturnState(null, selected)), selected);
  }
});

test('unknown or malformed browser history is ignored without interrupting navigation', () => {
  for (const state of [null, [], 'old', { vetraPostList: null }, { vetraPostList: {} }])
    assert.equal(readPostListReturnState(state), null);
  for (const change of [
    { version: 7 },
    { platform: 'unknown' },
    { sort: 'growth' },
    { companyId: '' },
    { productId: '' },
    { productId: 17 },
    { statusFilter: 'hidden' },
    { search: null },
    { scrollY: -1 },
    { scrollX: Infinity },
    { tableScrollLeft: '120' },
  ]) {
    assert.equal(
      readPostListReturnState({ vetraPostList: { version: 6, ...list, ...change } }),
      null,
    );
  }
});
