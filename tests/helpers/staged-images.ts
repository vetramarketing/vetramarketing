import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import type { Db } from 'mongodb';
import sharp from 'sharp';
import {
  stageCatalogImage,
  catalogImageTarget,
  resolveStagedImage,
} from '../../src/lib/server/staged-images';
import {
  cleanupWorkspaceImages,
  readMongoWorkspace,
  writeMongoWorkspace,
} from '../../src/lib/server/mongo-workspace';

/** Fixture is called only against the temporary loopback replica in mongo-workspace.test.ts. */
export async function checkStagedImages(db: Db) {
  const initial = await readMongoWorkspace();
  assert.ok(initial);
  const target = catalogImageTarget('companies', initial.workspace.companies[0].id);
  const bytes = await sharp({ create: { width: 2, height: 2, channels: 4, background: '#339988' } })
    .png()
    .toBuffer();
  const resources = new Map<
    string,
    {
      asset_id: string;
      public_id: string;
      secure_url: string;
      context: { custom: { vetra_source: string } };
    }
  >();
  let uploadCount = 0,
    deleteCount = 0;
  let loseResponse = true;
  let rejectDeletion = false;
  const options = {
    env: {
      CLOUDINARY_CLOUD_NAME: 'fixture',
      CLOUDINARY_API_KEY: 'test',
      CLOUDINARY_API_SECRET: 'secret',
      CLOUDINARY_UPLOAD_FOLDER: 'test',
      CLOUDINARY_UPLOAD_PRESET: 'signed',
    },
    fetch: (async (input, init) => {
      const url = new URL(String(input));
      if (url.hostname === 'res.cloudinary.com') return new Response(Uint8Array.from(bytes));
      assert.equal(url.hostname, 'api.cloudinary.com');
      if (url.pathname.endsWith('/upload_presets/signed'))
        return Response.json({ name: 'signed', unsigned: false });
      const form = init?.body;
      if (form instanceof FormData && url.pathname.endsWith('/image/upload')) {
        uploadCount++;
        const path = String(form.get('public_id'));
        const info = {
          resource_type: 'image',
          type: 'upload',
          format: 'png',
          width: 2,
          height: 2,
          bytes: bytes.length,
          version: 1,
          secure_url: 'https://res.cloudinary.com/fixture/image/upload/v1/' + path + '.png',
          asset_id: randomUUID(),
          public_id: path,
          context: {
            custom: { vetra_source: String(form.get('context')).replace('vetra_source=', '') },
          },
        };
        assert.ok(!resources.has(path));
        resources.set(path, info);
        if (loseResponse) {
          loseResponse = false;
          throw new Error('Lost provider response');
        }
        return Response.json(info);
      }
      if (form instanceof FormData && url.pathname.endsWith('/image/destroy')) {
        if (rejectDeletion) return new Response(null, { status: 503 });
        assert.ok(form.get('signature'));
        const entry = [...resources].find(([, v]) => v.asset_id === form.get('asset_id'));
        assert.ok(entry);
        deleteCount++;
        resources.delete(entry[0]);
        return Response.json({ result: 'ok' });
      }
      const path = decodeURIComponent(url.pathname.split('/resources/image/upload/')[1]);
      const info = resources.get(path);
      return info ? Response.json(info) : new Response(null, { status: 404 });
    }) as typeof fetch,
  };
  const upload = (id: string, body = bytes, mime = 'image/png') =>
    stageCatalogImage(db, initial.databaseScope, target, id, mime, body, options);
  const invalid = { code: 'INVALID_CATALOG_IMAGE' };
  await assert.rejects(upload(randomUUID(), Buffer.from('invalid')), invalid);
  await assert.rejects(upload(randomUUID(), bytes, 'image/jpeg'), invalid);
  // Two-frame 3×2 APNG from Pillow. libvips can decode its first frame as a still PNG.
  const animatedPng = Buffer.from(
    'iVBORw0KGgoAAAANSUhEUgAAAAMAAAACCAYAAACddGYaAAAACGFjVEwAAAACAAAAAPONk3AAAAAaZmNUTAAAAAAAAAADAAAAAgAAAAAAAAAAAAEACgAAP7ZcWAAAABRJREFUeJxj/M/A8J8BCphgDBANAC8fAgK0KqlqAAAAGmZjVEwAAAABAAAAAwAAAAIAAAAAAAAAAAABAAoAAKTFtowAAAAYZmRBVAAAAAJ4nGNkYPj/nwEKmGAMEA0ALSECAjYzbHUAAAAASUVORK5CYII=',
    'base64',
  );
  await assert.rejects(upload(randomUUID(), animatedPng), invalid);
  const animation = await sharp(Buffer.from([255, 0, 0, 0, 255, 0]), {
    raw: { width: 1, height: 2, pageHeight: 1, channels: 3 },
  })
    .webp()
    .toBuffer();
  await assert.rejects(upload(randomUUID(), animation, 'image/webp'), invalid);
  assert.equal(uploadCount, 0);
  const id = randomUUID();
  await assert.rejects(upload(id), /Lost provider response/);
  const staged = await upload(id);
  assert.deepEqual(await upload(id), staged);
  assert.equal(uploadCount, 1);
  assert.equal(await resolveStagedImage(db, staged.imageUrl + '?wrong', target), null);
  await assert.rejects(
    resolveStagedImage(db, staged.imageUrl, catalogImageTarget('products', 'another')),
    { code: 'SUBMISSION_UNAVAILABLE' },
  );
  const makeSave = async (photo: typeof staged) => {
    const latest = await readMongoWorkspace();
    assert.ok(latest);
    return writeMongoWorkspace({
      expectedRevision: latest.revision,
      operationId: randomUUID(),
      workspace: {
        ...latest.workspace,
        companies: latest.workspace.companies.map((row) => ({
          ...row,
          logoImageUrl: photo.imageUrl,
          logoAsset: { ...photo.imageAsset, assetId: 'made-up-asset-id' },
        })),
      },
    });
  };
  const saved = await makeSave(staged);
  assert.equal(saved.workspace.companies[0].logoAsset?.assetId, staged.imageAsset.assetId);
  assert.deepEqual(await cleanupWorkspaceImages(id, options), {
    deleted: 0,
    protected: 1,
    failed: 0,
  });
  const cancelled = await upload(randomUUID());
  assert.deepEqual(await cleanupWorkspaceImages(null, options), {
    deleted: 0,
    protected: 0,
    failed: 0,
  });
  assert.deepEqual(await cleanupWorkspaceImages(cancelled.submissionId, options), {
    deleted: 1,
    protected: 0,
    failed: 0,
  });
  assert.deepEqual(await cleanupWorkspaceImages(cancelled.submissionId, options), {
    deleted: 0,
    protected: 0,
    failed: 0,
  });
  await assert.rejects(makeSave(cancelled), { code: 'SUBMISSION_UNAVAILABLE' });
  const simultaneous = await upload(randomUUID());
  const [committed, cleaned] = await Promise.allSettled([
    makeSave(simultaneous),
    cleanupWorkspaceImages(simultaneous.submissionId, options),
  ]);
  assert.equal(cleaned.status, 'fulfilled');
  if (committed.status === 'fulfilled') {
    assert.equal(resources.has(simultaneous.imageAsset.publicId), true);
    assert.deepEqual(cleaned.value, { deleted: 0, protected: 1, failed: 0 });
  } else {
    assert.equal(committed.reason.code, 'SUBMISSION_UNAVAILABLE');
    assert.deepEqual(cleaned.value, { deleted: 1, protected: 0, failed: 0 });
    assert.equal(
      (await readMongoWorkspace())?.workspace.companies[0].logoImageUrl,
      staged.imageUrl,
    );
  }
  assert.ok(deleteCount >= 1 && resources.has(staged.imageAsset.publicId));
  const beforeTrash = await readMongoWorkspace();
  assert.ok(beforeTrash);
  const product = catalogImageTarget('products', 'u-' + randomUUID());
  const trashed = await stageCatalogImage(
    db,
    initial.databaseScope,
    product,
    randomUUID(),
    'image/png',
    bytes,
    options,
  );
  await writeMongoWorkspace({
    workspace: {
      ...beforeTrash.workspace,
      products: [
        ...beforeTrash.workspace.products,
        {
          id: product.recordId,
          name: 'Archived product',
          sortOrder: 0,
          deletedAt: new Date().toISOString(),
          imageUrl: trashed.imageUrl,
        },
      ],
    },
    expectedRevision: beforeTrash.revision,
    operationId: randomUUID(),
  });
  // Simulate a stale staging state and ensure the workspace reference independently protects Trash.
  const stages = db.collection<{ _id: string; state: string; touchedAt: Date }>(
    'vetra_image_submissions',
  );
  await stages.updateOne(
    { _id: trashed.submissionId },
    { $set: { state: 'ready', touchedAt: new Date(0) } },
  );
  const abandoned = await upload(randomUUID());
  await stages.updateOne({ _id: abandoned.submissionId }, { $set: { touchedAt: new Date(0) } });
  rejectDeletion = true;
  assert.deepEqual(await cleanupWorkspaceImages(null, options), {
    deleted: 0,
    protected: 1,
    failed: 1,
  });
  rejectDeletion = false;
  assert.deepEqual(await cleanupWorkspaceImages(null, options), {
    deleted: 1,
    protected: 0,
    failed: 0,
  });
  assert.ok(resources.has(trashed.imageAsset.publicId));
}
