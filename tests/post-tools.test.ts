import assert from 'node:assert/strict';
import test from 'node:test';
import {
  averageViewersPerDay,
  filterPostsByProduct,
  sortPosts,
  type PostSort,
} from '../src/lib/post-tools';
import { effectiveProductCompanyIds } from '../src/lib/product-company';
import type { Post, Product } from '../src/lib/types';

function post(overrides: Partial<Post> & { id: string }): Post {
  return {
    companyId: 'vetra',
    groupId: 'coffee-community',
    title: 'A thoughtful morning',
    content: 'Something worth sharing.\nเรื่องราวดี ๆ ที่อยากส่งต่อ',
    product: 'Coffee Blossom Honey',
    platform: 'facebook',
    status: 'draft',
    scheduledAt: '',
    publishedAt: '',
    facebookPostId: '',
    url: '',
    viewers: null,
    color: '#263b4b',
    ...overrides,
  };
}

const ids = (posts: Post[]) => posts.map((item) => item.id);

test('daily Viewers average handles known, recent, unknown, and future publication dates', () => {
  const now = new Date('2026-10-17T12:00:00Z');
  assert.equal(
    averageViewersPerDay(
      post({ id: 'two-days', viewers: 25, publishedAt: '2026-10-15T12:00:00Z' }),
      now,
    ),
    12.5,
  );
  assert.equal(
    averageViewersPerDay(
      post({ id: 'today', viewers: 12, publishedAt: '2026-10-17T06:00:00Z' }),
      now,
    ),
    12,
  );
  assert.equal(
    averageViewersPerDay(
      post({ id: 'zero', viewers: 0, publishedAt: '2026-10-15T12:00:00Z' }),
      now,
    ),
    0,
  );
  assert.equal(averageViewersPerDay(post({ id: 'unknown', viewers: 10 }), now), null);
  assert.equal(
    averageViewersPerDay(post({ id: 'no-total', publishedAt: '2026-10-15T12:00:00Z' }), now),
    null,
  );
  assert.equal(
    averageViewersPerDay(
      post({ id: 'future', viewers: 10, publishedAt: '2026-10-18T12:00:00Z' }),
      now,
    ),
    null,
  );
});

test('product filter uses IDs and includes unambiguous legacy name-only posts', () => {
  const honey: Product = {
    id: 'honey',
    name: 'น้ำผึ้งดอกกาแฟ',
    imageUrl: '',
    sortOrder: 0,
  };
  const tea: Product = { ...honey, id: 'tea', name: 'Tea', sortOrder: 1 };
  const posts = [
    post({ id: 'linked', productId: 'honey', product: 'Old name' }),
    post({ id: 'legacy', product: 'น้ำผึ้งดอกกาแฟ' }),
    post({ id: 'other', productId: 'tea', product: 'Tea' }),
  ];
  assert.deepEqual(ids(filterPostsByProduct(posts, [honey, tea], 'honey')), ['linked', 'legacy']);
  assert.deepEqual(ids(filterPostsByProduct(posts, [honey, tea], 'all')), ids(posts));
  assert.deepEqual(ids(filterPostsByProduct(posts, [honey, tea], 'missing')), []);
  assert.deepEqual(
    ids(
      filterPostsByProduct(
        posts,
        [honey, { ...honey, id: 'duplicate', companyIds: ['vetra'] }, tea],
        'honey',
      ),
    ),
    ['linked'],
  );
});

test('legacy product companies come from explicit links, including posts in Trash', () => {
  const product: Product = { id: 'honey', name: 'Honey', imageUrl: '', sortOrder: 0 };
  const posts = [
    post({ id: 'active', companyId: 'vetra', productId: 'honey' }),
    post({
      id: 'trashed',
      companyId: 'olive',
      productId: 'honey',
      deletedAt: '2026-10-01T00:00:00Z',
    }),
    post({ id: 'same-name', companyId: 'kin', product: 'Honey' }),
  ];
  assert.deepEqual(effectiveProductCompanyIds(product, posts), ['vetra', 'olive']);
  assert.deepEqual(effectiveProductCompanyIds({ ...product, companyIds: ['kin'] }, posts), ['kin']);
});

test('name-only product fallback is scoped to each company and keeps explicit links', () => {
  const honey: Product = {
    id: 'honey-vetra',
    name: 'Honey',
    imageUrl: '',
    companyIds: ['vetra'],
    sortOrder: 0,
  };
  const oliveHoney: Product = { ...honey, id: 'honey-olive', companyIds: ['olive'] };
  const posts = [
    post({ id: 'vetra-name', companyId: 'vetra', product: 'Honey' }),
    post({ id: 'olive-name', companyId: 'olive', product: 'Honey' }),
    post({ id: 'kin-name', companyId: 'kin', product: 'Honey' }),
    post({ id: 'old-explicit-link', companyId: 'olive', product: 'Old name', productId: honey.id }),
  ];
  assert.deepEqual(ids(filterPostsByProduct(posts, [honey, oliveHoney], honey.id)), [
    'vetra-name',
    'old-explicit-link',
  ]);
  assert.deepEqual(ids(filterPostsByProduct(posts, [honey, oliveHoney], oliveHoney.id)), [
    'olive-name',
  ]);
  assert.deepEqual(
    ids(filterPostsByProduct(posts, [honey, { ...honey, id: 'same-store' }], honey.id)),
    ['old-explicit-link'],
  );
});

test('recent sorting uses actual publication dates, with unpublished records last', () => {
  const items = [
    post({ id: 'draft-first' }),
    post({
      id: 'old-published',
      status: 'published',
      publishedAt: '2026-10-12T03:00:00Z',
      scheduledAt: '2026-10-20T03:00:00Z',
    }),
    post({ id: 'draft-second' }),
    post({ id: 'next-planned', status: 'planned', scheduledAt: '2026-10-18T03:00:00Z' }),
    post({ id: 'new-published', status: 'published', publishedAt: '2026-10-16T03:00:00Z' }),
  ];
  assert.deepEqual(ids(sortPosts(items, 'recent', 'en')), [
    'new-published',
    'old-published',
    'draft-first',
    'draft-second',
    'next-planned',
  ]);
});

test('scheduled dates never influence publication date sorting', () => {
  const items = [
    post({
      id: 'replanned-later',
      status: 'planned',
      publishedAt: '2026-10-01T03:00:00Z',
      scheduledAt: '2026-10-20T03:00:00Z',
    }),
    post({ id: 'planned-earlier', status: 'planned', scheduledAt: '2026-10-10T03:00:00Z' }),
    post({
      id: 'published',
      status: 'published',
      publishedAt: '2026-10-15T03:00:00Z',
      scheduledAt: '2026-10-31T03:00:00Z',
    }),
    post({ id: 'undated-draft', publishedAt: '2026-10-25T03:00:00Z' }),
  ];
  assert.deepEqual(ids(sortPosts(items, 'recent', 'en')), [
    'undated-draft',
    'published',
    'replanned-later',
    'planned-earlier',
  ]);
  assert.deepEqual(ids(sortPosts(items, 'date-asc', 'en')), [
    'replanned-later',
    'published',
    'undated-draft',
    'planned-earlier',
  ]);
});

test('ascending dates keep missing or invalid dates last rather than at the beginning', () => {
  const items = [
    post({ id: 'undated' }),
    post({ id: 'later', status: 'published', publishedAt: '2026-10-17T03:00:00Z' }),
    post({ id: 'invalid', status: 'published', publishedAt: 'not-a-date' }),
    post({ id: 'earlier', status: 'published', publishedAt: '2026-10-15T03:00:00Z' }),
  ];
  assert.deepEqual(ids(sortPosts(items, 'date-asc', 'en')), [
    'earlier',
    'later',
    'undated',
    'invalid',
  ]);
});

test('Viewers sorting separates a known zero from an unknown total', () => {
  const items = [
    post({ id: 'unknown' }),
    post({ id: 'zero', viewers: 0 }),
    post({ id: 'higher', viewers: 100 }),
  ];
  assert.deepEqual(ids(sortPosts(items, 'viewers', 'en')), ['higher', 'zero', 'unknown']);
});

test('Comments sorting keeps pins first, then known counts descending and unknown counts last', () => {
  const items = [
    post({ id: 'unknown' }),
    post({ id: 'zero', commentCount: 0 }),
    post({ id: 'ten-first', commentCount: 10 }),
    post({ id: 'pinned-zero', pinned: true, commentCount: 0 }),
    post({ id: 'ten-second', commentCount: 10 }),
    post({ id: 'explicit-unknown', commentCount: null }),
  ];
  const original = structuredClone(items);
  assert.deepEqual(ids(sortPosts(items, 'comments', 'en')), [
    'pinned-zero',
    'ten-first',
    'ten-second',
    'zero',
    'unknown',
    'explicit-unknown',
  ]);
  assert.deepEqual(items, original);
});

test('Viewers per day sorting uses the displayed daily average, with pins first and unknown rates last', () => {
  const now = new Date('2026-10-17T12:00:00Z');
  const items = [
    post({ id: 'unknown-date', viewers: 1000 }),
    post({ id: 'older-total', viewers: 240, publishedAt: '2026-10-13T12:00:00Z' }),
    post({ id: 'zero', viewers: 0, publishedAt: '2026-10-16T12:00:00Z' }),
    post({ id: 'newer-rate', viewers: 80, publishedAt: '2026-10-16T12:00:00Z' }),
    post({
      id: 'pinned-low-rate',
      pinned: true,
      viewers: 2,
      publishedAt: '2026-10-15T12:00:00Z',
    }),
    post({ id: 'no-total', publishedAt: '2026-10-16T12:00:00Z' }),
    post({ id: 'future', viewers: 1000, publishedAt: '2026-10-18T12:00:00Z' }),
  ];
  const original = structuredClone(items);
  assert.deepEqual(ids(sortPosts(items, 'viewers-per-day', 'en', undefined, now)), [
    'pinned-low-rate',
    'newer-rate',
    'older-total',
    'zero',
    'unknown-date',
    'no-total',
    'future',
  ]);
  assert.deepEqual(items, original);
});

test('title sorting respects Thai collation and numeric title order', () => {
  assert.deepEqual(
    ids(
      sortPosts(
        [
          post({ id: 'ten', product: 'Post 10' }),
          post({ id: 'two', product: 'Post 2' }),
          post({ id: 'one', product: 'Post 1' }),
        ],
        'title',
        'en',
      ),
    ),
    ['one', 'two', 'ten'],
  );
  assert.deepEqual(
    ids(
      sortPosts(
        [post({ id: 'kho', product: 'ข้าว' }), post({ id: 'ko', product: 'กาแฟ' })],
        'title',
        'th',
      ),
    ),
    ['ko', 'kho'],
  );
});

test('all sorts are stable and do not mutate source arrays, records, or totals', () => {
  const items = [
    post({
      id: 'first',
      title: 'A post',
      status: 'published',
      publishedAt: '2026-10-16',
      viewers: 0,
    }),
    post({
      id: 'second',
      title: 'a post',
      status: 'published',
      publishedAt: '2026-10-16',
      viewers: 0,
    }),
  ];
  const snapshot = structuredClone(items);
  for (const sort of [
    'recent',
    'date-asc',
    'viewers',
    'viewers-per-day',
    'comments',
    'title',
    'group',
    'company',
  ] as PostSort[]) {
    const result = sortPosts(items, sort, 'en');
    assert.notEqual(result, items);
    assert.deepEqual(ids(result), ['first', 'second']);
    assert.equal(result[0], items[0]);
    assert.deepEqual(items, snapshot);
  }
  assert.deepEqual(sortPosts([], 'recent', 'th'), []);
});

test('pinned posts lead every sort while each section follows the selected order', () => {
  const items = [
    post({
      id: 'unpin-high',
      product: 'Alpha',
      groupId: 'alpha',
      companyId: 'alpha',
      publishedAt: '2026-10-17T00:00:00Z',
      viewers: 900,
      commentCount: 90,
    }),
    post({
      id: 'pin-old',
      pinned: true,
      product: 'Zebra',
      groupId: 'zebra',
      companyId: 'zebra',
      publishedAt: '2026-10-13T00:00:00Z',
      viewers: 3,
      commentCount: 3,
    }),
    post({
      id: 'unpin-low',
      product: 'Zebra',
      groupId: 'zebra',
      companyId: 'zebra',
      publishedAt: '2026-10-12T00:00:00Z',
      viewers: 2,
      commentCount: 2,
    }),
    post({
      id: 'pin-new',
      pinned: true,
      product: 'Alpha',
      groupId: 'alpha',
      companyId: 'alpha',
      publishedAt: '2026-10-16T00:00:00Z',
      viewers: 12,
      commentCount: 12,
    }),
  ];
  const original = structuredClone(items);
  const catalog = {
    groups: [
      { id: 'alpha', name: 'Alpha' },
      { id: 'zebra', name: 'Zebra' },
    ],
    companies: [
      { id: 'alpha', name: 'Alpha' },
      { id: 'zebra', name: 'Zebra' },
    ],
  };

  for (const sort of [
    'recent',
    'viewers',
    'viewers-per-day',
    'comments',
    'title',
    'group',
    'company',
  ] as PostSort[])
    assert.deepEqual(
      ids(sortPosts(items, sort, 'en', catalog)),
      ['pin-new', 'pin-old', 'unpin-high', 'unpin-low'],
      sort,
    );
  assert.deepEqual(ids(sortPosts(items, 'date-asc', 'en', catalog)), [
    'pin-old',
    'pin-new',
    'unpin-low',
    'unpin-high',
  ]);
  assert.deepEqual(items, original);
});

test('ties remain stable separately within pinned and unpinned sections', () => {
  const items = [
    post({ id: 'unpin-first', product: 'Same', publishedAt: '2026-10-16', viewers: 10 }),
    post({
      id: 'pin-first',
      pinned: true,
      product: 'Same',
      publishedAt: '2026-10-16',
      viewers: 10,
    }),
    post({ id: 'unpin-second', product: 'Same', publishedAt: '2026-10-16', viewers: 10 }),
    post({
      id: 'pin-second',
      pinned: true,
      product: 'Same',
      publishedAt: '2026-10-16',
      viewers: 10,
    }),
  ];
  for (const sort of [
    'recent',
    'date-asc',
    'viewers',
    'viewers-per-day',
    'comments',
    'title',
    'group',
    'company',
  ] as PostSort[])
    assert.deepEqual(
      ids(sortPosts(items, sort, 'en')),
      ['pin-first', 'pin-second', 'unpin-first', 'unpin-second'],
      sort,
    );
});

test('name sorts use product, group and company names, placing missing names last', () => {
  const items = [
    post({ id: 'unknown', product: '', groupId: 'missing', companyId: 'missing' }),
    post({ id: 'second', product: 'Product 10', groupId: 'a', companyId: 'b' }),
    post({ id: 'first', product: 'Product 2', groupId: 'b', companyId: 'a' }),
  ];
  const catalog = {
    groups: [
      { id: 'a', name: 'ข้าว' },
      { id: 'b', name: 'กาแฟ' },
    ],
    companies: [
      { id: 'a', name: 'Company 10' },
      { id: 'b', name: 'Company 2' },
    ],
  };
  assert.deepEqual(ids(sortPosts(items, 'title', 'en', catalog)), ['first', 'second', 'unknown']);
  assert.deepEqual(ids(sortPosts(items, 'group', 'th', catalog)), ['first', 'second', 'unknown']);
  assert.deepEqual(ids(sortPosts(items, 'company', 'en', catalog)), ['second', 'first', 'unknown']);
});

test('ascending metrics keep pins first, zero before positive counts, and missing values last', () => {
  const now = new Date('2026-10-18T03:00:00Z');
  const publishedAt = '2026-10-16T03:00:00Z';
  const items = [
    post({ id: 'unknown' }),
    post({ id: 'positive', publishedAt, viewers: 10, commentCount: 10 }),
    post({ id: 'zero', publishedAt, viewers: 0, commentCount: 0 }),
    post({ id: 'pin', pinned: true }),
  ];
  for (const sort of ['viewers-asc', 'viewers-per-day-asc', 'comments-asc'] as const)
    assert.deepEqual(ids(sortPosts(items, sort, 'en', undefined, now)), [
      'pin',
      'zero',
      'positive',
      'unknown',
    ]);

  const pending = post({
    id: 'pending',
    publishedAt,
    publicationStatus: 'pending',
    viewers: 1000,
  });
  assert.equal(averageViewersPerDay(pending, now), null);
  assert.deepEqual(ids(sortPosts([pending, items[1]], 'viewers-per-day', 'en', undefined, now)), [
    'positive',
    'pending',
  ]);
});

test('reverse name sorts use the visible catalog and destination names', () => {
  const items = [
    post({ id: 'unknown', product: '', groupId: 'missing', companyId: 'missing' }),
    post({
      id: 'alpha',
      product: 'Zebra (old name)',
      productId: 'alpha',
      destinationId: 'alpha',
      companyId: 'alpha',
    }),
    post({
      id: 'zebra',
      product: 'Zebra',
      metaGroupName: 'Zebra',
      groupId: 'missing',
      companyId: 'zebra',
    }),
  ];
  const catalog = {
    companies: [
      { id: 'alpha', name: 'Alpha' },
      { id: 'zebra', name: 'Zebra' },
    ],
    groups: [],
    destinations: [{ id: 'alpha', name: 'Alpha' }],
    products: [{ id: 'alpha', name: 'Alpha' }],
  };
  for (const sort of ['title-desc', 'group-desc', 'company-desc'] as const)
    assert.deepEqual(ids(sortPosts(items, sort, 'en', catalog)), ['zebra', 'alpha', 'unknown']);
  assert.deepEqual(ids(sortPosts(items, 'title', 'en', catalog)), ['alpha', 'zebra', 'unknown']);
});
