import assert from 'node:assert/strict';
import test from 'node:test';
import { createEmptyWorkspace, validateWorkspace } from '../src/lib/data';
import {
  normalizeFacebookGroupPostInput,
  parseFacebookGroupPostLink,
} from '../src/lib/facebook-post-url';
import { resolvePostGroupSelection } from '../src/lib/post-group-selection';
import { PostConflictError, preparePostSave } from '../src/lib/post-save';
import {
  PostGroupSaveError,
  preparePostSaveWithGroup,
  type PostGroupSaveReason,
} from '../src/lib/post-save-with-group';
import type { Group, Post, Workspace } from '../src/lib/types';

function group(overrides: Partial<Group> = {}): Group {
  return {
    id: 'pending-group',
    companyId: 'vetra',
    name: 'Community',
    facebookId: '878540877111439',
    category: '',
    notes: '',
    ...overrides,
  };
}

function post(overrides: Partial<Post> = {}): Post {
  return {
    id: 'new-post',
    companyId: 'vetra',
    groupId: 'pending-group',
    title: '',
    content: '',
    product: 'Coffee Blossom Honey',
    platform: 'facebook',
    status: 'published',
    scheduledAt: '',
    publishedAt: '2026-10-15T03:00:00Z',
    facebookPostId: '1441014217530766',
    url: 'https://www.facebook.com/groups/878540877111439/posts/1441014217530766/',
    viewers: null,
    color: '#263b4b',
    ...overrides,
  };
}

function workspace(groups: Group[] = [], posts: Post[] = []): Workspace {
  return { ...createEmptyWorkspace(), groups, posts };
}

function groupConflict(reason: PostGroupSaveReason) {
  return (error: unknown) => {
    assert.ok(error instanceof PostGroupSaveError);
    assert.equal(error.code, 'POST_GROUP_SAVE');
    assert.equal(error.reason, reason);
    return true;
  };
}

test('without a pending group, the normal post save behavior is unchanged', () => {
  const latest = workspace();
  const candidate = post({ groupId: '' });
  assert.deepEqual(
    preparePostSaveWithGroup(latest, candidate, null, null),
    preparePostSave(latest, candidate, null),
  );
});

test('a new Facebook group and post are added together without mutating inputs', () => {
  const latest = workspace();
  const pending = group();
  const candidate = post();
  const inputs = structuredClone({ latest, pending, candidate });

  const saved = preparePostSaveWithGroup(latest, candidate, null, pending);

  assert.deepEqual(saved.groups, [pending]);
  assert.deepEqual(saved.posts, [candidate]);
  assert.notEqual(saved.groups[0], pending);
  assert.notEqual(saved.posts[0], candidate);
  assert.deepEqual({ latest, pending, candidate }, inputs);
});

test('an active matching group is reused, remapping the post to its latest ID', () => {
  const existing = group({ id: 'saved-group' });
  const latest = workspace([existing]);
  const pending = group();
  const candidate = post();
  const saved = preparePostSaveWithGroup(latest, candidate, null, pending);

  assert.equal(saved.groups, latest.groups);
  assert.equal(saved.posts[0].groupId, 'saved-group');
  assert.equal(candidate.groupId, 'pending-group');
});

test('groups for another store are not reused', () => {
  const latest = workspace([group({ id: 'other-store-group', companyId: 'another-store' })]);
  const saved = preparePostSaveWithGroup(latest, post(), null, group());

  assert.equal(saved.groups.length, 2);
  assert.equal(saved.posts[0].groupId, 'pending-group');
});

test('a matching group in Trash must be restored before adding a post', () => {
  const latest = workspace([group({ id: 'trashed-group', deletedAt: '2026-10-16T06:00:00Z' })]);
  const input = structuredClone(latest);

  assert.throws(
    () => preparePostSaveWithGroup(latest, post(), null, group()),
    groupConflict('group-in-trash'),
  );
  assert.deepEqual(latest, input);
});

test('invalid pending group links, companies, and IDs are rejected', () => {
  const invalid: [Post, Group][] = [
    [post({ groupId: 'different' }), group()],
    [post(), group({ companyId: 'other-store' })],
    [post(), group({ facebookId: 'not-numeric' })],
    [post(), group({ facebookId: '1'.repeat(41) })],
    [post(), group({ id: '' })],
    [post(), group({ deletedAt: '2026-10-16T06:00:00Z' })],
  ];
  for (const [candidate, pending] of invalid) {
    assert.throws(
      () => preparePostSaveWithGroup(workspace(), candidate, null, pending),
      groupConflict('invalid-group'),
    );
  }
});

test('a concurrent group ID collision never overwrites the existing group', () => {
  const latest = workspace([group({ facebookId: '222' })]);
  const input = structuredClone(latest);

  assert.throws(
    () => preparePostSaveWithGroup(latest, post(), null, group()),
    groupConflict('group-id-collision'),
  );
  assert.deepEqual(latest, input);
});

test('duplicate post checks still reject a save without committing the pending group', () => {
  const tracked = post({ id: 'tracked-post', groupId: '', facebookPostId: '' });
  const latest = workspace([], [tracked]);
  const input = structuredClone(latest);

  assert.throws(
    () => preparePostSaveWithGroup(latest, post(), null, group()),
    (error) => {
      assert.ok(error instanceof PostConflictError);
      assert.equal(error.reason, 'existing-post');
      return true;
    },
  );
  assert.deepEqual(latest, input);
});

test('concurrent edits remain protected while adding a new group', () => {
  const baseline = post({ groupId: '', facebookPostId: '', url: 'https://example.com/post/1' });
  const latest = workspace([], [{ ...baseline, product: 'Edited in another tab' }]);
  const input = structuredClone(latest);
  const edited = { ...baseline, groupId: 'pending-group' };

  assert.throws(
    () => preparePostSaveWithGroup(latest, edited, baseline, group()),
    (error) => {
      assert.ok(error instanceof PostConflictError);
      assert.equal(error.reason, 'changed');
      return true;
    },
  );
  assert.deepEqual(latest, input);
});

function namedGroup(overrides: Partial<Group> = {}): Group {
  return group({
    facebookId: '',
    notes: 'My notes\nhttps://www.facebook.com/groups/Community.Name/',
    ...overrides,
  });
}

function namedPost(overrides: Partial<Post> = {}): Post {
  return post({
    url: 'https://www.facebook.com/groups/community.name/posts/1441014217530766/',
    ...overrides,
  });
}

test('a named group saves atomically using its notes URL without inventing a numeric ID', () => {
  const latest = workspace();
  const pending = namedGroup();
  const candidate = namedPost();
  const original = structuredClone({ latest, pending, candidate });
  const saved = preparePostSaveWithGroup(latest, candidate, null, pending);
  assert.deepEqual(saved.groups, [pending]);
  assert.equal(saved.groups[0].facebookId, '');
  assert.equal(saved.posts[0].url, candidate.url);
  const validated = validateWorkspace(saved);
  assert.equal(validated.groups[0].facebookId, '');
  assert.equal(validated.posts[0].groupId, pending.id);
  assert.deepEqual({ latest, pending, candidate }, original);
});

test('named posts reuse a unique active notes alias and preserve numeric identity and all metadata', () => {
  for (const facebookId of ['', '878540877111439']) {
    const savedGroup = namedGroup({
      id: 'saved-group',
      facebookId,
      name: 'Preserve my name',
      category: 'Preserve my category',
      notes: 'Preserve my notes\nhttps://www.facebook.com/groups/COMMUNITY.NAME/',
    });
    const latest = workspace([savedGroup]);
    const original = structuredClone(latest);
    const saved = preparePostSaveWithGroup(
      latest,
      namedPost({ destinationId: 'pending-group' }),
      null,
      namedGroup(),
    );
    assert.equal(saved.groups, latest.groups);
    assert.equal(saved.groups[0], savedGroup);
    assert.equal(saved.posts[0].groupId, 'saved-group');
    assert.equal(saved.posts[0].destinationId, 'saved-group');
    assert.deepEqual(latest, original);
    assert.equal(validateWorkspace(saved).posts[0].groupId, 'saved-group');
  }
});

test('named-group saves reject missing or mismatched post links, IDs, platforms and notes aliases', () => {
  const invalid: [Post, Group][] = [
    [namedPost({ url: '' }), namedGroup()],
    [namedPost({ url: 'https://example.com/post/1' }), namedGroup()],
    [
      namedPost({ url: 'https://facebook.com/groups/different/posts/1441014217530766/' }),
      namedGroup(),
    ],
    [namedPost({ facebookPostId: '999' }), namedGroup()],
    [namedPost({ platform: 'instagram' }), namedGroup()],
    [namedPost(), namedGroup({ notes: '' })],
    [namedPost(), namedGroup({ notes: 'https://facebook.com.evil.test/groups/community.name/' })],
    [namedPost(), namedGroup({ facebookId: 'community.name' })],
    [post(), group({ notes: 'https://www.facebook.com/groups/222/' })],
  ];
  for (const [candidate, pending] of invalid) {
    assert.throws(
      () => preparePostSaveWithGroup(workspace(), candidate, null, pending),
      groupConflict('invalid-group'),
    );
  }
});

test('named groups in Trash remain protected and aliases from another company are not reused', () => {
  const trashed = namedGroup({ id: 'trashed', deletedAt: '2026-11-07T00:00:00Z' });
  const latest = workspace([trashed]);
  const original = structuredClone(latest);
  assert.throws(
    () => preparePostSaveWithGroup(latest, namedPost(), null, namedGroup()),
    groupConflict('group-in-trash'),
  );
  assert.deepEqual(latest, original);

  const foreign = namedGroup({ id: 'foreign', companyId: 'another-store' });
  const saved = preparePostSaveWithGroup(workspace([foreign]), namedPost(), null, namedGroup());
  assert.equal(saved.groups.length, 2);
  assert.equal(saved.groups[0], foreign);
  assert.equal(saved.posts[0].groupId, 'pending-group');
});

test('ambiguous aliases and conflicting numeric identities reject saves without changing data', () => {
  const conflictingGroups = [
    namedGroup({ id: 'first', facebookId: '111' }),
    namedGroup({ id: 'second', facebookId: '222' }),
  ];
  for (const groups of [conflictingGroups, [...conflictingGroups].reverse()]) {
    const latest = workspace(groups);
    const original = structuredClone(latest);
    assert.throws(
      () => preparePostSaveWithGroup(latest, namedPost(), null, namedGroup()),
      groupConflict('invalid-group'),
    );
    assert.deepEqual(latest, original);
  }
  assert.throws(
    () =>
      preparePostSaveWithGroup(
        workspace([namedGroup({ id: 'existing', facebookId: '222' })]),
        namedPost(),
        null,
        namedGroup({ facebookId: '111' }),
      ),
    groupConflict('invalid-group'),
  );
});

test('duplicate named posts still reject without committing a pending group', () => {
  const latest = workspace([], [namedPost({ id: 'tracked', groupId: '', facebookPostId: '' })]);
  const original = structuredClone(latest);
  assert.throws(
    () => preparePostSaveWithGroup(latest, namedPost(), null, namedGroup()),
    (error) => {
      assert.ok(error instanceof PostConflictError);
      assert.equal(error.reason, 'existing-post');
      return true;
    },
  );
  assert.deepEqual(latest, original);
});

test('the supplied HTTP link saves with its extracted post ID and handle, then blocks duplicate saves', () => {
  const input = 'http://facebook.com/groups/designer.freelance/posts/2192701704986425/';
  const url = normalizeFacebookGroupPostInput(input);
  const ids = parseFacebookGroupPostLink(url);
  assert.ok(ids);
  const latest = workspace();
  const pending = resolvePostGroupSelection(
    latest.groups,
    'vetra',
    ids.groupId,
    null,
    () => 'handle-group',
  );
  assert.ok(pending);
  const candidate = post({
    groupId: pending.id,
    facebookPostId: ids.postId,
    url,
  });
  const original = structuredClone(latest);
  const saved = validateWorkspace(preparePostSaveWithGroup(latest, candidate, null, pending));
  assert.deepEqual(latest, original);
  assert.equal(saved.posts[0].facebookPostId, '2192701704986425');
  assert.equal(
    saved.posts[0].url,
    'https://facebook.com/groups/designer.freelance/posts/2192701704986425/',
  );
  assert.equal(saved.posts[0].groupId, pending.id);
  assert.equal(saved.groups[0].facebookId, '');
  assert.equal(saved.groups[0].notes, 'https://www.facebook.com/groups/designer.freelance/');

  for (const duplicateUrl of [
    normalizeFacebookGroupPostInput(input),
    'https://www.facebook.com/groups/Designer.Freelance/permalink/2192701704986425/?ref=share',
  ]) {
    const beforeDuplicate = structuredClone(saved);
    assert.throws(
      () =>
        preparePostSaveWithGroup(
          saved,
          { ...candidate, id: 'duplicate', url: duplicateUrl },
          null,
          pending,
        ),
      (error) => {
        assert.ok(error instanceof PostConflictError);
        assert.equal(error.reason, 'existing-post');
        return true;
      },
    );
    assert.deepEqual(saved, beforeDuplicate);
  }
});
