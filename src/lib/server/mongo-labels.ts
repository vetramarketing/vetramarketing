import { createHash } from 'node:crypto';
import { Binary, MongoServerError, type Db } from 'mongodb';
import { importCarrierLabelBytes, type CarrierLabelStore } from '../order-labels';
import type { Workspace } from '../types';

export const validLabelId = (id: string) => /^label-[a-f0-9]{64}$/.test(id);

export function mongoLabelStore(db: Db): CarrierLabelStore {
  const files = db.collection<{ _id: string; data: Binary; size: number }>('vetra_carrier_labels');
  async function read(id: string) {
    if (!validLabelId(id)) throw new Error('Invalid carrier label ID.');
    const file = await files.findOne({ _id: id });
    if (!file) return undefined;
    const bytes = file.data.value();
    if (
      bytes.length !== file.size ||
      createHash('sha256').update(bytes).digest('hex') !== id.slice(6)
    )
      throw new Error('Stored carrier PDF failed verification.');
    return Uint8Array.from(bytes);
  }
  return {
    read,
    async write(id, bytes) {
      if (!validLabelId(id) || createHash('sha256').update(bytes).digest('hex') !== id.slice(6))
        throw new Error('Carrier PDF does not match its ID.');
      try {
        await files.insertOne(
          { _id: id, data: new Binary(bytes), size: bytes.length },
          { writeConcern: { w: 'majority' } },
        );
      } catch (error) {
        if (!(error instanceof MongoServerError && error.code === 11000)) throw error;
      }
      if (!(await read(id))) throw new Error('Carrier PDF could not be verified after upload.');
    },
  };
}

/** The route accepts only PDFs that pass the same validation as a portable backup. */
export async function storeUploadedLabel(db: Db, id: string, bytes: Uint8Array) {
  if (createHash('sha256').update(bytes).digest('hex') !== id.slice(6)) return false;
  await importCarrierLabelBytes(bytes, 'carrier-label.pdf', mongoLabelStore(db));
  return true;
}

export async function assertStoredLabels(workspace: Workspace, db: Db) {
  const labels = new Map<string, number>();
  for (const order of workspace.orders ?? []) {
    if (order.label) {
      const { id, sha256, size } = order.label;
      if (id !== 'label-' + sha256 || (labels.has(id) && labels.get(id) !== size))
        throw new Error('Inconsistent carrier PDF reference.');
      labels.set(id, size);
    }
  }
  if (!labels.size) return;
  const rows = await db
    .collection<{ _id: string; size: number }>('vetra_carrier_labels')
    .find({ _id: { $in: [...labels.keys()] } }, { projection: { size: 1 } })
    .toArray();
  if (rows.length !== labels.size || rows.some((row) => row.size !== labels.get(row._id)))
    throw new Error('Upload every referenced carrier PDF before saving the workspace.');
}
