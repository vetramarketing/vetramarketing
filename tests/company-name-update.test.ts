import assert from 'node:assert/strict';
import test from 'node:test';
import { createEmptyWorkspace } from '../src/lib/data';
import {
  ensureVetraCompanyName,
  renameVetraCompany,
  VETRA_STORE_NAME_UPDATE,
} from '../src/lib/company-name-update';
import { LocalWorkspaceRepository } from '../src/lib/workspace-repository';
import { serializeWorkspace, WORKSPACE_KEY } from '../src/lib/workspace-storage';

function storage() {
  const values = new Map<string, string>();
  return {
    getItem: (key: string) => values.get(key) ?? null,
    setItem: (key: string, value: string) => {
      values.set(key, value);
    },
  };
}

test('new workspaces use the requested VETRA STORE name', () => {
  assert.equal(createEmptyWorkspace().companies[0].name, 'VETRA STORE');
});

test('legacy store name is saved once without changing its other data', async () => {
  const legacy = createEmptyWorkspace();
  legacy.companies[0] = {
    ...legacy.companies[0],
    name: 'VETRA Store',
    ownerName: 'Owner',
  };
  const local = storage();
  local.setItem(WORKSPACE_KEY, JSON.stringify(serializeWorkspace(legacy)));
  const repository = new LocalWorkspaceRepository(local);
  const initial = await repository.load();
  const saved = await ensureVetraCompanyName(repository, initial);

  assert.equal(saved.workspace.companies[0].name, 'VETRA STORE');
  assert.equal(saved.workspace.companies[0].ownerName, 'Owner');
  assert.deepEqual(saved.workspace.products, initial.workspace.products);
  assert.deepEqual(saved.workspace.posts, initial.workspace.posts);
  assert.deepEqual(saved.workspace.appliedDataUpdates, [VETRA_STORE_NAME_UPDATE]);
  assert.equal(legacy.companies[0].name, 'VETRA Store');
  assert.equal((await repository.load()).workspace.companies[0].name, 'VETRA STORE');
  assert.equal(
    (await ensureVetraCompanyName(repository, await repository.load())).revision,
    saved.revision,
  );

  const laterEdit = {
    ...saved.workspace,
    companies: [{ ...saved.workspace.companies[0], name: 'My brand' }],
  };
  assert.equal(renameVetraCompany(laterEdit), laterEdit);
});

test('store rename retries a stale revision and preserves another tab’s edit', async () => {
  const legacy = createEmptyWorkspace();
  legacy.companies[0].name = 'VETRA Store';
  const local = storage();
  local.setItem(WORKSPACE_KEY, JSON.stringify(serializeWorkspace(legacy)));
  const repository = new LocalWorkspaceRepository(local);
  const stale = await repository.load();
  const edited = structuredClone(stale.workspace);
  edited.companies[0].ownerName = 'Updated elsewhere';
  await repository.commit({
    workspace: edited,
    expectedRevision: stale.revision,
    operationId: 'owner-edit',
  });

  const saved = await ensureVetraCompanyName(repository, stale);
  assert.equal(saved.workspace.companies[0].name, 'VETRA STORE');
  assert.equal(saved.workspace.companies[0].ownerName, 'Updated elsewhere');
});
