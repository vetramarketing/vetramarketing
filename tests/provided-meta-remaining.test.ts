import assert from 'node:assert/strict';
import test from 'node:test';
import { createEmptyWorkspace, validateWorkspace } from '../src/lib/data';
import {
  addProvidedMetaRemaining,
  PROVIDED_META_REMAINING_UPDATE,
} from '../src/lib/provided-meta-remaining';
import { addProvidedProducts, ESHAN_PRODUCT } from '../src/lib/provided-products';
import type { Post } from '../src/lib/types';

function trackedPost(overrides: Partial<Post> = {}): Post {
  return {
    id: 'tracked-row-31',
    companyId: 'vetra',
    groupId: 'group-31',
    product: ESHAN_PRODUCT.name,
    productId: ESHAN_PRODUCT.id,
    platform: 'facebook',
    publishedAt: '2026-10-17T09:49:00.000Z',
    facebookPostId: '4440010186272533',
    url: 'https://www.facebook.com/groups/2865273793746188/permalink/4440010186272533/',
    viewers: 21,
    color: '#263b4b',
    ...overrides,
  };
}

test('row 31 updates only its identified, unchanged post and row 85 becomes a linkless page record', () => {
  const source = addProvidedProducts(createEmptyWorkspace());
  source.groups.push({
    id: 'group-31',
    companyId: 'vetra',
    name: 'ฅนชงชา',
    facebookId: '2865273793746188',
    category: '',
    notes: '',
  });
  source.posts.push(
    trackedPost(),
    trackedPost({
      id: 'other-post-in-group',
      facebookPostId: '999',
      url: 'https://www.facebook.com/groups/2865273793746188/posts/999/',
      viewers: 21,
    }),
  );
  const result = validateWorkspace(addProvidedMetaRemaining(source));
  assert.equal(result.posts.find((post) => post.id === 'tracked-row-31')?.viewers, 34);
  assert.equal(result.posts.find((post) => post.id === 'other-post-in-group')?.viewers, 21);
  const page = result.posts.find((post) => post.metaSourceRow === 85);
  assert.equal(page?.publicationStatus, 'published');
  assert.equal(page?.viewers, 3);
  assert.equal(page?.publishedAt, '');
  assert.equal(page?.metaPublishedLabel, '18 ต.ค. เวลา 03:28');
  assert.equal(page?.url, '');
  assert.equal(page?.facebookPostId, '');
  assert.equal(page?.groupId, '');
  assert.equal(page?.productId, ESHAN_PRODUCT.id);
  assert.ok(result.appliedDataUpdates?.includes(PROVIDED_META_REMAINING_UPDATE));
});

test('manual totals, existing page rows, and later deletion are never overwritten', () => {
  const source = addProvidedProducts(createEmptyWorkspace());
  source.posts.push(trackedPost({ viewers: 50 }));
  const seeded = addProvidedMetaRemaining(source);
  assert.equal(seeded.posts[0].viewers, 50);
  const edited = {
    ...seeded,
    posts: seeded.posts.filter((post) => post.metaSourceRow !== 85),
  };
  assert.equal(addProvidedMetaRemaining(edited), edited);
  assert.equal(
    edited.posts.some((post) => post.metaSourceRow === 85),
    false,
  );

  const existingPage = addProvidedProducts(createEmptyWorkspace());
  existingPage.posts.push(trackedPost({ id: 'manual-page', metaSourceRow: 85 }));
  assert.equal(addProvidedMetaRemaining(existingPage).posts.length, 1);
});
