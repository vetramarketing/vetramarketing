import assert from 'node:assert/strict';
import test from 'node:test';
import { createEmptyWorkspace, validateWorkspace } from '../src/lib/data';
import { facebookGroupKeyFromText, facebookGroupUrl } from '../src/lib/facebook-group-link';
import {
  addProvidedSoftwareGroups,
  ensureProvidedSoftwareGroups,
  providedSoftwareGroups,
  SOFTWARE_GROUPS_UPDATE,
} from '../src/lib/provided-software-groups';
import { LocalWorkspaceRepository } from '../src/lib/workspace-repository';
import {
  deserializeWorkspace,
  serializeWorkspace,
  WORKSPACE_KEY,
} from '../src/lib/workspace-storage';

function storage() {
  const values = new Map<string, string>();
  return {
    getItem: (key: string) => values.get(key) ?? null,
    setItem: (key: string, value: string) => {
      values.set(key, value);
    },
  };
}

function softwareWorkspace() {
  const workspace = createEmptyWorkspace();
  workspace.companies.push({
    ...workspace.companies[0],
    id: 'existing-software',
    name: 'VETRA Software',
    businessTypeId: 'software-house',
    sortOrder: 1,
    ownerName: 'Saved owner',
  });
  return workspace;
}

test('imports all 36 supplied names and links under the existing company, with no invented numeric IDs', () => {
  const original = softwareWorkspace();
  const before = structuredClone(original);
  const updated = validateWorkspace(addProvidedSoftwareGroups(original));
  assert.deepEqual(original, before);
  assert.deepEqual(updated.companies, before.companies);
  assert.deepEqual(updated.posts, before.posts);
  assert.equal(updated.groups.length, 36);
  assert.equal(new Set(providedSoftwareGroups.map((group) => group.key)).size, 36);
  assert.equal(updated.groups.filter((group) => group.facebookId).length, 24);
  for (const [index, supplied] of providedSoftwareGroups.entries()) {
    const group = updated.groups[index];
    assert.equal(group.companyId, 'existing-software');
    assert.equal(group.name, supplied.name);
    assert.equal(facebookGroupUrl(group), `https://www.facebook.com/groups/${supplied.key}/`);
    assert.equal(group.facebookId, /^\d+$/.test(supplied.key) ? supplied.key : '');
    assert.equal(
      updated.destinations?.find((item) => item.id === group.id)?.companyId,
      group.companyId,
    );
  }
});

test('creates only the requested company if absent and rejects ambiguous company names', () => {
  const original = createEmptyWorkspace();
  const updated = validateWorkspace(addProvidedSoftwareGroups(original));
  assert.equal(updated.companies.length, 2);
  assert.equal(updated.companies[1].name, 'VETRA Software');
  assert.equal(updated.companies[1].businessTypeId, 'software-house');
  assert.ok(updated.groups.every((group) => group.companyId === updated.companies[1].id));
  const ambiguous = softwareWorkspace();
  ambiguous.companies.push({
    ...ambiguous.companies[1],
    id: 'another-software',
    name: ' VETRA   SOFTWARE ',
  });
  assert.throws(() => addProvidedSoftwareGroups(ambiguous), /More than one company/);
});

test('deduplicates company-scoped IDs and named links, preserving custom names, numeric IDs, and Trash', () => {
  const original = softwareWorkspace();
  const [numeric, named] = providedSoftwareGroups;
  original.groups = [
    {
      id: 'custom',
      companyId: 'existing-software',
      name: 'Custom title',
      facebookId: numeric.key,
      category: 'Saved category',
      notes: 'Saved notes',
    },
    {
      id: 'named',
      companyId: 'existing-software',
      name: 'Custom named group',
      facebookId: '999',
      category: '',
      notes: `Group link: https://www.facebook.com/groups/${named.key.toUpperCase()}/`,
      deletedAt: new Date().toISOString(),
    },
    {
      id: 'other-company',
      companyId: 'vetra',
      name: numeric.name,
      facebookId: numeric.key,
      category: '',
      notes: '',
    },
  ];
  const updated = addProvidedSoftwareGroups(original);
  assert.equal(updated.groups.length, 37);
  assert.deepEqual(updated.groups.slice(0, 3), original.groups);
  assert.equal(
    updated.groups.filter((group) => group.companyId === 'existing-software').length,
    36,
  );
});

test('saved update survives backup reloads and respects later renaming and removal', async () => {
  const local = storage();
  local.setItem(WORKSPACE_KEY, JSON.stringify(serializeWorkspace(softwareWorkspace())));
  const repository = new LocalWorkspaceRepository(local, null);
  const saved = await ensureProvidedSoftwareGroups(repository, await repository.load());
  const restored = deserializeWorkspace(serializeWorkspace(saved.workspace));
  assert.ok(restored.appliedDataUpdates?.includes(SOFTWARE_GROUPS_UPDATE));
  restored.groups[0].name = 'Later rename';
  restored.groups.pop();
  restored.companies[1].name = 'Later company rename';
  assert.equal(addProvidedSoftwareGroups(restored), restored);
  assert.equal(
    (await ensureProvidedSoftwareGroups(repository, await repository.load())).revision,
    saved.revision,
  );
});

test('retries a stale revision without losing concurrent company or group edits', async () => {
  const local = storage();
  local.setItem(WORKSPACE_KEY, JSON.stringify(serializeWorkspace(softwareWorkspace())));
  const repository = new LocalWorkspaceRepository(local, null);
  const initial = await repository.load();
  const edited = structuredClone(initial.workspace);
  edited.companies[1].ownerName = 'Concurrent owner edit';
  edited.groups.push({
    id: 'concurrent-group',
    companyId: 'existing-software',
    name: 'Keep this custom name',
    facebookId: providedSoftwareGroups[0].key,
    category: '',
    notes: '',
  });
  await repository.commit({
    workspace: edited,
    expectedRevision: initial.revision,
    operationId: 'concurrent-edit',
  });
  const saved = await ensureProvidedSoftwareGroups(repository, initial);
  assert.equal(saved.workspace.companies[1].ownerName, 'Concurrent owner edit');
  assert.equal(saved.workspace.groups.length, 36);
  assert.equal(saved.workspace.groups[0].name, 'Keep this custom name');
  assert.deepEqual((await repository.load()).workspace, saved.workspace);
});

test('group links support supplied handles and reject unsafe or unrelated destinations', () => {
  assert.equal(
    facebookGroupKeyFromText('Notes https://www.facebook.com/groups/LogoDesign.Siam/'),
    'LogoDesign.Siam',
  );
  assert.equal(
    facebookGroupKeyFromText('https://facebook.com/groups/webdavelopar/posts/123/'),
    'webdavelopar',
  );
  for (const input of [
    'javascript:alert(1)',
    'https://facebook.com.evil.test/groups/123/',
    'https://www.facebook.com@evil.test/groups/123/',
    'http://www.facebook.com/groups/123/',
    'https://www.facebook.com/other/123/',
  ]) {
    assert.equal(facebookGroupUrl({ facebookId: '', notes: input }), '');
  }
  assert.equal(
    facebookGroupUrl({ facebookId: '123', notes: 'https://www.facebook.com/groups/other/' }),
    'https://www.facebook.com/groups/123/',
  );
});
