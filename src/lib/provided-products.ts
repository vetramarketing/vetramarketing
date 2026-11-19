import { nextSortOrder } from './catalog';
import { ESHAN_HONEY_IMAGE } from './catalog-images';
import type { Product, Workspace } from './types';
import {
  WorkspaceRevisionConflict,
  type WorkspaceRepository,
  type WorkspaceSnapshot,
} from './workspace-repository';

export const ESHAN_PRODUCT_UPDATE = 'eshan-coffee-honey-320g-2026-10-17';
export const ESHAN_POST_ASSIGNMENT_UPDATE = 'eshan-current-posts-2026-10-17';
export const ESHAN_PRODUCT: Product = {
  id: 'product-eshan-coffee-honey-320g',
  name: 'น้ำผึ้งดอกกาแฟ ESHAN 320g',
  imageUrl: ESHAN_HONEY_IMAGE,
  sortOrder: 0,
};

/** A catalog may already contain this product under a user-created ID. */
export function eshanProductId(workspace: Workspace): string | undefined {
  return (
    workspace.products.find((product) => product.id === ESHAN_PRODUCT.id)?.id ??
    workspace.products.find((product) => product.name.trim() === ESHAN_PRODUCT.name)?.id
  );
}

/** A completed update stays completed even after the product is renamed or removed. */
export function addProvidedProducts(workspace: Workspace): Workspace {
  if (workspace.appliedDataUpdates?.includes(ESHAN_PRODUCT_UPDATE)) return workspace;
  const existing = workspace.products.find(
    (product) => product.id === ESHAN_PRODUCT.id || product.name.trim() === ESHAN_PRODUCT.name,
  );
  if (!existing && workspace.products.length >= 10000) throw new Error('Product catalog is full.');
  const products = existing
    ? workspace.products.map((product) =>
        product.id === existing.id && !product.deletedAt && !product.imageUrl
          ? { ...product, imageUrl: ESHAN_HONEY_IMAGE }
          : product,
      )
    : [...workspace.products, { ...ESHAN_PRODUCT, sortOrder: nextSortOrder(workspace.products) }];
  return {
    ...workspace,
    products,
    appliedDataUpdates: [...(workspace.appliedDataUpdates ?? []), ESHAN_PRODUCT_UPDATE],
  };
}

/** Apply the requested bulk assignment once, preserving later edits and new posts. */
export function assignCurrentPostsToEshan(workspace: Workspace): Workspace {
  if (workspace.appliedDataUpdates?.includes(ESHAN_POST_ASSIGNMENT_UPDATE)) return workspace;
  const productId = eshanProductId(workspace);
  return {
    ...workspace,
    posts: workspace.posts.map((post) => ({
      ...post,
      product: ESHAN_PRODUCT.name,
      ...(productId ? { productId } : {}),
    })),
    appliedDataUpdates: [...(workspace.appliedDataUpdates ?? []), ESHAN_POST_ASSIGNMENT_UPDATE],
  };
}

/** Persist the requested catalog and post updates in one revision-checked write. */
export async function ensureProvidedProducts(
  repository: WorkspaceRepository,
  initial: WorkspaceSnapshot,
): Promise<WorkspaceSnapshot> {
  let snapshot = initial;
  for (let attempt = 0; attempt < 3; attempt += 1) {
    const workspace = assignCurrentPostsToEshan(addProvidedProducts(snapshot.workspace));
    if (workspace === snapshot.workspace) return snapshot;
    try {
      return await repository.commit({
        workspace,
        expectedRevision: snapshot.revision,
        operationId: ESHAN_POST_ASSIGNMENT_UPDATE,
      });
    } catch (error) {
      if (!(error instanceof WorkspaceRevisionConflict)) throw error;
      snapshot = await repository.load();
    }
  }
  throw new WorkspaceRevisionConflict();
}
