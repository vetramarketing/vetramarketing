import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import test from 'node:test';
import {
  CatalogFileSubmission,
  catalogImageDimensions,
  inspectCatalogImage,
  PreparationError,
} from '../src/lib/browser-catalog-image';

test('preparation fits each catalog, preserving aspect ratio and smaller originals', () => {
  assert.deepEqual(catalogImageDimensions(4000, 3000, 'products'), { width: 1600, height: 1200 });
  assert.deepEqual(catalogImageDimensions(1500, 3000, 'companies'), { width: 256, height: 512 });
  assert.deepEqual(catalogImageDimensions(301, 417, 'companies'), { width: 301, height: 417 });
});

test('file inspection rejects animation, oversized images and mislabeled files before decoding', async () => {
  const png = await readFile('public/product/Clean ESHAN honey jar cutout.png');
  assert.equal(
    await inspectCatalogImage(new File([Uint8Array.from(png)], 'eshan.png')),
    'image/png',
  );
  const inspect = (bytes: Uint8Array) =>
    inspectCatalogImage(new File([Uint8Array.from(bytes)], 'logo.png', { type: 'image/png' }));
  const reason = (expected: string) => (e: unknown) =>
    e instanceof PreparationError && e.reason === expected;
  await assert.rejects(
    inspect(new TextEncoder().encode('<svg viewBox="0 0 40 40"/>')),
    reason('format'),
  );
  const oversized = Buffer.from(png);
  oversized.writeUInt32BE(100000, 16);
  await assert.rejects(inspect(oversized), reason('input-size'));
  const apng = Buffer.from(png);
  apng.write('acTL', 37, 'ascii');
  await assert.rejects(inspect(apng), reason('animated'));
  const animatedWebp = Buffer.alloc(30);
  animatedWebp.write('RIFF', 0);
  animatedWebp.write('WEBPVP8X', 8);
  animatedWebp[20] = 2;
  await assert.rejects(inspect(animatedWebp), reason('animated'));
});

test('cancelling a fresh selection sends nothing, retries stage once and exhaust database retries safely', async () => {
  const ids: string[] = [];
  const cleanup: string[] = [];
  const file = new Blob(['prepared'], { type: 'image/webp' });
  const request: typeof fetch = async (path, options) => {
    if (options?.method === 'POST') {
      cleanup.push(String(path));
      return Response.json({});
    }
    assert.equal(path, '/api/workspace/media/products/p1');
    assert.equal(options?.body, file);
    const id = new Headers(options?.headers).get('X-Submission-Id')!;
    ids.push(id);
    if (ids.length === 1) throw new Error('Lost upload response');
    const imageAsset = {
      provider: 'cloudinary',
      cloudName: 'test',
      publicId: 'vetra/p1/' + id,
      assetId: 'asset',
      version: 1,
      bytes: file.size,
      width: 8,
      height: 8,
      format: 'webp',
    };
    return Response.json({
      submissionId: id,
      imageAsset,
      imageUrl: 'https://res.cloudinary.com/test/image/upload/v1/' + imageAsset.publicId + '.webp',
    });
  };
  const selection = new CatalogFileSubmission('products', 'p1', file, request);
  await selection.abandon();
  assert.deepEqual(cleanup, []);
  await assert.rejects(selection.stage(), /Lost upload/);
  const image = await selection.stage();
  assert.equal(ids[0], ids[1]);
  for (let i = 0; i < 2; i++) {
    await selection.saveFailed();
    assert.equal(await selection.stage(), image);
  }
  assert.equal(ids.length, 2);
  assert.equal(cleanup.length, 0);
  await selection.saveFailed();
  assert.deepEqual(cleanup, ['/api/workspace/media/cleanup?submissionId=' + ids[0]]);
  await selection.stage();
  assert.notEqual(ids[2], ids[0]);
});
