import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { readFile } from 'node:fs/promises';
import test from 'node:test';
import { ESHAN_HONEY_IMAGE } from '../src/lib/catalog-images';
import { createEmptyWorkspace } from '../src/lib/data';
import { migrateWorkspaceMedia } from '../src/lib/server/workspace-media';

const env = {
  CLOUDINARY_CLOUD_NAME: 'test-cloud',
  CLOUDINARY_API_KEY: 'test-key',
  CLOUDINARY_API_SECRET: 'test-secret',
  CLOUDINARY_UPLOAD_PRESET: 'signed-images',
  CLOUDINARY_UPLOAD_FOLDER: 'catalog',
};

function fixture() {
  const workspace = createEmptyWorkspace();
  workspace.products = [
    {
      id: 'honey',
      name: 'Honey',
      imageUrl: ESHAN_HONEY_IMAGE,
      sortOrder: 0,
      deletedAt: '2026-11-19T00:00:00.000Z',
    },
  ];
  return workspace;
}

test('migration verifies persisted bytes, includes Trash and resumes after a lost upload response', async () => {
  const bytes = await readFile('public/product/Clean ESHAN honey jar cutout.png');
  const checksum = createHash('sha256').update(bytes).digest('hex');
  const publicId = 'catalog/default/products/honey/' + checksum;
  const url = 'https://res.cloudinary.com/test-cloud/image/upload/v1/' + publicId + '.png';
  let uploaded = false;
  const request: typeof fetch = async (input, init) => {
    const target = String(input);
    if (target === url) return new Response(Uint8Array.from(bytes));
    assert.ok(target.startsWith('https://api.cloudinary.com/v1_1/test-cloud/'));
    if (target.endsWith('/image/upload')) {
      assert.equal(uploaded, false);
      assert.ok(init?.body instanceof FormData);
      assert.equal(init.body.get('overwrite'), 'false');
      assert.equal(init.body.get('public_id'), publicId);
      assert.equal(init.body.get('context'), 'vetra_source=' + checksum);
      const file = init.body.get('file');
      assert.ok(file instanceof Blob);
      assert.deepEqual(Buffer.from(await file.arrayBuffer()), bytes);
      uploaded = true;
      throw new Error('Lost response');
    }
    assert.ok(new Headers(init?.headers).has('authorization'));
    if (target.endsWith('/upload_presets/signed-images'))
      return Response.json({ name: 'signed-images', unsigned: false });
    assert.equal(
      target,
      'https://api.cloudinary.com/v1_1/test-cloud/resources/image/upload/' +
        encodeURIComponent(publicId) +
        '?context=true',
    );
    return uploaded
      ? Response.json({
          context: { custom: { vetra_source: checksum } },
          public_id: publicId,
          asset_id: 'asset',
          secure_url: url,
          type: 'upload',
          resource_type: 'image',
          version: 1,
          format: 'png',
          width: 1254,
          height: 1254,
          bytes: bytes.length,
        })
      : new Response(null, { status: 404 });
  };
  const source = fixture();
  await assert.rejects(
    migrateWorkspaceMedia(source, 'default', { env, fetch: request }),
    /Lost response/,
  );
  assert.equal(source.products[0].imageUrl, ESHAN_HONEY_IMAGE);
  const result = await migrateWorkspaceMedia(source, 'default', { env, fetch: request });
  assert.equal(result.products[0].imageUrl, url);
  assert.equal(result.products[0].deletedAt, source.products[0].deletedAt);
  assert.equal(result.products[0].imageAsset?.bytes, bytes.length);
  const changed = structuredClone(result);
  changed.products[0].imageAsset!.bytes = 1;
  assert.deepEqual(
    await migrateWorkspaceMedia(changed, 'default', {
      previous: result,
      fetch: async () => assert.fail('unexpected network call'),
    }),
    result,
  );
  await assert.rejects(
    migrateWorkspaceMedia(source, 'default', {
      env,
      fetch: (input, init) => {
        if (String(input) !== url) return request(input, init);
        return Promise.resolve(new Response(Uint8Array.from(Buffer.alloc(bytes.length))));
      },
    }),
    /different catalog image/,
  );
});

test('signed configuration is verified before an upload and external URLs are fetched only by Cloudinary', async () => {
  const source = fixture();
  source.products = [];
  source.companies[0].logoImageUrl = 'https://cdn.example.com/logo.png';
  await assert.rejects(
    migrateWorkspaceMedia(source, 'default', {
      env,
      fetch: async () => Response.json({ name: 'signed-images', unsigned: true }),
    }),
    /signed Cloudinary/,
  );
  let uploads = 0;
  await assert.rejects(
    migrateWorkspaceMedia(source, 'default', {
      env,
      fetch: async (input, init) => {
        assert.equal(new URL(String(input)).hostname, 'api.cloudinary.com');
        if (String(input).includes('/upload_presets/'))
          return Response.json({ name: 'signed-images', unsigned: false });
        if (init?.body instanceof FormData) {
          assert.equal(init.body.get('file'), source.companies[0].logoImageUrl);
          uploads++;
          return new Response(null, { status: 400 });
        }
        return new Response(null, { status: 404 });
      },
    }),
    /HTTP 400/,
  );
  assert.equal(uploads, 1);
  assert.equal(source.companies[0].logoAsset, undefined);
});
