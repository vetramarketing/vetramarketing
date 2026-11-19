import {
  CATALOG_IMAGE_LIMITS,
  validCloudName,
  validMediaFolder,
  validMediaSegment,
  validateCloudinaryImage,
  type CloudinaryImage,
} from './cloudinary-media';

export type CatalogMediaTarget =
  | { collection: 'products'; recordId: string; field: 'imageUrl' }
  | { collection: 'companies'; recordId: string; field: 'logoImageUrl' };

/** Ephemeral submission data, deliberately excluded from persisted records and backups. */
export interface StagedCatalogImage {
  submissionId: string;
  target: CatalogMediaTarget;
  imageUrl: string;
  imageAsset: CloudinaryImage;
  uploadToken: string;
  expiresAt: string;
}

export interface CatalogImageCommit {
  submissionId: string;
  uploadToken: string;
}

export interface CatalogUploadPlan {
  cloudName: string;
  publicId: string;
  resourceType: 'image';
  deliveryType: 'upload';
  overwrite: false;
}

/** Call only after authenticating and authorizing the target on the server. No signing or I/O. */
export function planCatalogImageUpload(
  configuration: { cloudName: string; folder: string },
  authorizedWorkspaceId: string,
  target: CatalogMediaTarget,
  submissionId: string,
): CatalogUploadPlan {
  if (!validCloudName(configuration.cloudName) || !validMediaFolder(configuration.folder))
    throw new Error('Invalid Cloudinary configuration.');
  if (
    !validMediaSegment(authorizedWorkspaceId) ||
    !validMediaSegment(target.recordId) ||
    !validMediaSegment(submissionId)
  )
    throw new Error('Invalid catalog upload identity.');
  if (
    !(target.collection === 'products' && target.field === 'imageUrl') &&
    !(target.collection === 'companies' && target.field === 'logoImageUrl')
  )
    throw new Error('Invalid catalog image target.');
  const publicId = `${configuration.folder}/${authorizedWorkspaceId}/${target.collection}/${target.recordId}/${submissionId}`;
  if (!validMediaFolder(publicId)) throw new Error('Catalog upload path is too long.');
  return {
    cloudName: configuration.cloudName,
    publicId,
    resourceType: 'image',
    deliveryType: 'upload',
    overwrite: false,
  };
}

/** APNG declares acTL before the first IDAT. Some native PNG decoders only expose frame one. */
export function pngFrameMode(bytes: Uint8Array): 'still' | 'animated' | 'invalid' {
  const view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
  let offset = 8;
  while (offset + 12 <= view.byteLength) {
    const end = offset + 12 + view.getUint32(offset);
    if (end > view.byteLength) return 'invalid';
    const type = view.getUint32(offset + 4);
    if (type === 0x6163544c) return 'animated'; // acTL
    if (type === 0x49444154) return 'still'; // IDAT
    offset = end;
  }
  return 'invalid';
}

/** Client-side convenience only; the server/provider must inspect actual uploaded file bytes. */
export function validatePreparedCatalogFile(file: { type: string; size: number }): void {
  if (
    !CATALOG_IMAGE_LIMITS.mimeTypes.includes(
      file.type as (typeof CATALOG_IMAGE_LIMITS.mimeTypes)[number],
    ) ||
    !Number.isSafeInteger(file.size) ||
    file.size <= 0 ||
    file.size > CATALOG_IMAGE_LIMITS.maxUploadBytes
  ) {
    throw new Error('Choose a prepared JPEG, PNG, or WebP image up to 5 MB.');
  }
}

/** Parse provider metadata AFTER server verification; a browser response alone is not trusted. */
export function parseCloudinaryUploadMetadata(
  input: unknown,
  plan: CatalogUploadPlan,
): { imageUrl: string; imageAsset: CloudinaryImage } {
  if (!input || typeof input !== 'object' || Array.isArray(input))
    throw new Error('Invalid Cloudinary upload response.');
  const raw = input as Record<string, unknown>;
  if (
    raw.resource_type !== plan.resourceType ||
    raw.type !== plan.deliveryType ||
    raw.public_id !== plan.publicId ||
    typeof raw.secure_url !== 'string'
  )
    throw new Error('Cloudinary upload does not match this submission.');
  const imageAsset = validateCloudinaryImage(
    {
      provider: 'cloudinary',
      cloudName: plan.cloudName,
      assetId: raw.asset_id,
      publicId: raw.public_id,
      version: raw.version,
      format: raw.format,
      width: raw.width,
      height: raw.height,
      bytes: raw.bytes,
    },
    raw.secure_url,
  );
  return { imageUrl: raw.secure_url, imageAsset };
}
