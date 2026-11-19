import assert from 'node:assert/strict';
import test from 'node:test';
import { PDFArray, PDFDocument, PDFName } from 'pdf-lib';
import { createEmptyWorkspace } from '../src/lib/data';
import { emptyShippingAddress, type Order, type OrderLabel } from '../src/lib/orders';
import {
  buildCarrierLabelPdf,
  CarrierLabelError,
  exportWorkspaceWithLabels,
  importCarrierLabel,
  importCarrierLabelBytes,
  MAX_CARRIER_LABEL_BYTES,
  prepareWorkspaceLabelRestore,
  readCarrierLabel,
  restoreWorkspaceWithLabels,
  type CarrierLabelStore,
} from '../src/lib/order-labels';
import { serializeWorkspace } from '../src/lib/workspace-storage';

class MemoryLabels implements CarrierLabelStore {
  values = new Map<string, Uint8Array>();
  writes = 0;
  async read(id: string) {
    const value = this.values.get(id);
    return value ? Uint8Array.from(value) : undefined;
  }
  async write(id: string, bytes: Uint8Array) {
    this.writes += 1;
    this.values.set(id, Uint8Array.from(bytes));
  }
}

async function pdf(width = 283.46, height = 510.24, pages = 1) {
  const document = await PDFDocument.create();
  for (let index = 0; index < pages; index += 1) {
    const page = document.addPage([width, height]);
    page.drawText(`Carrier test fixture ${index + 1}`, { x: 20, y: height - 40, size: 12 });
    // Vector lines stand in for print artwork; merging must preserve page content as well as size.
    page.drawLine({ start: { x: 20, y: 20 }, end: { x: width - 20, y: 20 }, thickness: 2 });
  }
  return document.save();
}

function withLabel(label: OrderLabel, id = 'order-1', deletedAt?: string): Order {
  return {
    id,
    number: `VT-20261105-${id}`,
    companyId: 'vetra',
    customerName: 'Label test',
    orderedOn: '2026-11-05',
    items: [],
    discountSatang: 0,
    shippingSatang: 0,
    paymentMethod: 'transfer',
    status: 'ordered',
    sender: emptyShippingAddress(),
    recipient: emptyShippingAddress(),
    carrier: 'flash',
    parcel: { weightGrams: 0, widthCm: 0, lengthCm: 0, heightCm: 0 },
    trackingNumber: `TH-${id}`,
    label,
    notes: '',
    createdAt: '2026-11-05T00:00:00.000Z',
    updatedAt: '2026-11-05T00:00:00.000Z',
    ...(deletedAt ? { deletedAt } : {}),
  };
}

const errorCode = (code: string) => (error: unknown) =>
  error instanceof CarrierLabelError && error.code === code;

test('import and retrieval preserve exact PDF bytes with a stable content checksum', async () => {
  const store = new MemoryLabels();
  const bytes = await pdf();
  const file = new File([Uint8Array.from(bytes).buffer], 'Flash label.pdf', {
    type: 'application/pdf',
  });
  const label = await importCarrierLabel(file, store);
  assert.equal(label.name, 'Flash label.pdf');
  assert.equal(label.size, bytes.byteLength);
  assert.match(label.sha256, /^[a-f0-9]{64}$/);
  assert.equal(label.id, `label-${label.sha256}`);
  assert.deepEqual(await readCarrierLabel(label, store), bytes);
  const repeat = await importCarrierLabelBytes(bytes, 'same label', store);
  assert.equal(repeat.id, label.id);
  assert.equal(repeat.name, 'same label.pdf');
  assert.equal(store.values.size, 1);
});

test('rejects oversized, non-PDF, encrypted, malformed and excessively long PDFs before storing', async () => {
  const store = new MemoryLabels();
  await assert.rejects(
    importCarrierLabelBytes(new Uint8Array(MAX_CARRIER_LABEL_BYTES + 1), 'large.pdf', store),
    errorCode('file-too-large'),
  );
  await assert.rejects(
    importCarrierLabelBytes(
      new TextEncoder().encode('<html>not a label</html>'),
      'wrong.pdf',
      store,
    ),
    errorCode('invalid-pdf'),
  );
  await assert.rejects(
    importCarrierLabelBytes(new TextEncoder().encode('%PDF-1.7\ninvalid'), 'broken.pdf', store),
    errorCode('invalid-pdf'),
  );
  await assert.rejects(
    importCarrierLabelBytes(await pdf(100, 200, 21), 'long.pdf', store),
    errorCode('too-many-pages'),
  );
  const encrypted = await PDFDocument.create();
  encrypted.addPage([100, 200]);
  encrypted.context.trailerInfo.Encrypt = encrypted.context.register(
    encrypted.context.obj({ Filter: 'Standard', V: 2, R: 3 }),
  );
  await assert.rejects(
    importCarrierLabelBytes(await encrypted.save(), 'locked.pdf', store),
    errorCode('invalid-pdf'),
  );
  assert.equal(store.writes, 0);
});

test('missing or damaged bytes fail explicitly without substituting a made-up label', async () => {
  const store = new MemoryLabels();
  const label = await importCarrierLabelBytes(await pdf(), 'carrier.pdf', store);
  const original = store.values.get(label.id)!;
  store.values.delete(label.id);
  await assert.rejects(readCarrierLabel(label, store), errorCode('missing-label'));
  const damaged = Uint8Array.from(original);
  damaged[damaged.length - 3] ^= 1;
  store.values.set(label.id, damaged);
  await assert.rejects(readCarrierLabel(label, store), errorCode('corrupt-label'));
  assert.equal(store.writes, 1);
});

test('storage failure cannot produce successful attachment metadata', async () => {
  const unavailable: CarrierLabelStore = {
    async read() {
      return undefined;
    },
    async write() {
      throw new CarrierLabelError('storage-unavailable', 'Storage is full.');
    },
  };
  await assert.rejects(
    importCarrierLabelBytes(await pdf(), 'carrier.pdf', unavailable),
    errorCode('storage-unavailable'),
  );
});

test('batch preserves every page in order, original dimensions, rotation and artwork streams', async () => {
  const store = new MemoryLabels();
  const firstBytes = await pdf(283.46, 510.24, 2);
  const first = await importCarrierLabelBytes(firstBytes, 'Flash100x180.pdf', store);
  const secondSource = await PDFDocument.load(await pdf(283.46, 212.6));
  secondSource.getPage(0).node.set(PDFName.of('Rotate'), secondSource.context.obj(90));
  const second = await importCarrierLabelBytes(await secondSource.save(), 'small.pdf', store);
  const merged = await PDFDocument.load(await buildCarrierLabelPdf([first, second], store));
  assert.equal(merged.getPageCount(), 3);
  assert.deepEqual(
    merged.getPages().map((page) => page.getSize()),
    [
      { width: 283.46, height: 510.24 },
      { width: 283.46, height: 510.24 },
      { width: 283.46, height: 212.6 },
    ],
  );
  assert.equal(merged.getPage(2).getRotation().angle, 90);
  const originals = [
    await PDFDocument.load(firstBytes),
    await PDFDocument.load(await readCarrierLabel(second, store)),
  ];
  const originalStream = (document: PDFDocument, index: number) => {
    const contents = document.getPage(index).node.Contents();
    assert.ok(contents instanceof PDFArray);
    return contents.asArray().map((entry) => document.context.lookup(entry)?.toString());
  };
  assert.deepEqual(originalStream(merged, 0), originalStream(originals[0], 0));
  assert.deepEqual(originalStream(merged, 1), originalStream(originals[0], 1));
  assert.deepEqual(originalStream(merged, 2), originalStream(originals[1], 0));
  assert.deepEqual(
    await readCarrierLabel(first, store),
    firstBytes,
    'batch creation never rewrites the original carrier PDF',
  );
});

test('batch limits fail before silently dropping pages or duplicating a carrier PDF', async () => {
  const store = new MemoryLabels();
  const label = await importCarrierLabelBytes(await pdf(), 'label.pdf', store);
  await assert.rejects(buildCarrierLabelPdf([], store), errorCode('batch-limit'));
  await assert.rejects(
    buildCarrierLabelPdf(
      Array.from({ length: 51 }, () => label),
      store,
    ),
    errorCode('batch-limit'),
  );
  await assert.rejects(buildCarrierLabelPdf([label, label], store), errorCode('batch-limit'));
  const labels = [];
  for (let index = 0; index < 11; index += 1)
    labels.push(
      await importCarrierLabelBytes(await pdf(100 + index, 200, 20), `label-${index}.pdf`, store),
    );
  await assert.rejects(buildCarrierLabelPdf(labels, store), errorCode('batch-limit'));
});

test('portable backup round trips active and trashed labels into an empty store', async () => {
  const originalStore = new MemoryLabels();
  const first = await importCarrierLabelBytes(await pdf(), 'active.pdf', originalStore);
  const second = await importCarrierLabelBytes(await pdf(100, 300), 'trashed.pdf', originalStore);
  const workspace = {
    ...createEmptyWorkspace(),
    orders: [withLabel(first), withLabel(second, 'order-2', '2026-11-05T01:00:00Z')],
  };
  const backup = await exportWorkspaceWithLabels(workspace, originalStore);
  const target = new MemoryLabels();
  const restored = await restoreWorkspaceWithLabels(JSON.parse(backup), target);
  assert.deepEqual(serializeWorkspace(restored), serializeWorkspace(workspace));
  assert.equal(target.values.size, 2);
  assert.deepEqual(
    await readCarrierLabel(first, target),
    await readCarrierLabel(first, originalStore),
  );
  assert.deepEqual(
    await readCarrierLabel(second, target),
    await readCarrierLabel(second, originalStore),
  );
});

test('backup export refuses missing PDFs; invalid restore validates all PDFs before any storage writes', async () => {
  const store = new MemoryLabels();
  const label = await importCarrierLabelBytes(await pdf(), 'label.pdf', store);
  const second = await importCarrierLabelBytes(await pdf(100, 300), 'second.pdf', store);
  const workspace = {
    ...createEmptyWorkspace(),
    orders: [withLabel(label), withLabel(second, 'order-2')],
  };
  const backup = JSON.parse(await exportWorkspaceWithLabels(workspace, store));
  await assert.rejects(
    exportWorkspaceWithLabels(workspace, new MemoryLabels()),
    errorCode('missing-label'),
  );
  const damaged = structuredClone(backup);
  damaged.labels[1].data = damaged.labels[1].data.slice(0, -4) + 'AAAA';
  const target = new MemoryLabels();
  await assert.rejects(restoreWorkspaceWithLabels(damaged, target), errorCode('invalid-backup'));
  const missing = structuredClone(backup);
  missing.labels = [];
  await assert.rejects(restoreWorkspaceWithLabels(missing, target), errorCode('invalid-backup'));
  const extra = structuredClone(backup);
  extra.labels.push(extra.labels[0]);
  await assert.rejects(restoreWorkspaceWithLabels(extra, target), errorCode('invalid-backup'));
  assert.equal(target.writes, 0);
});

test('older plain backups remain supported and label references require existing matching files', async () => {
  const empty = createEmptyWorkspace();
  assert.deepEqual(
    serializeWorkspace(await restoreWorkspaceWithLabels(serializeWorkspace(empty))),
    serializeWorkspace(empty),
  );
  const store = new MemoryLabels();
  const label = await importCarrierLabelBytes(await pdf(), 'label.pdf', store);
  const workspace = { ...empty, orders: [withLabel(label)] };
  await assert.rejects(
    restoreWorkspaceWithLabels(serializeWorkspace(workspace), new MemoryLabels()),
    errorCode('missing-label'),
  );
  assert.deepEqual(
    serializeWorkspace(await restoreWorkspaceWithLabels(serializeWorkspace(workspace), store)),
    serializeWorkspace(workspace),
  );
});

test('previewing and cancelling a restore neither adds nor overwrites any saved carrier PDF', async () => {
  const current = new MemoryLabels();
  const currentLabel = await importCarrierLabelBytes(await pdf(), 'current.pdf', current);
  const currentBytes = await readCarrierLabel(currentLabel, current);
  const backupStore = new MemoryLabels();
  const incomingLabel = await importCarrierLabelBytes(
    await pdf(100, 300),
    'incoming.pdf',
    backupStore,
  );
  const incoming = { ...createEmptyWorkspace(), orders: [withLabel(incomingLabel)] };
  const parsed = JSON.parse(await exportWorkspaceWithLabels(incoming, backupStore));
  const prepared = await prepareWorkspaceLabelRestore(parsed, current);
  assert.equal(prepared.workspace.orders?.[0].label?.id, incomingLabel.id);
  assert.equal(current.writes, 1);
  assert.equal(current.values.has(incomingLabel.id), false);
  assert.deepEqual(await readCarrierLabel(currentLabel, current), currentBytes);
  // Dropping the prepared result is a cancelled restore and has no storage effect.
  const forged = structuredClone(parsed);
  forged.workspace.orders[0].label.id = currentLabel.id;
  forged.labels[0].id = currentLabel.id;
  await assert.rejects(prepareWorkspaceLabelRestore(forged, current), errorCode('corrupt-label'));
  assert.deepEqual(await readCarrierLabel(currentLabel, current), currentBytes);
  assert.equal(current.writes, 1);
});

test('confirmed restore preserves identical PDFs and refuses differing existing bytes', async () => {
  const source = new MemoryLabels();
  const label = await importCarrierLabelBytes(await pdf(), 'label.pdf', source);
  const workspace = { ...createEmptyWorkspace(), orders: [withLabel(label)] };
  const parsed = JSON.parse(await exportWorkspaceWithLabels(workspace, source));
  const target = new MemoryLabels();
  const prepared = await prepareWorkspaceLabelRestore(parsed, target);
  assert.equal(target.writes, 0);
  await prepared.commitLabels();
  assert.equal(target.writes, 1);
  await prepared.commitLabels();
  assert.equal(target.writes, 1, 'identical files are reused without overwriting');
  const damaged = Uint8Array.from(target.values.get(label.id)!);
  damaged[damaged.length - 3] ^= 1;
  target.values.set(label.id, damaged);
  await assert.rejects(prepared.commitLabels(), errorCode('corrupt-label'));
  assert.deepEqual(
    target.values.get(label.id),
    damaged,
    'differing existing bytes remain untouched',
  );
  assert.equal(target.writes, 1);
});
