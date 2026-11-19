import assert from 'node:assert/strict';
import { spawn } from 'node:child_process';
import { createHash } from 'node:crypto';
import { once } from 'node:events';
import { mkdtemp, rm } from 'node:fs/promises';
import { createServer } from 'node:net';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import test from 'node:test';
import { Binary, MongoClient } from 'mongodb';
import { PDFDocument } from 'pdf-lib';
import { createEmptyWorkspace } from '../src/lib/data';
import { emptyShippingAddress } from '../src/lib/orders';
import { mongoLabelStore, storeUploadedLabel } from '../src/lib/server/mongo-labels';
import {
  closeWorkspaceMongoDb,
  getWorkspaceMongoDb,
  readMongoWorkspace,
  writeMongoWorkspace,
} from '../src/lib/server/mongo-workspace';
import { isLocalWorkspaceRequest } from '../src/lib/server/workspace-request';
import { serializeWorkspace } from '../src/lib/workspace-storage';
import { checkStagedImages } from './helpers/staged-images';

test('workspace requests require local access and same-origin mutations', () => {
  const address = 'http://127.0.0.1:' + (process.env.PORT || 3100);
  const accepted = (method: string, headers: Record<string, string>) =>
    isLocalWorkspaceRequest(
      new Request(address + '/api/workspace', {
        method,
        headers: { host: new URL(address).host, ...headers },
      }),
    );
  assert.equal(accepted('GET', {}), true);
  assert.equal(accepted('POST', { origin: address }), true);
  assert.equal(accepted('POST', {}), false);
  assert.equal(accepted('POST', { origin: 'https://example.com' }), false);
  assert.equal(accepted('GET', { 'sec-fetch-site': 'cross-site' }), false);
  assert.equal(accepted('GET', { 'x-forwarded-for': '203.0.113.2' }), false);
  assert.equal(accepted('GET', { host: 'localhost:99999' }), false);
});

// Start an isolated loopback replica. This test never uses the application's database.
test(
  'MongoDB import, durable retries, concurrent CAS and corruption checks',
  { skip: !process.env.VETRA_TEST_MONGOD_BINARY },
  async (t) => {
    const listener = createServer();
    listener.listen(0, '127.0.0.1');
    await once(listener, 'listening');
    const bound = listener.address();
    assert.ok(bound && typeof bound === 'object');
    await new Promise<void>((resolve) => listener.close(() => resolve()));
    const directory = await mkdtemp(join(tmpdir(), 'vetra-mongo-test-'));
    const server = spawn(
      process.env.VETRA_TEST_MONGOD_BINARY!,
      [
        '--bind_ip',
        '127.0.0.1',
        '--port',
        String(bound.port),
        '--replSet',
        'vetra_test',
        '--dbpath',
        directory,
        '--logpath',
        join(directory, 'server.log'),
      ],
      { windowsHide: true, stdio: 'ignore' },
    );
    const ended = once(server, 'exit');
    const uri = 'mongodb://127.0.0.1:' + bound.port;
    const admin = new MongoClient(uri + '/?directConnection=true', {
      serverSelectionTimeoutMS: 15000,
    });
    t.after(async () => {
      await closeWorkspaceMongoDb();
      try {
        await admin.db('admin').command({ shutdown: 1 });
      } catch {
        /* Shutdown closes the connection. */
      }
      await admin.close();
      if (server.exitCode === null && server.signalCode === null) server.kill();
      await ended;
      await rm(directory, { recursive: true, force: true, maxRetries: 10, retryDelay: 100 });
    });
    await admin.connect();
    await admin.db('admin').command({
      replSetInitiate: {
        _id: 'vetra_test',
        members: [{ _id: 0, host: '127.0.0.1:' + bound.port }],
      },
    });
    process.env.MONGODB_URI = uri + '/?replicaSet=vetra_test';
    process.env.MONGODB_DB = 'vetra_integration_test';
    assert.equal(await readMongoWorkspace(), null);
    const initial = serializeWorkspace(createEmptyWorkspace());
    const first = { workspace: initial, expectedRevision: null, operationId: 'first' };
    const imported = await writeMongoWorkspace(first);
    assert.deepEqual(await readMongoWorkspace(), imported);
    assert.deepEqual(await writeMongoWorkspace(first), imported);
    await assert.rejects(writeMongoWorkspace({ ...first, operationId: 'other-import' }), {
      code: 'WORKSPACE_REVISION_CONFLICT',
    });
    const change = (name: string) => ({
      expectedRevision: imported.revision,
      operationId: name,
      workspace: { ...initial, companies: initial.companies.map((row) => ({ ...row, name })) },
    });
    const simultaneous = await Promise.allSettled([
      writeMongoWorkspace(change('Left')),
      writeMongoWorkspace(change('Right')),
    ]);
    assert.equal(simultaneous.filter((r) => r.status === 'fulfilled').length, 1);
    const failed = simultaneous.find((r) => r.status === 'rejected');
    assert.equal(failed?.reason.code, 'WORKSPACE_REVISION_CONFLICT');
    const current = await readMongoWorkspace();
    assert.ok(current);
    assert.deepEqual(
      await writeMongoWorkspace(change(current.workspace.companies[0].name)),
      current,
    );
    assert.equal(current.migrationSourceDigest, imported.migrationSourceDigest);
    const db = await getWorkspaceMongoDb();
    await t.test(
      'private carrier PDFs validate before commit and preserve their bytes on retry',
      async (pdfTest) => {
        const pdf = await PDFDocument.create();
        pdf.addPage([100, 180]);
        const bytes = await pdf.save();
        const sha256 = createHash('sha256').update(bytes).digest('hex');
        const date = '2026-11-19T01:00:00.000Z';
        const label = {
          id: 'label-' + sha256,
          name: 'carrier.pdf',
          size: bytes.length,
          addedAt: date,
          sha256,
        };
        const order = {
          id: 'order-label-test',
          number: 'VT-20261119-001',
          companyId: 'vetra',
          customerName: 'Test',
          orderedOn: '2026-11-19',
          items: [],
          discountSatang: 0,
          shippingSatang: 0,
          paymentMethod: 'transfer',
          status: 'ordered',
          recipient: emptyShippingAddress(),
          carrier: 'flash',
          trackingNumber: 'TEST12345',
          parcel: { weightGrams: 0, widthCm: 0, lengthCm: 0, heightCm: 0 },
          label,
          notes: '',
          createdAt: date,
          updatedAt: date,
        };
        const request = {
          workspace: { ...current.workspace, orders: [order] },
          expectedRevision: current.revision,
          operationId: 'store-label',
        };
        await assert.rejects(writeMongoWorkspace(request), /referenced carrier PDF/);
        assert.deepEqual(await readMongoWorkspace(), current);
        const malformed = Buffer.from('this is not a PDF');
        const badId = 'label-' + createHash('sha256').update(malformed).digest('hex');
        await assert.rejects(storeUploadedLabel(db, badId, malformed), { code: 'invalid-pdf' });
        assert.equal(await storeUploadedLabel(db, label.id, malformed), false);
        assert.equal(await db.collection('vetra_carrier_labels').countDocuments(), 0);
        assert.equal(await storeUploadedLabel(db, label.id, bytes), true);
        assert.equal(await storeUploadedLabel(db, label.id, bytes), true);
        assert.equal(await storeUploadedLabel(db, label.id, malformed), false);
        assert.equal(await db.collection('vetra_carrier_labels').countDocuments(), 1);
        assert.deepEqual(await mongoLabelStore(db).read(label.id), bytes);
        const committed = await writeMongoWorkspace(request);
        assert.deepEqual(await readMongoWorkspace(), committed);
        const storedOrder = committed.workspace.orders[0];
        assert.ok('label' in storedOrder);
        assert.deepEqual(storedOrder.label, label);
        await pdfTest.test(
          'verified restore rejects same-size damaged PDF bytes without replacing active records',
          async () => {
            const files = db.collection<{ _id: string; data: Binary }>('vetra_carrier_labels');
            const damaged = Uint8Array.from(bytes);
            damaged[13] ^= 0x10;
            await files.updateOne({ _id: label.id }, { $set: { data: new Binary(damaged) } });
            const restored = {
              workspace: {
                ...committed.workspace,
                companies: committed.workspace.companies.map((company) => ({
                  ...company,
                  name: 'Replacement company',
                })),
              },
              expectedRevision: committed.revision,
              verifyLabelBytes: true,
              operationId: 'verified-restore',
            };
            await assert.rejects(
              writeMongoWorkspace(restored),
              /Stored carrier PDF failed verification/,
            );
            assert.deepEqual(await readMongoWorkspace(), committed);
            await files.updateOne({ _id: label.id }, { $set: { data: new Binary(bytes) } });
            const valid = await writeMongoWorkspace(restored);
            assert.equal(valid.workspace.companies[0].name, 'Replacement company');
            assert.deepEqual(await writeMongoWorkspace(restored), valid);
          },
        );
      },
    );
    await t.test(
      'image submission validation, uncertain retries, cleanup and concurrent save',
      () => checkStagedImages(db),
    );
    await db
      .collection('vetra_companies')
      .updateOne({}, { $set: { 'value.name': 'unexpected change' } });
    await assert.rejects(readMongoWorkspace(), { code: 'WORKSPACE_UNREADABLE' });
  },
);
