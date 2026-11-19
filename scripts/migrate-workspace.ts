import { createHash } from 'node:crypto';
import { readFile, stat } from 'node:fs/promises';
import { isDeepStrictEqual } from 'node:util';
import {
  MAX_LABEL_BACKUP_TEXT_BYTES,
  prepareWorkspaceLabelRestore,
  readCarrierLabel,
} from '../src/lib/order-labels';
import { cloudinaryImageUrl } from '../src/lib/cloudinary-media';
import { serializeWorkspace, type StoredWorkspaceV12 } from '../src/lib/workspace-storage';
import {
  closeWorkspaceMongoDb,
  getWorkspaceMongoDb,
  readMongoWorkspace,
  writeMongoWorkspace,
} from '../src/lib/server/mongo-workspace';
import { mongoLabelStore } from '../src/lib/server/mongo-labels';
import { verifyCloudinaryConfiguration } from '../src/lib/server/workspace-media';

function verifyReadback(source: StoredWorkspaceV12, saved: StoredWorkspaceV12) {
  // Substitute only the two deliberate media field changes before comparing every business field.
  const comparable = structuredClone(saved);
  function checkImage(
    original: string,
    url: string,
    asset: Parameters<typeof cloudinaryImageUrl>[0] | undefined,
  ) {
    if (original ? !asset || url !== cloudinaryImageUrl(asset) : url !== '' || asset)
      throw new Error('The saved catalog image differs from the migration plan.');
  }
  for (const [index, product] of comparable.products.entries()) {
    const original = source.products[index];
    checkImage(original.imageUrl, product.imageUrl, product.imageAsset);
    product.imageUrl = original.imageUrl;
    delete product.imageAsset;
    if (original.imageAsset) product.imageAsset = original.imageAsset;
  }
  for (const [index, company] of comparable.companies.entries()) {
    const original = source.companies[index];
    checkImage(original.logoImageUrl ?? '', company.logoImageUrl ?? '', company.logoAsset);
    company.logoImageUrl = original.logoImageUrl;
    delete company.logoAsset;
    if (original.logoAsset) company.logoAsset = original.logoAsset;
  }
  if (
    !isDeepStrictEqual(JSON.parse(JSON.stringify(source)), JSON.parse(JSON.stringify(comparable)))
  )
    throw new Error('MongoDB readback differs from the migration source.');
}

async function main() {
  const [file, mode, ...extra] = process.argv.slice(2);
  if (!file || extra.length || (mode && !['--apply', '--verify'].includes(mode)))
    throw new Error('Usage: migrate-workspace <backup.json> [--apply | --verify]');
  if ((await stat(file)).size > MAX_LABEL_BACKUP_TEXT_BYTES)
    throw new Error('Backup exceeds size limit.');
  const backup = JSON.parse(await readFile(file, 'utf8'));
  const db = await getWorkspaceMongoDb();
  const labels = mongoLabelStore(db);
  const prepared = await prepareWorkspaceLabelRestore(backup, labels);
  const source = serializeWorkspace(prepared.workspace);
  const raw = backup.workspace ?? backup;
  if (raw.version === 12 && !isDeepStrictEqual(raw, JSON.parse(JSON.stringify(source))))
    throw new Error(
      'The current-format backup would change during normalization. Review it before importing.',
    );
  const sourceHash = createHash('sha256').update(JSON.stringify(source)).digest('hex');
  const counts = Object.fromEntries(
    Object.entries(source).flatMap(([key, value]) =>
      Array.isArray(value) ? [[key, value.length]] : [],
    ),
  );
  const images =
    source.products.filter((p) => p.imageUrl).length +
    source.companies.filter((c) => c.logoImageUrl).length;
  if (images) await verifyCloudinaryConfiguration();
  const existing = await readMongoWorkspace();
  if (existing && existing.migrationSourceDigest !== sourceHash)
    throw new Error('MongoDB already contains a workspace initialized from another source.');
  console.log(
    JSON.stringify({
      database: db.databaseName,
      counts,
      images,
      carrierPdfs: new Set(
        (prepared.workspace.orders ?? []).flatMap((o) => (o.label ? [o.label.id] : [])),
      ).size,
      sourceHash,
    }),
  );
  if (!mode) {
    console.log('Preflight passed.');
    return;
  }
  if (!existing && mode === '--apply') {
    await prepared.commitLabels();
    await writeMongoWorkspace({
      workspace: source,
      expectedRevision: null,
      operationId: 'migrate-' + sourceHash,
    });
  }
  const saved = await readMongoWorkspace();
  if (!saved || saved.migrationSourceDigest !== sourceHash)
    throw new Error('Migration receipt is missing.');
  verifyReadback(source, saved.workspace);
  for (const order of prepared.workspace.orders ?? [])
    if (order.label) await readCarrierLabel(order.label, labels);
  console.log(
    'Verified every workspace field and referenced carrier PDF. Revision ' + saved.revision,
  );
}

main()
  .catch((error) => {
    // Service errors can contain a URI or user content. Print only known-safe categories.
    if (
      error instanceof Error &&
      error.constructor === Error &&
      !/[:][/][/]|password/i.test(error.message)
    )
      console.error(error.message);
    else
      console.error(
        'Migration failed (' + (error instanceof Error ? error.name : 'unknown error') + ').',
      );
    process.exitCode = 1;
  })
  .finally(closeWorkspaceMongoDb);
