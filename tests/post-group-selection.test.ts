import assert from 'node:assert/strict';
import test from 'node:test';
import directory from '../src/lib/facebook-group-directory.json';
import {
  groupFacebookKey,
  groupMatchesFacebookKey,
  resolvePostGroupSelection,
} from '../src/lib/post-group-selection';
import type { Group } from '../src/lib/types';

function group(overrides: Partial<Group> = {}): Group {
  return {
    id: 'saved-group',
    companyId: 'vetra',
    name: 'My group name',
    facebookId: '',
    category: 'My category',
    notes: 'My notes\nhttps://www.facebook.com/groups/Community.Name/',
    ...overrides,
  };
}

test('group keys match numeric IDs and exact normalized notes aliases without empty matches', () => {
  const named = group();
  assert.equal(groupFacebookKey(named), 'community.name');
  assert.equal(groupMatchesFacebookKey(named, ' COMMUNITY.NAME '), true);
  assert.equal(groupMatchesFacebookKey(named, 'community'), false);
  assert.equal(groupMatchesFacebookKey(named, ''), false);
  assert.equal(groupMatchesFacebookKey(group({ notes: '' }), ''), false);
  assert.equal(
    groupMatchesFacebookKey(group({ notes: 'Community.Name' }), 'community.name'),
    false,
  );
  assert.equal(
    groupMatchesFacebookKey(
      group({ notes: 'https://facebook.com.evil.test/groups/community.name/' }),
      'community.name',
    ),
    false,
  );
  const numeric = group({ facebookId: '123456' });
  assert.equal(groupFacebookKey(numeric), '123456');
  assert.equal(groupMatchesFacebookKey(numeric, '123456'), true);
  assert.equal(groupMatchesFacebookKey(numeric, 'community.name'), true);
  assert.equal(
    groupMatchesFacebookKey(
      group({ facebookId: '111', notes: 'https://www.facebook.com/groups/222/' }),
      '222',
    ),
    false,
  );
});

test('selection reuses one active group in the selected company and preserves metadata', () => {
  const saved = group({ facebookId: '123456' });
  const groups = [
    group({ id: 'other-company', companyId: 'another-store' }),
    group({ id: 'in-trash', deletedAt: '2026-11-07T00:00:00Z' }),
    saved,
  ];
  const original = structuredClone(groups);
  const newId = () => {
    throw new Error('Existing groups must not allocate another ID.');
  };
  assert.equal(resolvePostGroupSelection(groups, 'vetra', 'COMMUNITY.NAME', null, newId), saved);
  assert.equal(resolvePostGroupSelection(groups, 'vetra', '123456', null, newId), saved);
  assert.deepEqual(groups, original);
});

test('ambiguous active aliases do not select an arbitrary group and numeric identity stays authoritative', () => {
  const groups = [
    group({ id: 'first', facebookId: '111' }),
    group({ id: 'second', facebookId: '222' }),
  ];
  assert.equal(resolvePostGroupSelection(groups, 'vetra', 'community.name'), null);
  assert.equal(resolvePostGroupSelection([...groups].reverse(), 'vetra', 'community.name'), null);
  const selected = resolvePostGroupSelection(
    [group({ facebookId: '111', notes: 'https://www.facebook.com/groups/222/' })],
    'vetra',
    '222',
    null,
    () => 'new-numeric',
  );
  assert.equal(selected?.id, 'new-numeric');
  assert.equal(selected?.facebookId, '222');
});

test('matching pending groups retain their ID and edits while new company or key selections do not', () => {
  const pending = group({ id: 'pending', name: 'Edited name', category: 'Edited category' });
  assert.equal(resolvePostGroupSelection([], 'vetra', 'community.name', pending), pending);
  for (const previous of [
    { ...pending, companyId: 'another-store' },
    { ...pending, deletedAt: '2026-11-07T00:00:00Z' },
    { ...pending, notes: 'https://www.facebook.com/groups/different/' },
  ]) {
    const selected = resolvePostGroupSelection(
      [],
      'vetra',
      'community.name',
      previous,
      () => 'new-id',
    );
    assert.equal(selected?.id, 'new-id');
    assert.equal(selected?.facebookId, '');
  }
});

test('new numeric groups keep numeric IDs while named groups keep only canonical notes URLs', () => {
  assert.deepEqual(
    resolvePostGroupSelection([], 'vetra', '98765432109876543210', null, () => 'numeric'),
    {
      id: 'numeric',
      companyId: 'vetra',
      name: 'Facebook group 98765432109876543210',
      facebookId: '98765432109876543210',
      category: '',
      notes: '',
    },
  );
  assert.deepEqual(
    resolvePostGroupSelection([], 'vetra', ' My.New-Community ', null, () => 'named'),
    {
      id: 'named',
      companyId: 'vetra',
      name: 'Facebook group my.new-community',
      facebookId: '',
      category: '',
      notes: 'https://www.facebook.com/groups/my.new-community/',
    },
  );
  const known = directory.handlesWithoutId[0];
  const selected = resolvePostGroupSelection([], 'vetra', known.handle, null, () => 'known');
  assert.equal(selected?.name, known.name);
  assert.equal(selected?.facebookId, '');
});

test('invalid keys or missing company do not create a pending group', () => {
  const newId = () => {
    throw new Error('Invalid input must not allocate an ID.');
  };
  for (const key of [
    '',
    'two words',
    'a/b',
    'https://facebook.com/groups/community/',
    '1'.repeat(41),
  ]) {
    assert.equal(resolvePostGroupSelection([], 'vetra', key, null, newId), null, key);
  }
  assert.equal(resolvePostGroupSelection([], '', 'community.name', null, newId), null);
});

test('a trashed group is not returned or changed when preparing a new selection', () => {
  const trashed = group({ deletedAt: '2026-11-07T00:00:00Z' });
  const original = structuredClone(trashed);
  const selected = resolvePostGroupSelection(
    [trashed],
    'vetra',
    'community.name',
    null,
    () => 'pending',
  );
  assert.equal(selected?.id, 'pending');
  assert.equal(selected?.deletedAt, undefined);
  assert.deepEqual(trashed, original);
});
