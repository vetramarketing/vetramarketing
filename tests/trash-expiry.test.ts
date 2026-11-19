import assert from 'node:assert/strict';
import test from 'node:test';
import {
  canonicalPostUrl,
  createEmptyWorkspace,
  pruneTrash,
  validateWorkspace,
} from '../src/lib/data';

test('expiring a group unlinks posts that reference it only through destination ID', () => {
  const workspace = createEmptyWorkspace();
  const groupId = '878540877111439';
  const group = {
    id: 'group-one',
    companyId: workspace.companies[0].id,
    name: 'Community',
    facebookId: groupId,
    category: '',
    notes: '',
    deletedAt: '2026-09-01T00:00:00.000Z',
  };
  workspace.groups = [group];
  workspace.destinations = [
    {
      id: 'legacy-destination',
      companyId: group.companyId,
      platform: 'facebook',
      kind: 'group',
      externalId: groupId,
      name: group.name,
      groupId: group.id,
    },
  ];
  workspace.posts = [
    {
      id: 'post-one',
      companyId: group.companyId,
      groupId: '',
      destinationId: group.id,
      product: 'Honey',
      platform: 'facebook',
      publishedAt: '2026-08-01T00:00:00.000Z',
      facebookPostId: '1441014217530766',
      url: '',
      viewers: 12,
      pinned: true,
      color: '#aabbcc',
    },
  ];
  workspace.posts.push({
    ...workspace.posts[0],
    id: 'post-two',
    destinationId: 'legacy-destination',
    facebookPostId: '1555014217530766',
    viewers: 23,
  });

  const before = validateWorkspace(workspace);
  const after = pruneTrash(before, new Date('2026-10-17T00:00:00.000Z'));
  assert.equal(after.groups.length, 0);
  for (const post of after.posts) {
    assert.equal(post.groupId, '');
    assert.equal(post.destinationId, undefined);
    assert.equal(post.url, canonicalPostUrl(groupId, post.facebookPostId));
  }
  assert.equal(after.posts[0].viewers, 12);
  assert.equal(after.posts[1].viewers, 23);
  assert.equal(after.posts[0].pinned, true);
  assert.doesNotThrow(() => validateWorkspace(after));
  assert.equal(before.posts[0].destinationId, group.id);
  assert.equal(before.posts[1].destinationId, 'legacy-destination');
});
