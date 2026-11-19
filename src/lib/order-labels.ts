import { PDFDocument } from 'pdf-lib';
import type { OrderLabel } from './orders';
import type { Workspace } from './types';
import { deserializeWorkspace, serializeWorkspace } from './workspace-storage';

export const MAX_CARRIER_LABEL_BYTES = 10 * 1024 * 1024;
export const MAX_CARRIER_LABEL_PAGES = 20;
export const MAX_BATCH_LABELS = 50;
export const MAX_BATCH_LABEL_PAGES = 200;
const MAX_BATCH_BYTES = 50 * 1024 * 1024;
const MAX_BACKUP_BYTES = 100 * 1024 * 1024;
export const MAX_LABEL_BACKUP_TEXT_BYTES = 150 * 1024 * 1024;
const BACKUP_FORMAT = 'vetra-workspace-with-labels';
const DATABASE_NAME = 'vetra-marketing.carrier-labels.v1';
const STORE_NAME = 'pdfs';

export type CarrierLabelErrorCode =
  | 'invalid-pdf'
  | 'file-too-large'
  | 'too-many-pages'
  | 'batch-limit'
  | 'missing-label'
  | 'corrupt-label'
  | 'storage-unavailable'
  | 'invalid-backup'
  | 'backup-limit';

export class CarrierLabelError extends Error {
  constructor(
    readonly code: CarrierLabelErrorCode,
    message: string,
    options?: ErrorOptions,
  ) {
    super(message, options);
    this.name = 'CarrierLabelError';
  }
}

/** PDF bytes are kept outside localStorage, while their immutable references stay in orders. */
export interface CarrierLabelStore {
  read(id: string): Promise<Uint8Array | undefined>;
  write(id: string, bytes: Uint8Array): Promise<void>;
}

let databasePromise: Promise<IDBDatabase> | undefined;

function openDatabase(): Promise<IDBDatabase> {
  if (typeof indexedDB === 'undefined')
    return Promise.reject(
      new CarrierLabelError('storage-unavailable', 'Carrier label storage is unavailable.'),
    );
  if (!databasePromise) {
    databasePromise = new Promise<IDBDatabase>((resolve, reject) => {
      const request = indexedDB.open(DATABASE_NAME, 1);
      request.onupgradeneeded = () => {
        request.result.createObjectStore(STORE_NAME);
      };
      request.onsuccess = () => {
        const database = request.result;
        database.onversionchange = () => {
          database.close();
          databasePromise = undefined;
        };
        resolve(database);
      };
      request.onerror = () => reject(request.error);
      request.onblocked = () =>
        reject(new Error('Carrier label storage is blocked by another tab.'));
    }).catch((cause: unknown) => {
      databasePromise = undefined;
      throw new CarrierLabelError('storage-unavailable', 'Carrier label storage is unavailable.', {
        cause,
      });
    });
  }
  return databasePromise;
}

export const browserCarrierLabelStore: CarrierLabelStore = {
  async read(id) {
    try {
      const database = await openDatabase();
      const saved = await new Promise<unknown>((resolve, reject) => {
        const transaction = database.transaction(STORE_NAME, 'readonly');
        const request = transaction.objectStore(STORE_NAME).get(id);
        transaction.oncomplete = () => resolve(request.result);
        transaction.onabort = () => reject(transaction.error);
        transaction.onerror = () => reject(transaction.error);
      });
      if (saved === undefined) return undefined;
      if (!(saved instanceof ArrayBuffer))
        throw new CarrierLabelError('corrupt-label', 'The saved carrier PDF is damaged.');
      return new Uint8Array(saved);
    } catch (cause) {
      if (cause instanceof CarrierLabelError) throw cause;
      throw new CarrierLabelError('storage-unavailable', 'The carrier PDF could not be read.', {
        cause,
      });
    }
  },
  async write(id, bytes) {
    try {
      const database = await openDatabase();
      await new Promise<void>((resolve, reject) => {
        const transaction = database.transaction(STORE_NAME, 'readwrite');
        transaction.objectStore(STORE_NAME).put(Uint8Array.from(bytes).buffer, id);
        transaction.oncomplete = () => resolve();
        transaction.onabort = () => reject(transaction.error);
        transaction.onerror = () => reject(transaction.error);
      });
    } catch (cause) {
      if (cause instanceof CarrierLabelError) throw cause;
      throw new CarrierLabelError(
        'storage-unavailable',
        'The carrier PDF could not be saved. Check available browser storage and try again.',
        { cause },
      );
    }
  },
};

async function sha256(bytes: Uint8Array): Promise<string> {
  const digest = await crypto.subtle.digest('SHA-256', Uint8Array.from(bytes).buffer);
  return Array.from(new Uint8Array(digest), (value) => value.toString(16).padStart(2, '0')).join(
    '',
  );
}

async function parsePdf(bytes: Uint8Array): Promise<PDFDocument> {
  if (bytes.byteLength > MAX_CARRIER_LABEL_BYTES)
    throw new CarrierLabelError('file-too-large', 'A carrier PDF must be 10 MB or smaller.');
  if (bytes.byteLength < 8 || new TextDecoder().decode(bytes.subarray(0, 5)) !== '%PDF-')
    throw new CarrierLabelError('invalid-pdf', 'Choose a valid, unencrypted carrier PDF.');
  let document: PDFDocument;
  try {
    document = await PDFDocument.load(bytes, {
      ignoreEncryption: false,
      throwOnInvalidObject: true,
      updateMetadata: false,
    });
    if (document.isEncrypted || document.getPageCount() === 0)
      throw new Error('The PDF has no printable pages or is encrypted.');
    for (const page of document.getPages()) {
      const { width, height } = page.getSize();
      if (![width, height].every((value) => Number.isFinite(value) && value > 0))
        throw new Error('The PDF page size is invalid.');
    }
  } catch (cause) {
    throw new CarrierLabelError('invalid-pdf', 'Choose a valid, unencrypted carrier PDF.', {
      cause,
    });
  }
  if (document.getPageCount() > MAX_CARRIER_LABEL_PAGES)
    throw new CarrierLabelError('too-many-pages', 'A carrier PDF may contain at most 20 pages.');
  return document;
}

function validMetadata(label: OrderLabel): boolean {
  return (
    !!label &&
    typeof label.id === 'string' &&
    /^[A-Za-z0-9_.-]{1,100}$/.test(label.id) &&
    !['__proto__', 'constructor', 'prototype'].includes(label.id) &&
    typeof label.name === 'string' &&
    label.name.trim().length > 0 &&
    label.name.length <= 255 &&
    Number.isInteger(label.size) &&
    label.size > 0 &&
    label.size <= MAX_CARRIER_LABEL_BYTES &&
    typeof label.sha256 === 'string' &&
    /^[a-f0-9]{64}$/.test(label.sha256) &&
    label.id === `label-${label.sha256}` &&
    typeof label.addedAt === 'string' &&
    Number.isFinite(Date.parse(label.addedAt))
  );
}

function pdfName(input: string): string {
  const safe = input
    .replace(/[\u0000-\u001f\u007f/\\]/g, '_')
    .trim()
    .slice(0, 236);
  if (!safe) return 'carrier-label.pdf';
  return /\.pdf$/i.test(safe) ? safe : `${safe}.pdf`;
}

export async function importCarrierLabelBytes(
  source: Uint8Array,
  name = 'carrier-label.pdf',
  store: CarrierLabelStore = browserCarrierLabelStore,
): Promise<OrderLabel> {
  if (source.byteLength > MAX_CARRIER_LABEL_BYTES)
    throw new CarrierLabelError('file-too-large', 'A carrier PDF must be 10 MB or smaller.');
  // Keep a private byte copy while hashing and writing so callers cannot mutate the saved PDF.
  const bytes = Uint8Array.from(source);
  await parsePdf(bytes);
  const hash = await sha256(bytes);
  const label: OrderLabel = {
    id: `label-${hash}`,
    name: pdfName(name),
    size: bytes.byteLength,
    sha256: hash,
    addedAt: new Date().toISOString(),
  };
  await store.write(label.id, bytes);
  return label;
}

/** Saves an uploaded carrier-issued PDF unchanged. This does not certify its tracking barcode. */
export async function importCarrierLabel(
  file: Blob & { name?: string },
  store: CarrierLabelStore = browserCarrierLabelStore,
): Promise<OrderLabel> {
  if (file.size > MAX_CARRIER_LABEL_BYTES)
    throw new CarrierLabelError('file-too-large', 'A carrier PDF must be 10 MB or smaller.');
  return importCarrierLabelBytes(new Uint8Array(await file.arrayBuffer()), file.name, store);
}

export async function readCarrierLabel(
  label: OrderLabel,
  store: CarrierLabelStore = browserCarrierLabelStore,
): Promise<Uint8Array> {
  if (!validMetadata(label))
    throw new CarrierLabelError('corrupt-label', 'The saved carrier PDF reference is invalid.');
  const bytes = await store.read(label.id);
  if (!bytes)
    throw new CarrierLabelError(
      'missing-label',
      `The PDF “${label.name}” is missing from this browser. Restore a backup containing labels or attach the carrier PDF again.`,
    );
  if (bytes.byteLength !== label.size || (await sha256(bytes)) !== label.sha256)
    throw new CarrierLabelError(
      'corrupt-label',
      `The PDF “${label.name}” does not match its saved reference. Attach the carrier PDF again.`,
    );
  return Uint8Array.from(bytes);
}

/** Concatenates original carrier pages without resizing, redrawing, or generating barcodes. */
export async function buildCarrierLabelPdf(
  labels: readonly OrderLabel[],
  store: CarrierLabelStore = browserCarrierLabelStore,
): Promise<Uint8Array> {
  if (!labels.length || labels.length > MAX_BATCH_LABELS)
    throw new CarrierLabelError('batch-limit', 'Select between 1 and 50 carrier PDFs to print.');
  if (new Set(labels.map((label) => label.id)).size !== labels.length)
    throw new CarrierLabelError(
      'batch-limit',
      'The same carrier PDF is attached to more than one selected order.',
    );
  if (labels.reduce((total, label) => total + label.size, 0) > MAX_BATCH_BYTES)
    throw new CarrierLabelError(
      'batch-limit',
      'The selected carrier PDFs exceed the 50 MB batch limit.',
    );
  const merged = await PDFDocument.create();
  let count = 0;
  for (const label of labels) {
    const original = await parsePdf(await readCarrierLabel(label, store));
    count += original.getPageCount();
    if (count > MAX_BATCH_LABEL_PAGES)
      throw new CarrierLabelError('batch-limit', 'A print batch may contain at most 200 pages.');
    for (const page of await merged.copyPages(original, original.getPageIndices()))
      merged.addPage(page);
  }
  merged.setTitle('Carrier shipping labels');
  return merged.save();
}

function referencedLabels(workspace: Workspace): OrderLabel[] {
  const labels = new Map<string, OrderLabel>();
  for (const order of workspace.orders ?? []) {
    if (!order.label) continue;
    if (!validMetadata(order.label))
      throw new CarrierLabelError(
        'corrupt-label',
        'An order has an invalid carrier PDF reference.',
      );
    const existing = labels.get(order.label.id);
    if (existing && (existing.sha256 !== order.label.sha256 || existing.size !== order.label.size))
      throw new CarrierLabelError(
        'corrupt-label',
        'Carrier PDF references contain a conflicting ID.',
      );
    labels.set(order.label.id, order.label);
  }
  return [...labels.values()];
}

function encodeBase64(bytes: Uint8Array): string {
  let binary = '';
  const chunkSize = 32768;
  for (let start = 0; start < bytes.length; start += chunkSize)
    binary += String.fromCharCode(...bytes.subarray(start, start + chunkSize));
  return btoa(binary);
}

function decodeBase64(value: unknown, expectedSize: number): Uint8Array {
  if (
    typeof value !== 'string' ||
    value.length !== 4 * Math.ceil(expectedSize / 3) ||
    !/^[A-Za-z0-9+/]*={0,2}$/.test(value)
  )
    throw new CarrierLabelError(
      'invalid-backup',
      'A carrier PDF in the backup has invalid file data.',
    );
  const binary = atob(value);
  const bytes = Uint8Array.from(binary, (character) => character.charCodeAt(0));
  if (bytes.length !== expectedSize)
    throw new CarrierLabelError(
      'invalid-backup',
      'A carrier PDF in the backup has an invalid size.',
    );
  return bytes;
}

/** Portable workspace backup: includes PDF bytes for active and trashed orders. */
export async function exportWorkspaceWithLabels(
  workspace: Workspace,
  store: CarrierLabelStore = browserCarrierLabelStore,
): Promise<string> {
  const serialized = serializeWorkspace(workspace);
  const labels = referencedLabels(workspace);
  if (labels.length > 1000 || labels.reduce((sum, label) => sum + label.size, 0) > MAX_BACKUP_BYTES)
    throw new CarrierLabelError('backup-limit', 'Carrier PDFs exceed the 100 MB backup limit.');
  const files: { id: string; data: string }[] = [];
  for (const label of labels)
    files.push({ id: label.id, data: encodeBase64(await readCarrierLabel(label, store)) });
  return JSON.stringify(
    { format: BACKUP_FORMAT, version: 1, workspace: serialized, labels: files },
    null,
    2,
  );
}

export interface PreparedWorkspaceLabelRestore {
  workspace: Workspace;
  /** Store PDF blobs only after the operator confirms workspace replacement. */
  commitLabels(): Promise<void>;
}

/** Validate and stage a complete backup without changing browser storage. */
export async function prepareWorkspaceLabelRestore(
  input: unknown,
  store: CarrierLabelStore = browserCarrierLabelStore,
): Promise<PreparedWorkspaceLabelRestore> {
  if (!input || typeof input !== 'object' || Array.isArray(input))
    throw new CarrierLabelError('invalid-backup', 'The workspace backup is invalid.');
  const raw = input as Record<string, unknown>;
  if (raw.format === undefined) {
    const legacy = deserializeWorkspace(input);
    // Plain older backups have no PDFs. Existing references are safe only if their bytes are
    // already present in this browser; otherwise ask for the portable label backup explicitly.
    for (const label of referencedLabels(legacy)) await readCarrierLabel(label, store);
    return {
      workspace: legacy,
      async commitLabels() {
        // Re-check at confirmation: the browser may have evicted a PDF during preview.
        for (const label of referencedLabels(legacy)) await readCarrierLabel(label, store);
      },
    };
  }
  if (raw.format !== BACKUP_FORMAT || raw.version !== 1 || !Array.isArray(raw.labels))
    throw new CarrierLabelError('invalid-backup', 'This label backup format is not supported.');
  const workspace = deserializeWorkspace(raw.workspace);
  const labels = referencedLabels(workspace);
  if (labels.length > 1000 || labels.reduce((sum, label) => sum + label.size, 0) > MAX_BACKUP_BYTES)
    throw new CarrierLabelError('backup-limit', 'Carrier PDFs exceed the 100 MB backup limit.');
  if (raw.labels.length !== labels.length)
    throw new CarrierLabelError(
      'invalid-backup',
      'The backup does not contain every referenced carrier PDF.',
    );
  const metadata = new Map(labels.map((label) => [label.id, label]));
  const validated: { id: string; bytes: Uint8Array }[] = [];
  const seen = new Set<string>();
  for (const entry of raw.labels) {
    if (!entry || typeof entry !== 'object' || Array.isArray(entry))
      throw new CarrierLabelError('invalid-backup', 'A carrier PDF in the backup is invalid.');
    const file = entry as Record<string, unknown>;
    if (typeof file.id !== 'string' || seen.has(file.id) || !metadata.has(file.id))
      throw new CarrierLabelError(
        'invalid-backup',
        'The backup contains an unexpected carrier PDF.',
      );
    seen.add(file.id);
    const label = metadata.get(file.id)!;
    const bytes = decodeBase64(file.data, label.size);
    if ((await sha256(bytes)) !== label.sha256)
      throw new CarrierLabelError(
        'invalid-backup',
        'A carrier PDF in the backup failed its integrity check.',
      );
    await parsePdf(bytes);
    validated.push({ id: file.id, bytes });
  }
  return {
    workspace,
    async commitLabels() {
      // Content-addressed IDs cannot legitimately point at different bytes. Check every
      // collision before adding any files so an inconsistent store remains untouched.
      const missing: typeof validated = [];
      for (const { id, bytes } of validated) {
        const existing = await store.read(id);
        if (!existing) missing.push({ id, bytes });
        else if (
          existing.byteLength !== bytes.byteLength ||
          (await sha256(existing)) !== id.slice(6)
        )
          throw new CarrierLabelError(
            'corrupt-label',
            'An existing carrier PDF conflicts with this backup. The saved PDF was preserved.',
          );
      }
      for (const { id, bytes } of missing) await store.write(id, bytes);
    },
  };
}

/** Convenience for an already-authorized restore. UI previews should use prepare first. */
export async function restoreWorkspaceWithLabels(
  input: unknown,
  store: CarrierLabelStore = browserCarrierLabelStore,
): Promise<Workspace> {
  const prepared = await prepareWorkspaceLabelRestore(input, store);
  await prepared.commitLabels();
  return prepared.workspace;
}
