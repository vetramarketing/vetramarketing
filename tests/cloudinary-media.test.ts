import assert from 'node:assert/strict';
import test from 'node:test';
import { createEmptyWorkspace, pruneTrash, validateWorkspace } from '../src/lib/data';
import { entityEditIsCurrent } from '../src/lib/entity-edit';
import { prepareCatalogDocuments } from '../src/lib/mongodb-catalog';
import { LocalWorkspaceRepository } from '../src/lib/workspace-repository';
import {
  deserializeWorkspace,
  serializeWorkspace,
  PREVIOUS_WORKSPACE_KEY,
  WORKSPACE_KEY,
} from '../src/lib/workspace-storage';
import {
  cloudinaryImageUrl,
  retainCloudinaryImage,
  validateCloudinaryImage,
  type CloudinaryImage,
} from '../src/lib/cloudinary-media';
import {
  parseCloudinaryUploadMetadata,
  planCatalogImageUpload,
  validatePreparedCatalogFile,
  type CatalogMediaTarget,
} from '../src/lib/catalog-media-contract';

const config = { cloudName: 'vetra-test', folder: 'vetra-marketing' };
const target: CatalogMediaTarget = {
  collection: 'products',
  recordId: 'product-1',
  field: 'imageUrl',
};
const plan = planCatalogImageUpload(config, 'workspace-1', target, 'submission-1');
const asset: CloudinaryImage = {
  provider: 'cloudinary',
  cloudName: config.cloudName,
  assetId: 'immutable-asset-id',
  publicId: plan.publicId,
  version: 1792200000,
  format: 'webp',
  width: 1200,
  height: 800,
  bytes: 150000,
};
const url = cloudinaryImageUrl(asset);
const catalog = () => {
  const data = createEmptyWorkspace();
  data.products = [
    { id: 'product-1', name: 'สินค้า', imageUrl: url, imageAsset: { ...asset }, sortOrder: 0 },
  ];
  data.companies[0] = { ...data.companies[0], logoImageUrl: url, logoAsset: { ...asset } };
  return data;
};

test('v5 catalog migration preserves products, owners, image URLs, order, and its recovery copy', async () => {
  const source = catalog();
  delete source.products[0].imageAsset;
  delete source.companies[0].logoAsset;
  source.companies[0].ownerName = 'เจ้าของร้าน';
  source.products[0].sortOrder = 50;
  const backup = JSON.stringify({ ...serializeWorkspace(source), version: 5 });
  const records = new Map([[PREVIOUS_WORKSPACE_KEY, backup]]);
  const repository = new LocalWorkspaceRepository({
    getItem: (key) => records.get(key) ?? null,
    setItem: (key, value) => {
      records.set(key, value);
    },
  });
  assert.deepEqual((await repository.load()).workspace, source);
  assert.equal(records.get(PREVIOUS_WORKSPACE_KEY), backup);
  assert.equal(JSON.parse(records.get(WORKSPACE_KEY)!).version, 12);
});

test('Cloudinary metadata survives local save, reload, backups, and MongoDB preparation', async () => {
  const records = new Map<string, string>();
  const repository = new LocalWorkspaceRepository({
    getItem: (key) => records.get(key) ?? null,
    setItem: (key, value) => {
      records.set(key, value);
    },
  });
  const initial = await repository.load();
  const data = catalog();
  await repository.commit({
    workspace: data,
    expectedRevision: initial.revision,
    operationId: 'media-save',
  });
  assert.deepEqual((await repository.load()).workspace, data);
  assert.deepEqual(
    deserializeWorkspace(JSON.parse(JSON.stringify(serializeWorkspace(data)))),
    data,
  );
  const documents = prepareCatalogDocuments(data, 'workspace-1');
  assert.deepEqual(documents.products[0].imageAsset, asset);
  assert.deepEqual(documents.companies[0].logoAsset, asset);
  documents.products[0].imageAsset!.publicId = 'other';
  assert.equal(data.products[0].imageAsset!.publicId, asset.publicId);
});

test('existing URL-only records remain valid without invented ownership metadata', () => {
  const data = createEmptyWorkspace();
  data.products = [{ id: 'product-1', name: 'Product', imageUrl: url, sortOrder: 0 }];
  const result = deserializeWorkspace(serializeWorkspace(data));
  assert.deepEqual(result, data);
  assert.equal(result.products[0].imageAsset, undefined);
});

test('name edits retain asset details; changed or cleared URLs detach them without changing the original', () => {
  const preserved = retainCloudinaryImage(asset, url);
  assert.deepEqual(preserved, asset);
  assert.notEqual(preserved, asset);
  assert.equal(retainCloudinaryImage(asset, 'https://example.com/other.webp'), undefined);
  assert.equal(retainCloudinaryImage(asset, ''), undefined);
  assert.equal(retainCloudinaryImage(undefined, url), undefined);
  const data = catalog();
  data.products[0].name = 'New product';
  data.companies[0].ownerName = 'New owner';
  assert.deepEqual(validateWorkspace(data).products[0].imageAsset, asset);
  assert.deepEqual(validateWorkspace(data).companies[0].logoAsset, asset);
});

test('media validation rejects mismatched URLs and malformed provider metadata', () => {
  for (const change of [
    { provider: 'other' },
    { cloudName: '../other' },
    { publicId: '../elsewhere' },
    { publicId: 'folder//image' },
    { assetId: '' },
    { format: 'svg' },
    { version: -1 },
    { version: 1.2 },
    { width: 0 },
    { height: 4097 },
    { bytes: 5 * 1024 * 1024 + 1 },
  ])
    assert.throws(() => validateCloudinaryImage({ ...asset, ...change }, url), /Cloudinary/);
  for (const otherUrl of [
    url.replace('vetra-test', 'other-cloud'),
    url + '?changed=1',
    url.replace('/image/', '/video/'),
    url.replace('https:', 'http:'),
    '',
  ]) {
    assert.throws(() => validateCloudinaryImage(asset, otherUrl), /does not match/);
  }
  const data = catalog();
  data.companies[0].logoImageUrl = 'https://example.com/unrelated.png';
  assert.throws(() => serializeWorkspace(data), /does not match/);
});

test('temporary tokens, upload credentials, and response extras are excluded from persisted metadata', () => {
  const data = catalog();
  Object.assign(data.products[0], { uploadToken: 'temporary', apiSecret: 'must-not-persist' });
  Object.assign(data.products[0].imageAsset!, {
    uploadToken: 'temporary',
    apiSecret: 'must-not-persist',
    signature: 'signature',
  });
  const raw = JSON.stringify(serializeWorkspace(data));
  for (const field of ['uploadToken', 'apiSecret', 'signature', 'must-not-persist'])
    assert.equal(raw.includes(field), false);
});

test('nested asset metadata compares by value across reloads and blocks actual concurrent changes', () => {
  const data = catalog();
  const original = data.products[0];
  assert.equal(entityEditIsCurrent(original, structuredClone(original)), true);
  assert.equal(
    entityEditIsCurrent(original, { ...original, imageAsset: { ...asset, assetId: 'different' } }),
    false,
  );
  assert.equal(entityEditIsCurrent(original, { ...original, imageAsset: undefined }), false);
});

test('Trash retains Cloudinary metadata and pruning never modifies another record sharing the asset', () => {
  const data = catalog();
  data.products[0].deletedAt = '2026-10-01T00:00:00Z';
  const retained = pruneTrash(data, new Date('2026-10-15T00:00:00Z'));
  assert.deepEqual(retained.products[0].imageAsset, asset);
  assert.deepEqual(
    deserializeWorkspace(serializeWorkspace(retained)).products[0].imageAsset,
    asset,
  );
  const expired = pruneTrash(data, new Date('2026-11-01T00:00:00Z'));
  assert.equal(expired.products.length, 0);
  assert.deepEqual(expired.companies[0].logoAsset, asset);
  assert.equal(expired.companies[0].logoImageUrl, url);
});

test('upload plans isolate workspaces, targets, and submissions and never permit overwrite', () => {
  assert.equal(plan.overwrite, false);
  assert.equal(plan.publicId, 'vetra-marketing/workspace-1/products/product-1/submission-1');
  assert.deepEqual(planCatalogImageUpload(config, 'workspace-1', target, 'submission-1'), plan);
  assert.notEqual(
    planCatalogImageUpload(config, 'workspace-2', target, 'submission-1').publicId,
    plan.publicId,
  );
  assert.notEqual(
    planCatalogImageUpload(config, 'workspace-1', target, 'submission-2').publicId,
    plan.publicId,
  );
  const logo = planCatalogImageUpload(
    config,
    'workspace-1',
    { collection: 'companies', recordId: 'store-1', field: 'logoImageUrl' },
    'submission-1',
  );
  assert.equal(logo.publicId, 'vetra-marketing/workspace-1/companies/store-1/submission-1');
  assert.throws(() => planCatalogImageUpload(config, '../other', target, 'submission-1'));
  assert.throws(() =>
    planCatalogImageUpload(
      { ...config, folder: 'vetra/../other' },
      'workspace-1',
      target,
      'submission-1',
    ),
  );
  assert.throws(() =>
    planCatalogImageUpload(
      config,
      'workspace-1',
      { ...target, field: 'logoImageUrl' } as unknown as CatalogMediaTarget,
      'submission-1',
    ),
  );
});

test('prepared file validation limits supported raster formats and positive byte sizes', () => {
  for (const type of ['image/jpeg', 'image/png', 'image/webp'])
    validatePreparedCatalogFile({ type, size: 5 * 1024 * 1024 });
  for (const type of ['image/svg+xml', 'image/gif', 'video/mp4', ''])
    assert.throws(() => validatePreparedCatalogFile({ type, size: 100 }));
  for (const size of [0, -1, 2.5, Infinity, 5 * 1024 * 1024 + 1])
    assert.throws(() => validatePreparedCatalogFile({ type: 'image/png', size }));
});

test('provider response parsing accepts only the planned asset with matching delivery metadata', () => {
  const response = {
    resource_type: 'image',
    type: 'upload',
    public_id: asset.publicId,
    asset_id: asset.assetId,
    secure_url: url,
    version: asset.version,
    format: asset.format,
    width: asset.width,
    height: asset.height,
    bytes: asset.bytes,
  };
  assert.deepEqual(parseCloudinaryUploadMetadata(response, plan), {
    imageUrl: url,
    imageAsset: asset,
  });
  for (const change of [
    { public_id: 'another-submission' },
    { resource_type: 'video' },
    { type: 'private' },
    { secure_url: url.replace('vetra-test', 'other') },
  ]) {
    assert.throws(() => parseCloudinaryUploadMetadata({ ...response, ...change }, plan));
  }
});
