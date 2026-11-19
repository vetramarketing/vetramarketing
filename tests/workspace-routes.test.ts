import assert from 'node:assert/strict';
import test from 'node:test';
import {
  isWorkspaceView,
  viewFromPath,
  workspacePath,
  workspaceViews,
} from '../src/lib/workspace-routes';

test('every workspace section has a direct URL and can be restored from it', () => {
  for (const view of workspaceViews) {
    const path = workspacePath(view);
    assert.equal(viewFromPath(path), view);
    assert.equal(viewFromPath(path === '/' ? path : `${path}/`), view);
    assert.equal(isWorkspaceView(view), true);
  }
});

test('unrecognized and nested paths are not workspace sections', () => {
  assert.equal(viewFromPath('/missing'), null);
  assert.equal(viewFromPath('/posts/123'), null);
  assert.equal(isWorkspaceView('main'), false);
});

test('console script library has a direct route', () => {
  assert.equal(workspacePath('scripts'), '/scripts');
  assert.equal(viewFromPath('/scripts'), 'scripts');
  assert.equal(viewFromPath('/scripts/'), 'scripts');
  assert.equal(isWorkspaceView('scripts'), true);
});

test('company and customer routes are canonical while old store URLs remain compatible', () => {
  assert.equal(workspacePath('companies'), '/companies');
  assert.equal(workspacePath('customers'), '/customers');
  assert.equal(viewFromPath('/stores'), 'companies');
  assert.equal(viewFromPath('/stores/'), 'companies');
  assert.equal(isWorkspaceView('stores'), false);
});
