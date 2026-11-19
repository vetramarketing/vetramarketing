import {
  CATALOG_IMAGE_LIMITS,
  validateCloudinaryImage,
  type CloudinaryImage,
} from './cloudinary-media';
import { pngFrameMode, validatePreparedCatalogFile } from './catalog-media-contract';
import { workspaceApiFetch } from './workspace-api-fetch';

export type CatalogKind = 'products' | 'companies';
export interface PreparedCatalogImage {
  file: Blob;
  width: number;
  height: number;
}

export function catalogImageDimensions(width: number, height: number, kind: CatalogKind) {
  const edge =
    kind === 'products'
      ? CATALOG_IMAGE_LIMITS.productPreviewEdge
      : CATALOG_IMAGE_LIMITS.logoPreviewEdge;
  const scale = Math.min(1, edge / Math.max(width, height));
  return {
    width: Math.max(1, Math.round(width * scale)),
    height: Math.max(1, Math.round(height * scale)),
  };
}

export class PreparationError extends Error {
  constructor(readonly reason: 'format' | 'size' | 'input-size' | 'animated' | 'decode') {
    super(reason);
  }
}

const maxSourceBytes = 32 * 1024 * 1024;
const maxSourcePixels = 50_000_000;

function checkDimensions(width: number, height: number) {
  if (!width || !height) throw new PreparationError('decode');
  if (width * height > maxSourcePixels) throw new PreparationError('input-size');
}

export async function inspectCatalogImage(file: File): Promise<string> {
  if (file.size > maxSourceBytes) throw new PreparationError('input-size');
  const bytes = new Uint8Array(await file.arrayBuffer());
  if (bytes.length < 12) throw new PreparationError('format');
  const view = new DataView(bytes.buffer);
  const tag = (offset: number) => view.getUint32(offset);
  if (bytes[0] === 255 && bytes[1] === 216 && bytes[2] === 255) {
    let offset = 2;
    while (offset + 4 <= bytes.length && bytes[offset] === 255) {
      while (bytes[offset] === 255) offset++;
      const marker = bytes[offset++];
      if (offset + 2 > bytes.length) break;
      const length = view.getUint16(offset);
      if (length < 2 || offset + length > bytes.length) break;
      if (marker >= 0xc0 && marker <= 0xcf && ![0xc4, 0xc8, 0xcc].includes(marker) && length >= 8) {
        checkDimensions(view.getUint16(offset + 5), view.getUint16(offset + 3));
        return 'image/jpeg';
      }
      offset += length;
    }
    throw new PreparationError('decode');
  }
  if (
    tag(0) === 0x89504e47 &&
    tag(4) === 0x0d0a1a0a &&
    bytes.length >= 33 &&
    tag(12) === 0x49484452
  ) {
    checkDimensions(tag(16), tag(20));
    const frames = pngFrameMode(bytes);
    if (frames === 'animated') throw new PreparationError('animated');
    if (frames === 'invalid') throw new PreparationError('decode');
    return 'image/png';
  }
  if (tag(0) === 0x52494646 && tag(8) === 0x57454250 && bytes.length >= 25) {
    const kind = tag(12);
    if (kind === 0x56503858 && bytes.length >= 30) {
      // VP8X
      if (bytes[20] & 2) throw new PreparationError('animated');
      const uint24 = (i: number) => bytes[i] + bytes[i + 1] * 256 + bytes[i + 2] * 65536;
      checkDimensions(uint24(24) + 1, uint24(27) + 1);
    } else if (kind === 0x56503820 && bytes.length >= 30) {
      // VP8 frame
      checkDimensions(view.getUint16(26, true) & 0x3fff, view.getUint16(28, true) & 0x3fff);
    } else if (kind === 0x5650384c) {
      // VP8L
      const bits = view.getUint32(21, true);
      checkDimensions(1 + (bits & 0x3fff), 1 + ((bits >>> 14) & 0x3fff));
    } else throw new PreparationError('decode');
    return 'image/webp';
  }
  throw new PreparationError('format');
}

async function encode(canvas: HTMLCanvasElement, type: string) {
  try {
    return await new Promise<Blob | null>((resolve) =>
      canvas.toBlob(
        (blob) => resolve(blob?.type === type && blob.size > 0 ? blob : null),
        type,
        0.94,
      ),
    );
  } catch {
    return null;
  }
}

export async function prepareCatalogImage(
  file: File,
  kind: CatalogKind,
): Promise<PreparedCatalogImage> {
  const sourceType = await inspectCatalogImage(file);
  const original = file.type === sourceType ? file : file.slice(0, file.size, sourceType);
  const url = URL.createObjectURL(original);
  const image = new Image();
  try {
    image.src = url;
    await image.decode();
    checkDimensions(image.naturalWidth, image.naturalHeight);
    const dimensions = catalogImageDimensions(image.naturalWidth, image.naturalHeight, kind);
    const resized =
      image.naturalWidth !== dimensions.width || image.naturalHeight !== dimensions.height;
    const originalFits = !resized && original.size <= CATALOG_IMAGE_LIMITS.maxUploadBytes;
    const canvas = document.createElement('canvas');
    canvas.width = dimensions.width;
    canvas.height = dimensions.height;
    const ctx = canvas.getContext('2d', { alpha: true });
    if (!ctx) {
      if (originalFits) return { file: original, ...dimensions };
      throw new PreparationError('decode');
    }
    ctx.imageSmoothingQuality = 'high';
    ctx.drawImage(image, 0, 0, canvas.width, canvas.height);
    const webp = await encode(canvas, 'image/webp');
    let prepared = webp;
    if (originalFits && (!webp || original.size <= webp.size)) prepared = original;
    if (!originalFits) {
      const fallbackType = sourceType === 'image/jpeg' ? 'image/jpeg' : 'image/png';
      const fallback = await encode(canvas, fallbackType);
      if (fallback && (!prepared || fallback.size < prepared.size)) prepared = fallback;
    }
    if (!prepared || prepared.size > CATALOG_IMAGE_LIMITS.maxUploadBytes)
      throw new PreparationError('size');
    return { file: prepared, ...dimensions };
  } finally {
    URL.revokeObjectURL(url);
  }
}

interface UploadedImage {
  imageUrl: string;
  imageAsset: CloudinaryImage;
}
const maxRetries = 2;

/** One editor selection. Keep its bytes while retrying, and its verified upload while retrying the database save. */
export class CatalogFileSubmission {
  private id = crypto.randomUUID();
  private attempted = false;
  private uploadFailures = 0;
  private saveFailures = 0;
  uploaded?: UploadedImage;

  constructor(
    private kind: CatalogKind,
    private recordId: string,
    private file: Blob,
    private request: typeof fetch = workspaceApiFetch,
  ) {}

  async stage() {
    if (this.uploaded) return this.uploaded;
    validatePreparedCatalogFile(this.file);
    this.attempted = true;
    try {
      const response = await this.request(
        `/api/workspace/media/${this.kind}/${encodeURIComponent(this.recordId)}`,
        {
          method: 'PUT',
          headers: { 'Content-Type': this.file.type, 'X-Submission-Id': this.id },
          body: this.file,
          cache: 'no-store',
          signal: AbortSignal.timeout(180000),
        },
      );
      if (!response.ok) throw new Error('Image upload failed.');
      const result = await response.json();
      if (result.submissionId !== this.id || typeof result.imageUrl !== 'string')
        throw new Error('Unexpected image submission.');
      this.uploaded = {
        imageUrl: result.imageUrl,
        imageAsset: validateCloudinaryImage(result.imageAsset, result.imageUrl),
      };
      this.uploadFailures = 0;
      return this.uploaded;
    } catch (error) {
      if (++this.uploadFailures > maxRetries) await this.abandon();
      throw error;
    }
  }

  async saveFailed() {
    if (this.uploaded && ++this.saveFailures > maxRetries) await this.abandon();
  }

  async abandon() {
    if (!this.attempted) return;
    const abandonedId = this.id;
    this.id = crypto.randomUUID();
    this.uploaded = undefined;
    this.attempted = false;
    this.uploadFailures = this.saveFailures = 0;
    // The server checks ownership, in-flight saves and Trash. Its manual cleanup can retry on failure.
    await this.request(`/api/workspace/media/cleanup?submissionId=${abandonedId}`, {
      method: 'POST',
      signal: AbortSignal.timeout(15000),
    }).catch(() => undefined);
  }
}
