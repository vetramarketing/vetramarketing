import { validateWorkspace } from './data';
import type { Product, Company, Workspace } from './types';
import type { CatalogImageCommit } from './catalog-media-contract';

/** Driver-independent documents for the future authenticated server adapter. */
export type ProductDocument = Product & { workspaceId: string };
export type CompanyDocument = Company & { workspaceId: string };
export type ProductInput = Pick<Product, 'name' | 'imageUrl' | 'companyIds' | 'sortOrder'>;
export type CompanyInput = Pick<
  Company,
  'name' | 'businessTypeId' | 'logoImageUrl' | 'ownerName' | 'sortOrder'
>;

export type CatalogSaveRequest = {
  expectedRevision: string;
  operationId: string;
  /** Server verifies this token and attaches metadata; clients cannot submit trusted asset IDs. */
  imageUpload?: CatalogImageCommit;
} & (
  | { collection: 'products'; id: string; value: ProductInput }
  | { collection: 'companies'; id: string; value: CompanyInput }
);

/** Apply once on the server after reviewing imported IDs; names are not unique IDs. */
export const CATALOG_INDEXES = {
  products: [
    { key: { workspaceId: 1, id: 1 }, name: 'product_identity', unique: true },
    { key: { workspaceId: 1, deletedAt: 1, sortOrder: 1, id: 1 }, name: 'product_display_order' },
    { key: { workspaceId: 1, companyIds: 1, deletedAt: 1 }, name: 'product_company_lookup' },
  ],
  companies: [
    { key: { workspaceId: 1, id: 1 }, name: 'company_identity', unique: true },
    { key: { workspaceId: 1, sortOrder: 1, id: 1 }, name: 'company_display_order' },
  ],
} as const;

export function validateAuthorizedWorkspaceId(value: string): string {
  if (
    !/^[a-zA-Z0-9_.-]{1,100}$/.test(value) ||
    ['__proto__', 'constructor', 'prototype'].includes(value)
  )
    throw new Error('A valid authorized workspace ID is required.');
  return value;
}

/** Pure preparation only: no connection or upload. Authorization belongs to the API. */
export function prepareCatalogDocuments(
  workspace: Workspace,
  authorizedWorkspaceId: string,
): {
  products: ProductDocument[];
  companies: CompanyDocument[];
} {
  validateAuthorizedWorkspaceId(authorizedWorkspaceId);
  const valid = validateWorkspace(workspace);
  return {
    products: valid.products.map((product) => ({ ...product, workspaceId: authorizedWorkspaceId })),
    companies: valid.companies.map((company) => ({
      ...company,
      workspaceId: authorizedWorkspaceId,
    })),
  };
}
