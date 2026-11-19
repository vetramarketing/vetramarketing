import { createHash } from 'node:crypto';
import { readFile } from 'node:fs/promises';
import { join } from 'node:path';
import { BUNDLED_CATALOG_IMAGES } from '../catalog-images';
import {
  parseCloudinaryUploadMetadata,
  planCatalogImageUpload,
  type CatalogMediaTarget,
  type CatalogUploadPlan,
} from '../catalog-media-contract';
import {
  CATALOG_IMAGE_LIMITS,
  cloudinaryImageUrl,
  validCloudName,
  validMediaFolder,
  type CloudinaryImage,
} from '../cloudinary-media';
import type { Workspace } from '../types';

export type MediaOptions = {
  previous?: Workspace;
  env?: Record<string, string | undefined>;
  fetch?: typeof fetch;
  staged?: (url: string, target: CatalogMediaTarget) => Promise<VerifiedImage | null>;
};
export type VerifiedImage = { imageUrl: string; imageAsset: CloudinaryImage };

function configuration(env: Record<string, string | undefined>) {
  const cloudName = env.CLOUDINARY_CLOUD_NAME?.trim();
  const folder = env.CLOUDINARY_UPLOAD_FOLDER?.trim() || 'vetra-marketing';
  const preset = env.CLOUDINARY_UPLOAD_PRESET?.trim();
  const key = env.CLOUDINARY_API_KEY?.trim();
  const secret = env.CLOUDINARY_API_SECRET?.trim();
  if (!validCloudName(cloudName) || !validMediaFolder(folder) || !preset || !key || !secret)
    throw new Error(
      'Configure the Cloudinary cloud name, API credentials, signed preset and valid folder.',
    );
  return {
    cloudName,
    folder,
    preset,
    key,
    secret,
    base: `https://api.cloudinary.com/v1_1/${cloudName}`,
  };
}

type Config = ReturnType<typeof configuration>;

function adminRequest(config: Config, path: string, request: typeof fetch) {
  return request(config.base + path, {
    headers: {
      Authorization: `Basic ${Buffer.from(config.key + ':' + config.secret).toString('base64')}`,
    },
    redirect: 'error',
    cache: 'no-store',
    signal: AbortSignal.timeout(30000),
  });
}

/** Read-only credential and preset check, suitable for a preflight before initializing MongoDB. */
export async function verifyCloudinaryConfiguration(options: MediaOptions = {}) {
  const config = configuration(options.env ?? process.env);
  const response = await adminRequest(
    config,
    '/upload_presets/' + encodeURIComponent(config.preset),
    options.fetch ?? fetch,
  );
  if (!response.ok)
    throw new Error(`Could not read the Cloudinary upload preset (HTTP ${response.status}).`);
  const preset = await response.json();
  if (preset.name !== config.preset || preset.unsigned !== false)
    throw new Error('Select a signed Cloudinary upload preset for catalog images.');
  return { cloudName: config.cloudName, preset: config.preset, folder: config.folder };
}

function digest(data: string | Buffer) {
  return createHash('sha256').update(data).digest('hex');
}

async function readAsset(plan: CatalogUploadPlan, config: Config, request: typeof fetch) {
  const response = await adminRequest(
    config,
    '/resources/image/upload/' + encodeURIComponent(plan.publicId) + '?context=true',
    request,
  );
  if (response.status === 404) return null;
  if (!response.ok)
    throw new Error(`Cloudinary image verification failed (HTTP ${response.status}).`);
  return response.json();
}

async function submitImage(
  config: Config,
  plan: CatalogUploadPlan,
  source: string | Blob,
  sourceDigest: string,
  request: typeof fetch,
) {
  const params: Record<string, string> = {
    allowed_formats: CATALOG_IMAGE_LIMITS.formats.join(','),
    context: `vetra_source=${sourceDigest}`,
    overwrite: 'false',
    public_id: plan.publicId,
    timestamp: String(Math.floor(Date.now() / 1000)),
    upload_preset: config.preset,
  };
  const form = signedForm(params, config);
  form.set('file', source);
  // Cloudinary retrieves external sources. Our server never connects to user-supplied origins.
  const response = await request(config.base + '/image/upload', {
    method: 'POST',
    body: form,
    redirect: 'error',
    signal: AbortSignal.timeout(120000),
  });
  if (!response.ok) throw new Error(`Cloudinary image upload failed (HTTP ${response.status}).`);
  await response.arrayBuffer();
}

function signedForm(params: Record<string, string>, config: Config) {
  const signed = Object.keys(params)
    .sort()
    .map((key) => `${key}=${params[key]}`)
    .join('&');
  const form = new FormData();
  for (const [key, value] of Object.entries(params)) form.set(key, value);
  form.set('signature', digest(signed + config.secret));
  form.set('api_key', config.key);
  return form;
}

export function directUploadPlan(
  scope: string,
  target: CatalogMediaTarget,
  id: string,
  options: MediaOptions,
) {
  return planCatalogImageUpload(
    configuration(options.env ?? process.env),
    'direct-' + scope,
    {
      ...target,
      recordId:
        target.recordId.length > 48 ? digest(target.recordId).slice(0, 32) : target.recordId,
    },
    'u-' + id,
  );
}

/** The random ownership marker is minted and persisted by the server before contacting Cloudinary. */
export async function uploadPreparedImage(
  plan: CatalogUploadPlan,
  bytes: Buffer,
  mime: string,
  marker: string,
  options: MediaOptions,
) {
  const config = configuration(options.env ?? process.env);
  if (config.cloudName !== plan.cloudName) throw new Error('The configured cloud has changed.');
  const request = options.fetch ?? fetch;
  let resource = await readAsset(plan, config, request);
  if (!resource) {
    await verifyCloudinaryConfiguration(options);
    await submitImage(
      config,
      plan,
      new Blob([Uint8Array.from(bytes)], { type: mime }),
      marker,
      request,
    );
    resource = await readAsset(plan, config, request);
  }
  if (!resource || resource.context?.custom?.vetra_source !== marker)
    throw new Error('The uploaded image could not be verified.');
  const image = parseCloudinaryUploadMetadata(resource, plan);
  await verifyBundledBytes(image.imageAsset, bytes, request);
  return image;
}

export async function deletePreparedImage(
  plan: CatalogUploadPlan,
  marker: string,
  assetId: string | undefined,
  options: MediaOptions,
) {
  const config = configuration(options.env ?? process.env);
  if (config.cloudName !== plan.cloudName) throw new Error('The configured cloud has changed.');
  const request = options.fetch ?? fetch;
  const resource = await readAsset(plan, config, request);
  if (!resource) return 'absent';
  if (
    resource.context?.custom?.vetra_source !== marker ||
    resource.public_id !== plan.publicId ||
    resource.resource_type !== 'image' ||
    resource.type !== 'upload' ||
    typeof resource.asset_id !== 'string' ||
    !resource.asset_id ||
    (assetId && resource.asset_id !== assetId)
  )
    throw new Error('The provider could not verify ownership of this upload.');
  const body = signedForm(
    {
      asset_id: resource.asset_id,
      invalidate: 'true',
      timestamp: String(Math.floor(Date.now() / 1000)),
    },
    config,
  );
  const response = await request(config.base + '/image/destroy', {
    method: 'POST',
    body,
    redirect: 'error',
    signal: AbortSignal.timeout(30000),
  });
  if (!response.ok || !['ok', 'not found'].includes((await response.json()).result))
    throw new Error('Image cleanup failed.');
  return 'deleted';
}

async function verifyBundledBytes(image: CloudinaryImage, bytes: Buffer, request: typeof fetch) {
  if (image.bytes !== bytes.length)
    throw new Error('Cloudinary changed the size of the bundled image.');
  const res = await request(cloudinaryImageUrl(image), {
    redirect: 'error',
    cache: 'no-store',
    signal: AbortSignal.timeout(30000),
  });
  if (!res.ok || !res.body)
    throw new Error('The uploaded catalog image could not be downloaded for verification.');
  const reader = res.body.getReader();
  const hash = createHash('sha256');
  let received = 0;
  for (;;) {
    const { done, value } = await reader.read();
    if (done) break;
    received += value.length;
    if (received > bytes.length) {
      await reader.cancel();
      throw new Error('Cloudinary returned a different catalog image.');
    }
    hash.update(value);
  }
  if (received !== bytes.length || hash.digest('hex') !== digest(bytes))
    throw new Error('Cloudinary returned a different catalog image.');
}

async function migrateImage(
  source: string,
  previousAsset: CloudinaryImage | undefined,
  workspaceId: string,
  target: CatalogMediaTarget,
  config: Config,
  request: typeof fetch,
) {
  const prefix = `${config.folder}/${workspaceId}/`;
  if (
    previousAsset?.cloudName === config.cloudName &&
    previousAsset.publicId.startsWith(prefix) &&
    cloudinaryImageUrl(previousAsset) === source
  ) {
    const plan: CatalogUploadPlan = {
      cloudName: config.cloudName,
      publicId: previousAsset.publicId,
      resourceType: 'image',
      deliveryType: 'upload',
      overwrite: false,
    };
    const raw = await readAsset(plan, config, request);
    if (!raw) throw new Error('A referenced Cloudinary image is missing.');
    const verified = parseCloudinaryUploadMetadata(raw, plan);
    if (verified.imageUrl !== source || verified.imageAsset.assetId !== previousAsset.assetId)
      throw new Error('A referenced Cloudinary asset changed since it was saved.');
    return verified;
  }
  let sourceBytes: Buffer | undefined;
  if (BUNDLED_CATALOG_IMAGES.includes(source)) {
    sourceBytes = await readFile(
      join(process.cwd(), 'public', decodeURIComponent(source.slice(1))),
    );
    if (!sourceBytes.length || sourceBytes.length > CATALOG_IMAGE_LIMITS.maxUploadBytes)
      throw new Error('The bundled catalog image is empty or too large.');
  } else {
    const url = new URL(source);
    if (url.protocol !== 'https:' || url.username || url.password)
      throw new Error('External catalog images require an HTTPS URL without credentials.');
  }
  const sourceDigest = digest(sourceBytes ?? source);
  const plan = planCatalogImageUpload(config, workspaceId, target, sourceDigest);
  let resource = await readAsset(plan, config, request);
  if (!resource) {
    await submitImage(
      config,
      plan,
      sourceBytes ? new Blob([Uint8Array.from(sourceBytes)]) : source,
      sourceDigest,
      request,
    );
    resource = await readAsset(plan, config, request);
  }
  if (!resource || resource.context?.custom?.vetra_source !== sourceDigest)
    throw new Error('Cloudinary could not confirm the expected source for the catalog image.');
  const verified = parseCloudinaryUploadMetadata(resource, plan);
  if (sourceBytes) await verifyBundledBytes(verified.imageAsset, sourceBytes, request);
  return verified;
}

/** Run on a validated workspace. Only the database can supply the previous verified snapshot. */
export async function migrateWorkspaceMedia(
  workspace: Workspace,
  workspaceId: string,
  options: MediaOptions = {},
): Promise<Workspace> {
  const request = options.fetch ?? fetch;
  const env = options.env ?? process.env;
  let config: Config | undefined;
  async function migrate(
    url: string,
    claimed: CloudinaryImage | undefined,
    trusted: CloudinaryImage | undefined,
    target: CatalogMediaTarget,
  ) {
    if (!url) return undefined;
    if (trusted && cloudinaryImageUrl(trusted) === url)
      return { imageUrl: url, imageAsset: trusted };
    const staged = await options.staged?.(url, target);
    if (staged) return staged;
    if (!config) {
      config = configuration(env);
      await verifyCloudinaryConfiguration({ env, fetch: request });
    }
    return migrateImage(url, claimed, workspaceId, target, config, request);
  }

  const savedProducts = new Map(options.previous?.products.map((row) => [row.id, row.imageAsset]));
  const savedCompanies = new Map(options.previous?.companies.map((row) => [row.id, row.logoAsset]));
  const products = [];
  for (const product of workspace.products) {
    const media = await migrate(
      product.imageUrl,
      product.imageAsset,
      savedProducts.get(product.id),
      { collection: 'products', field: 'imageUrl', recordId: product.id },
    );
    products.push(media ? { ...product, ...media } : product);
  }
  const companies = [];
  for (const company of workspace.companies) {
    const media = await migrate(
      company.logoImageUrl,
      company.logoAsset,
      savedCompanies.get(company.id),
      { collection: 'companies', field: 'logoImageUrl', recordId: company.id },
    );
    companies.push(
      media ? { ...company, logoImageUrl: media.imageUrl, logoAsset: media.imageAsset } : company,
    );
  }
  return { ...workspace, products, companies };
}
