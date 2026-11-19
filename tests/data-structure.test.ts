import assert from 'node:assert/strict';
import test from 'node:test';
import { createEmptyWorkspace, pruneTrash, validateWorkspace } from '../src/lib/data';
import { exportPostsCsv, previewPostsCsv } from '../src/lib/csv';
import { newDuplicatePair } from '../src/lib/post-identity';
import { normalizedPostUrl } from '../src/lib/post-identity';
import { preparePostSave } from '../src/lib/post-save';
import { POST_INDEXES, preparePostDocuments } from '../src/lib/mongodb-posts';
import { addProvidedPostLinks, providedPostLinks } from '../src/lib/provided-post-links';
import { addProvidedMissingPosts, providedMissingPosts } from '../src/lib/provided-missing-posts';
import {
  addProvidedProducts,
  assignCurrentPostsToEshan,
  ESHAN_PRODUCT,
} from '../src/lib/provided-products';
import {
  LocalWorkspaceRepository,
  WorkspaceIdentityConflict,
} from '../src/lib/workspace-repository';
import {
  deserializeWorkspace,
  serializeWorkspace,
  V6_WORKSPACE_KEY,
  WORKSPACE_KEY,
} from '../src/lib/workspace-storage';
import type { Post, Workspace } from '../src/lib/types';

function base(): Workspace {
  const workspace = createEmptyWorkspace();
  workspace.groups.push({
    id: 'g1',
    companyId: 'vetra',
    name: 'Community',
    facebookId: '878540877111439',
    category: '',
    notes: '',
  });
  return workspace;
}

function post(id: string, url: string, extra: Partial<Post> = {}): Post {
  return {
    id,
    companyId: 'vetra',
    groupId: 'g1',
    title: 'Old title',
    content: '',
    product: ESHAN_PRODUCT.name,
    platform: 'facebook',
    status: 'published',
    scheduledAt: '',
    publishedAt: '',
    facebookPostId: '1441014217530766',
    url,
    viewers: null,
    color: '#263b4b',
    ...extra,
  };
}

test('v6 migration links a unique product ID, preserves snapshots, and retains its recovery bytes', async () => {
  const workspace = base();
  workspace.products.push({ ...ESHAN_PRODUCT, id: 'user-product' });
  workspace.posts.push(
    post('a', 'https://www.facebook.com/groups/878540877111439/posts/1441014217530766/'),
  );
  const v6 = { ...serializeWorkspace(workspace), version: 6, destinations: undefined };
  const original = JSON.stringify(v6);
  const values = new Map([[V6_WORKSPACE_KEY, original]]);
  const repository = new LocalWorkspaceRepository({
    getItem: (key) => values.get(key) ?? null,
    setItem: (key, value) => {
      values.set(key, value);
    },
  });
  const loaded = await repository.load();
  assert.equal(loaded.workspace.posts[0].productId, 'user-product');
  assert.equal(loaded.workspace.posts[0].product, ESHAN_PRODUCT.name);
  assert.equal(loaded.workspace.posts[0].destinationId, 'g1');
  assert.equal(values.get(V6_WORKSPACE_KEY), original);
  assert.equal(JSON.parse(values.get(WORKSPACE_KEY)!).version, 12);

  const ambiguous = structuredClone(v6);
  ambiguous.products.push({ ...ESHAN_PRODUCT, id: 'second-product' });
  assert.equal(deserializeWorkspace(ambiguous).posts[0].productId, undefined);
});

test('supplied product assignment uses the existing catalog ID and expiry preserves the name', () => {
  const workspace = base();
  workspace.products.push({ ...ESHAN_PRODUCT, id: 'user-product' });
  workspace.posts.push(post('a', 'https://example.com/post'));
  const assigned = assignCurrentPostsToEshan(addProvidedProducts(workspace));
  assert.equal(assigned.posts[0].productId, 'user-product');
  assigned.products[0].deletedAt = '2026-09-01T00:00:00Z';
  const pruned = pruneTrash(assigned, new Date('2026-10-17T00:00:00Z'));
  assert.equal(pruned.posts[0].productId, undefined);
  assert.equal(pruned.posts[0].product, ESHAN_PRODUCT.name);
  assert.doesNotThrow(() => serializeWorkspace(pruned));
});

test('known page and account URLs get stable destinations; ambiguous URLs do not invent one', () => {
  const workspace = base();
  workspace.posts = [
    post('page', 'https://www.facebook.com/VetraCompany/posts/123456789/', {
      groupId: '',
      facebookPostId: '123456789',
    }),
    post('page-copy', 'https://m.facebook.com/VetraCompany/posts/987654321/?fbclid=abc', {
      groupId: '',
      facebookPostId: '987654321',
    }),
    post('share', 'https://www.facebook.com/share/p/opaque/', { groupId: '', facebookPostId: '' }),
    post('tiktok', 'https://www.tiktok.com/@vetra.shop/video/123456789', {
      groupId: '',
      platform: 'tiktok',
      facebookPostId: '',
    }),
  ];
  const valid = validateWorkspace(workspace);
  assert.equal(valid.posts[0].destinationId, valid.posts[1].destinationId);
  assert.equal(
    valid.destinations?.find((item) => item.id === valid.posts[0].destinationId)?.name,
    'VetraCompany',
  );
  assert.equal(valid.posts[2].destinationId, undefined);
  assert.equal(
    valid.destinations?.find((item) => item.id === valid.posts[3].destinationId)?.name,
    '@vetra.shop',
  );
  assert.deepEqual(
    deserializeWorkspace(serializeWorkspace(valid)).destinations,
    valid.destinations,
  );
});

test('repository allows replacing a trashed post, blocks restoring the duplicate, and preserves legacy active pairs', async () => {
  const values = new Map<string, string>();
  const repository = new LocalWorkspaceRepository({
    getItem: (key) => values.get(key) ?? null,
    setItem: (key, value) => {
      values.set(key, value);
    },
  });
  const initial = await repository.load();
  const workspace = base();
  workspace.posts.push(
    post('original', 'https://www.facebook.com/groups/878540877111439/posts/1441014217530766/'),
  );
  const first = await repository.commit({
    workspace,
    expectedRevision: initial.revision,
    operationId: 'first',
  });
  const withDuplicate = structuredClone(first.workspace);
  withDuplicate.posts.push(
    post(
      'duplicate',
      'https://www.facebook.com/groups/878540877111439/permalink/1441014217530766/?fbclid=1',
    ),
  );
  await assert.rejects(
    repository.commit({
      workspace: withDuplicate,
      expectedRevision: first.revision,
      operationId: 'duplicate',
    }),
    WorkspaceIdentityConflict,
  );
  assert.equal((await repository.load()).workspace.posts.length, 1);

  const trash = structuredClone(first.workspace);
  trash.posts[0].deletedAt = new Date().toISOString();
  const trashed = await repository.commit({
    workspace: trash,
    expectedRevision: first.revision,
    operationId: 'trash-wrong-assignment',
  });
  const corrected = preparePostSave(
    {
      ...trashed.workspace,
      companies: [
        ...trashed.workspace.companies,
        { ...trashed.workspace.companies[0], id: 'software' },
      ],
      groups: [
        ...trashed.workspace.groups,
        { ...trashed.workspace.groups[0], id: 'g2', companyId: 'software' },
      ],
    },
    { ...withDuplicate.posts[1], companyId: 'software', groupId: 'g2', product: 'Website design' },
    null,
  );
  const replacement = await repository.commit({
    workspace: corrected,
    expectedRevision: trashed.revision,
    operationId: 'save-corrected-post',
  });
  assert.equal(replacement.workspace.posts[0].companyId, 'software');
  assert.equal(replacement.workspace.posts[0].product, 'Website design');
  assert.deepEqual(replacement.workspace.posts[1], trashed.workspace.posts[0]);
  const restoredDuplicate = structuredClone(replacement.workspace);
  delete restoredDuplicate.posts[1].deletedAt;
  await assert.rejects(
    repository.commit({
      workspace: restoredDuplicate,
      expectedRevision: replacement.revision,
      operationId: 'restore-duplicate',
    }),
    WorkspaceIdentityConflict,
  );
  assert.equal((await repository.load()).revision, replacement.revision);

  const legacy = withDuplicate;
  assert.deepEqual(newDuplicatePair(first.workspace, legacy), ['duplicate', 'original']);
  const restored = await repository.recover(legacy);
  assert.equal(restored.workspace.posts.length, 2);
  const edited = structuredClone(restored.workspace);
  edited.posts[1].viewers = 42;
  const saved = await repository.commit({
    workspace: edited,
    expectedRevision: restored.revision,
    operationId: 'legacy-edit',
  });
  assert.equal(saved.workspace.posts[1].viewers, 42);
});

test('MongoDB preparation keeps stable references, Trash, and normalized external identities', () => {
  const workspace = base();
  workspace.products.push(ESHAN_PRODUCT);
  workspace.posts.push(
    post(
      'a',
      'https://www.facebook.com/groups/878540877111439/permalink/1441014217530766/?fbclid=x',
      {
        productId: ESHAN_PRODUCT.id,
        destinationId: 'g1',
        pinned: true,
        commentCount: 7,
        deletedAt: '2026-10-17T00:00:00Z',
      },
    ),
  );
  const prepared = preparePostDocuments(workspace, 'team-one');
  assert.equal(prepared.destinations[0].id, 'g1');
  assert.equal(prepared.posts[0].productId, ESHAN_PRODUCT.id);
  assert.equal(prepared.posts[0].destinationId, 'g1');
  assert.equal(prepared.posts[0].workspaceId, 'team-one');
  assert.equal(prepared.posts[0].deletedAt, '2026-10-17T00:00:00Z');
  assert.equal(prepared.posts[0].pinned, true);
  assert.equal(prepared.posts[0].commentCount, 7);
  assert.ok(
    prepared.posts[0].identityKeys.includes(
      'url:https://www.facebook.com/groups/878540877111439/posts/1441014217530766/',
    ),
  );
  assert.ok(POST_INDEXES.posts.some((index) => index.name === 'post_external_identity'));
  assert.throws(() => preparePostDocuments(workspace, '../other-team'));
  assert.equal('title' in prepared.posts[0], false);
});

test('MongoDB preparation retains a pending Meta row with unknown post identity', () => {
  const workspace = base();
  workspace.posts.push(
    post('provided-meta-row-86', '', {
      status: undefined,
      facebookPostId: '',
      publishedAt: '',
      viewers: 1,
      publicationStatus: 'pending',
      metaSourceRow: 86,
      metaGroupName: 'ชาวลำลูกกา',
      metaGroupKey: '878540877111439',
    }),
  );
  const prepared = preparePostDocuments(workspace, 'team-one');
  assert.equal(prepared.posts[0].publicationStatus, 'pending');
  assert.equal(prepared.posts[0].metaSourceRow, 86);
  assert.equal(prepared.posts[0].metaGroupName, 'ชาวลำลูกกา');
  assert.equal(prepared.posts[0].metaGroupKey, '878540877111439');
  assert.deepEqual(prepared.posts[0].identityKeys, []);
});

test('MongoDB preparation projects a legacy undated linked post as pending', () => {
  const workspace = base();
  workspace.posts.push(
    post(
      'legacy-undated',
      'https://www.facebook.com/groups/878540877111439/posts/1441014217530766/',
      {
        status: undefined,
        publicationStatus: 'published',
      },
    ),
  );
  const prepared = preparePostDocuments(workspace, 'team-one');
  assert.equal(prepared.posts[0].publicationStatus, 'pending');
  assert.equal(workspace.posts[0].publicationStatus, 'published');
});

test('pin state survives active storage and backup restoration, including older unpinned records', () => {
  const workspace = base();
  workspace.posts = [
    post('pinned', 'https://www.facebook.com/groups/878540877111439/posts/111/', {
      facebookPostId: '111',
      pinned: true,
    }),
    post('older', 'https://www.facebook.com/groups/878540877111439/posts/222/', {
      facebookPostId: '222',
    }),
  ];
  const stored = serializeWorkspace(workspace);
  assert.deepEqual(
    stored.posts.map((item) => item.pinned),
    [true, false],
  );
  const restored = deserializeWorkspace(stored);
  assert.deepEqual(
    restored.posts.map((item) => item.pinned),
    [true, false],
  );
  assert.deepEqual(
    preparePostDocuments(restored, 'team-one').posts.map((item) => item.pinned),
    [true, false],
  );
});

test('group slug permalink variants share an identity without dropping meaningful query parameters elsewhere', () => {
  assert.equal(
    normalizedPostUrl('https://m.facebook.com/groups/halalclub/permalink/123/?fbclid=abc'),
    normalizedPostUrl('https://www.facebook.com/groups/halalclub/posts/123/'),
  );
  assert.notEqual(
    normalizedPostUrl('https://example.com/post?id=1'),
    normalizedPostUrl('https://example.com/post?id=2'),
  );
});

test('CSV round trip preserves product and page destination links in the same catalog', () => {
  const workspace = base();
  workspace.products.push(ESHAN_PRODUCT);
  workspace.posts.push(
    post('page', 'https://www.facebook.com/VetraCompany/posts/123456789/', {
      groupId: '',
      facebookPostId: '123456789',
      productId: ESHAN_PRODUCT.id,
    }),
  );
  const valid = validateWorkspace(workspace);
  const preview = previewPostsCsv(exportPostsCsv(valid), { ...valid, posts: [] }, 'vetra');
  assert.deepEqual(preview.errors, []);
  assert.equal(preview.posts[0].productId, ESHAN_PRODUCT.id);
  assert.equal(preview.posts[0].destinationId, valid.posts[0].destinationId);
});

test('one-time supplied imports skip older URL variants with no saved Facebook post ID', () => {
  const workspace = createEmptyWorkspace();
  const first = new URL(providedPostLinks[0]);
  const match = /^\/groups\/(\d+)\/permalink\/(\d+)\/$/.exec(first.pathname)!;
  workspace.groups.push({
    id: 'existing-group',
    companyId: 'vetra',
    name: 'Existing',
    facebookId: match[1],
    category: '',
    notes: '',
  });
  workspace.posts.push(
    post('existing', `https://www.facebook.com/groups/${match[1]}/?multi_permalinks=${match[2]}`, {
      groupId: 'existing-group',
      facebookPostId: '',
    }),
  );
  const seeded = addProvidedPostLinks(workspace);
  assert.equal(seeded.posts.filter((item) => item.facebookPostId === match[2]).length, 0);
  assert.equal(seeded.posts.length, providedPostLinks.length);

  const missing = providedMissingPosts[0];
  const withMissing = {
    ...createEmptyWorkspace(),
    groups: [
      {
        id: 'existing-group',
        companyId: 'vetra',
        name: 'Existing',
        facebookId: missing.groupId,
        category: '',
        notes: '',
      },
    ],
    posts: [
      post(
        'existing',
        `https://www.facebook.com/groups/${missing.groupId}/posts/${missing.postId}/`,
        {
          groupId: 'existing-group',
          facebookPostId: '',
        },
      ),
    ],
  };
  assert.equal(addProvidedMissingPosts(withMissing).posts.length, 2);
});
