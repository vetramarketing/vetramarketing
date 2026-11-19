/** Metadata only. Credentials and temporary upload tokens never belong in a workspace. */
export interface CloudinaryImage {
  provider: 'cloudinary';
  cloudName: string;
  assetId: string;
  publicId: string;
  version: number;
  format: 'jpg' | 'png' | 'webp';
  width: number;
  height: number;
  bytes: number;
}

export const CATALOG_IMAGE_LIMITS = {
  maxUploadBytes: 5 * 1024 * 1024,
  maxDimension: 4096,
  productPreviewEdge: 1600,
  logoPreviewEdge: 512,
  mimeTypes: ['image/jpeg', 'image/png', 'image/webp'],
  formats: ['jpg', 'png', 'webp'],
} as const;

const segment = /^[a-zA-Z0-9_.-]{1,100}$/;
export function validMediaSegment(value: unknown): value is string {
  return (
    typeof value === 'string' &&
    segment.test(value) &&
    !['.', '..', '__proto__', 'constructor', 'prototype'].includes(value)
  );
}
export function validMediaFolder(value: unknown): value is string {
  return (
    typeof value === 'string' && value.length <= 200 && value.split('/').every(validMediaSegment)
  );
}
export function validCloudName(value: unknown): value is string {
  return typeof value === 'string' && /^[a-z0-9_-]{1,63}$/.test(value);
}

/** Only canonical, versioned originals are stored; display transformations can be added later. */
export function cloudinaryImageUrl(image: CloudinaryImage): string {
  return `https://res.cloudinary.com/${image.cloudName}/image/upload/v${image.version}/${image.publicId}.${image.format}`;
}

function positiveInteger(value: unknown, maximum: number): value is number {
  return typeof value === 'number' && Number.isSafeInteger(value) && value > 0 && value <= maximum;
}

/** Structural validation is not proof of ownership. The future server must verify each upload. */
export function validateCloudinaryImage(input: unknown, imageUrl: string): CloudinaryImage {
  if (!input || typeof input !== 'object' || Array.isArray(input))
    throw new Error('Invalid Cloudinary image metadata.');
  const raw = input as Record<string, unknown>;
  if (
    raw.provider !== 'cloudinary' ||
    !validCloudName(raw.cloudName) ||
    !validMediaSegment(raw.assetId) ||
    !validMediaFolder(raw.publicId) ||
    !positiveInteger(raw.version, Number.MAX_SAFE_INTEGER) ||
    !CATALOG_IMAGE_LIMITS.formats.includes(raw.format as CloudinaryImage['format']) ||
    !positiveInteger(raw.width, CATALOG_IMAGE_LIMITS.maxDimension) ||
    !positiveInteger(raw.height, CATALOG_IMAGE_LIMITS.maxDimension) ||
    !positiveInteger(raw.bytes, CATALOG_IMAGE_LIMITS.maxUploadBytes)
  )
    throw new Error('Invalid Cloudinary image metadata.');
  const image: CloudinaryImage = {
    provider: 'cloudinary',
    cloudName: raw.cloudName,
    assetId: raw.assetId,
    publicId: raw.publicId,
    version: raw.version,
    format: raw.format as CloudinaryImage['format'],
    width: raw.width,
    height: raw.height,
    bytes: raw.bytes,
  };
  if (imageUrl !== cloudinaryImageUrl(image))
    throw new Error('Cloudinary metadata does not match the image URL.');
  return image;
}

/** Manual URL replacement detaches metadata, never deletes an asset remotely. */
export function retainCloudinaryImage(
  image: CloudinaryImage | undefined,
  nextUrl: string,
): CloudinaryImage | undefined {
  return image && nextUrl === cloudinaryImageUrl(image) ? { ...image } : undefined;
}
