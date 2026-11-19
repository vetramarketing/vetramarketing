import { createHash, randomUUID } from 'node:crypto';
import { MongoServerError, type ClientSession, type Db } from 'mongodb';
import sharp from 'sharp';
import {
  type CatalogMediaTarget,
  type CatalogUploadPlan,
  pngFrameMode,
  validatePreparedCatalogFile,
} from '../catalog-media-contract';
import { CATALOG_IMAGE_LIMITS, validMediaSegment } from '../cloudinary-media';
import type { StoredWorkspaceV12 } from '../workspace-storage';
import {
  directUploadPlan,
  uploadPreparedImage,
  deletePreparedImage,
  type MediaOptions,
  type VerifiedImage,
} from './workspace-media';

const uuid = '[a-f0-9]{8}-[a-f0-9]{4}-4[a-f0-9]{3}-[89ab][a-f0-9]{3}-[a-f0-9]{12}';
export const validSubmissionId = (id: string) => new RegExp('^' + uuid + '$').test(id);
const abandonAfter = 60 * 60 * 1000;
const uploadLease = 10 * 60 * 1000;
type Stage = {
  _id: string;
  digest: string;
  marker: string;
  plan: CatalogUploadPlan;
  target: CatalogMediaTarget;
  state: 'pending' | 'ready' | 'committed' | 'deleting' | 'deleted';
  touchedAt: Date;
  leaseUntil: Date;
  image?: VerifiedImage;
};
const ledger = (db: Db) =>
  db.collection<Stage>('vetra_image_submissions', { writeConcern: { w: 'majority' } });
export class StageError extends Error {
  constructor(
    readonly code: string,
    readonly status: number,
  ) {
    super(code);
  }
}

export function catalogImageTarget(collection: string, recordId: string): CatalogMediaTarget {
  if (!validMediaSegment(recordId)) throw new StageError('INVALID_IMAGE_TARGET', 400);
  if (collection === 'companies') return { collection, recordId, field: 'logoImageUrl' };
  if (collection === 'products') return { collection, recordId, field: 'imageUrl' };
  throw new StageError('INVALID_IMAGE_TARGET', 400);
}

async function validateImage(bytes: Buffer, mime: string) {
  try {
    validatePreparedCatalogFile({ type: mime, size: bytes.byteLength });
    const matchesMagic =
      mime === 'image/jpeg'
        ? bytes[0] === 0xff && bytes[1] === 0xd8 && bytes[2] === 0xff
        : mime === 'image/png'
          ? bytes.subarray(0, 8).equals(Buffer.from('89504e470d0a1a0a', 'hex'))
          : bytes.toString('ascii', 0, 4) === 'RIFF' && bytes.toString('ascii', 8, 12) === 'WEBP';
    if (!matchesMagic || (mime === 'image/png' && pngFrameMode(bytes) !== 'still'))
      throw new Error();
    const edge = CATALOG_IMAGE_LIMITS.maxDimension;
    const image = sharp(bytes, { limitInputPixels: edge * edge, failOn: 'warning' });
    const properties = await image.metadata();
    if (
      'image/' + properties.format !== mime ||
      (properties.pages ?? 1) > 1 ||
      properties.width > edge ||
      properties.height > edge
    )
      throw new Error();
    // A valid header alone cannot establish that the complete image decodes.
    await image.stats();
  } catch {
    throw new StageError('INVALID_CATALOG_IMAGE', 422);
  }
}

export async function stageCatalogImage(
  db: Db,
  scope: string,
  target: CatalogMediaTarget,
  id: string,
  mime: string,
  bytes: Buffer,
  options: MediaOptions = {},
) {
  if (!validSubmissionId(id)) throw new StageError('INVALID_SUBMISSION_ID', 400);
  await validateImage(bytes, mime);
  if (
    !(await db
      .collection<{ _id: string }>('vetra_workspace')
      .findOne({ _id: 'vetra-marketing' }, { projection: { _id: 1 } }))
  )
    throw new StageError('WORKSPACE_NOT_INITIALIZED', 409);
  const plan = directUploadPlan(scope, target, id, options);
  const digest = createHash('sha256').update(bytes).digest('hex');
  const now = new Date();
  const initial: Stage = {
    _id: id,
    digest,
    marker: randomUUID(),
    plan,
    target,
    state: 'pending',
    touchedAt: now,
    leaseUntil: new Date(0),
  };
  const stages = ledger(db);
  try {
    await stages.insertOne(initial);
  } catch (error) {
    if (!(error instanceof MongoServerError && error.code === 11000)) throw error;
  }
  const stage = await stages.findOne({ _id: id });
  if (
    !stage ||
    stage.digest !== digest ||
    stage.plan.publicId !== plan.publicId ||
    stage.plan.cloudName !== plan.cloudName
  )
    throw new StageError('SUBMISSION_MISMATCH', 409);
  if (stage.state === 'ready' || stage.state === 'committed') {
    if (!stage.image) throw new StageError('IMAGE_VERIFICATION_FAILED', 503);
    const available = await stages.updateOne(
      { _id: id, state: { $in: ['ready', 'committed'] } },
      { $set: { touchedAt: now } },
    );
    if (!available.matchedCount) throw new StageError('SUBMISSION_UNAVAILABLE', 409);
    return { ...stage.image, submissionId: id };
  }
  const leaseUntil = new Date(now.getTime() + uploadLease);
  const locked = await stages.updateOne(
    { _id: id, state: 'pending', leaseUntil: { $lte: now } },
    { $set: { leaseUntil, touchedAt: now } },
  );
  if (!locked.matchedCount) throw new StageError('SUBMISSION_UNAVAILABLE', 409);
  try {
    const image = await uploadPreparedImage(plan, bytes, mime, stage.marker, options);
    const saved = await stages.updateOne(
      { _id: id, state: 'pending', leaseUntil },
      { $set: { state: 'ready', image, leaseUntil: new Date(0), touchedAt: new Date() } },
    );
    if (!saved.matchedCount) throw new StageError('SUBMISSION_UNAVAILABLE', 409);
    return { ...image, submissionId: id };
  } catch (error) {
    // Preserve the plan and marker even if Cloudinary accepted a request whose response was lost.
    await stages.updateOne(
      { _id: id, state: 'pending', leaseUntil },
      { $set: { leaseUntil: new Date(0), touchedAt: new Date() } },
    );
    throw error;
  }
}

function referencedIds(value: string) {
  return [...new Set(Array.from(value.matchAll(new RegExp('u-(' + uuid + ')', 'g')), (m) => m[1]))];
}

export async function resolveStagedImage(
  db: Db,
  url: string,
  target: CatalogMediaTarget,
): Promise<VerifiedImage | null> {
  // Imported record IDs can also start with u-UUID. Only the filename identifies the submission.
  const id = new RegExp('/u-(' + uuid + ')\\.(?:jpg|png|webp)$').exec(url)?.[1];
  if (!id) return null;
  const row = await ledger(db).findOne({ _id: id });
  if (!row || row.image?.imageUrl !== url) return null;
  if (row.state === 'committed') return row.image;
  if (
    row.state !== 'ready' ||
    row.target.collection !== target.collection ||
    row.target.recordId !== target.recordId
  )
    throw new StageError('SUBMISSION_UNAVAILABLE', 409);
  return row.image;
}

/** Every writer claims references (including URLs in other fields) within the workspace transaction. */
export async function commitStagedReferences(
  db: Db,
  session: ClientSession,
  workspace: StoredWorkspaceV12,
) {
  const ids = referencedIds(JSON.stringify(workspace));
  if (!ids.length) return;
  const stages = ledger(db);
  const known = await stages.find({ _id: { $in: ids } }, { session }).toArray();
  for (const stage of known) {
    if (stage.state === 'committed') continue;
    if (stage.state !== 'ready') throw new StageError('SUBMISSION_UNAVAILABLE', 409);
    const result = await stages.updateOne(
      { _id: stage._id, state: 'ready' },
      { $set: { state: 'committed' } },
      { session },
    );
    if (!result.matchedCount) throw new StageError('SUBMISSION_UNAVAILABLE', 409);
  }
}

type ReadForCleanup = (session: ClientSession) => Promise<StoredWorkspaceV12 | undefined>;
export async function cleanupStagedImages(
  db: Db,
  readWorkspace: ReadForCleanup,
  id: string | null,
  options: MediaOptions = {},
) {
  if (id !== null && !validSubmissionId(id)) throw new StageError('INVALID_SUBMISSION_ID', 400);
  const stages = ledger(db);
  const now = new Date();
  const cutoff = new Date(now.getTime() - abandonAfter);
  const candidates = stages.find(
    id
      ? { _id: id }
      : { state: { $in: ['pending', 'ready', 'deleting'] }, touchedAt: { $lte: cutoff } },
    { projection: { _id: 1 } },
  );
  const counts = { deleted: 0, protected: 0, failed: 0 };
  for await (const candidate of candidates) {
    try {
      const claimed = await db.client.withSession((session) =>
        session.withTransaction(
          async () => {
            const row = await stages.findOne({ _id: candidate._id }, { session });
            if (!row || row.state === 'deleted') return null;
            if (
              row.state === 'committed' ||
              row.leaseUntil > now ||
              (!id && row.touchedAt > cutoff)
            )
              return 'protected';
            const workspace = await readWorkspace(session);
            if (!workspace) return 'protected';
            if (referencedIds(JSON.stringify(workspace)).includes(row._id)) {
              await stages.updateOne(
                { _id: row._id },
                { $set: { state: 'committed' } },
                { session },
              );
              return 'protected';
            }
            await stages.updateOne({ _id: row._id }, { $set: { state: 'deleting' } }, { session });
            return row;
          },
          { readConcern: { level: 'snapshot' }, writeConcern: { w: 'majority' } },
        ),
      );
      if (!claimed) continue;
      if (claimed === 'protected') {
        counts.protected++;
        continue;
      }
      const result = await deletePreparedImage(
        claimed.plan,
        claimed.marker,
        claimed.image?.imageAsset.assetId,
        options,
      );
      if (result === 'absent' && !claimed.image && claimed.touchedAt > cutoff) {
        // A timed-out upload can still finish at the provider. A later sweep checks again.
        counts.protected++;
        continue;
      }
      await stages.updateOne(
        { _id: claimed._id, state: 'deleting' },
        { $set: { state: 'deleted' } },
      );
      if (result === 'deleted') counts.deleted++;
    } catch {
      counts.failed++;
    }
  }
  return counts;
}
