import assert from 'node:assert/strict';
import test from 'node:test';
import {
  matchesPostStatusFilter,
  postPublicationStatus,
  publicPostUrl,
} from '../src/lib/post-tools';

test('status choices show normal, pending, and linkless posts as labelled', () => {
  const posts = [
    {
      name: 'published link',
      publicationStatus: 'published' as const,
      publishedAt: '2026-10-17T03:00:00Z',
      hasLink: true,
    },
    {
      name: 'published no link',
      publicationStatus: 'published' as const,
      publishedAt: '2026-10-17T03:00:00Z',
      hasLink: false,
    },
    { name: 'pending link', publicationStatus: 'pending' as const, publishedAt: '', hasLink: true },
    {
      name: 'pending no link',
      publicationStatus: 'pending' as const,
      publishedAt: '',
      hasLink: false,
    },
    {
      name: 'undated link',
      publicationStatus: 'published' as const,
      publishedAt: '',
      hasLink: true,
    },
    { name: 'legacy undated', publishedAt: '', hasLink: true },
  ];
  const names = (filter: Parameters<typeof matchesPostStatusFilter>[2]) =>
    posts.filter((post) => matchesPostStatusFilter(post, post.hasLink, filter)).map((p) => p.name);

  assert.deepEqual(names('normal'), ['published link']);
  assert.deepEqual(names('pending'), [
    'pending link',
    'pending no link',
    'undated link',
    'legacy undated',
  ]);
  assert.deepEqual(names('no-link'), ['published no link', 'pending no link']);
  assert.deepEqual(
    names('all'),
    posts.map((post) => post.name),
  );
  assert.equal(postPublicationStatus(posts[4]), 'pending');
  assert.equal(postPublicationStatus(posts[5]), 'pending');
  assert.equal(postPublicationStatus(posts[0]), 'published');
});

test('a valid Facebook group and post ID count as a ready link', () => {
  assert.equal(
    publicPostUrl({ url: '', facebookPostId: '456' }, '123'),
    'https://www.facebook.com/groups/123/posts/456/',
  );
  assert.equal(publicPostUrl({ url: '', facebookPostId: '456' }, ''), '');
  assert.equal(
    publicPostUrl({ url: 'https://example.com/post', facebookPostId: '' }, ''),
    'https://example.com/post',
  );
});
