import { validateWorkspace } from './data';
import { validateAuthorizedWorkspaceId } from './mongodb-catalog';
import type { BusinessType, Customer, Workspace } from './types';

export type CustomerDocument = Customer & { workspaceId: string };
export type BusinessTypeDocument = BusinessType & { workspaceId: string };

/** Future authenticated adapters scope every customer and profile to its workspace. */
export const CUSTOMER_INDEXES = {
  businessTypes: [
    { key: { workspaceId: 1, id: 1 }, name: 'business_type_identity', unique: true },
    { key: { workspaceId: 1, sortOrder: 1, id: 1 }, name: 'business_type_order' },
  ],
  customers: [
    { key: { workspaceId: 1, id: 1 }, name: 'customer_identity', unique: true },
    { key: { workspaceId: 1, companyId: 1, deletedAt: 1, name: 1 }, name: 'customer_company_list' },
    { key: { workspaceId: 1, companyId: 1, lastContactOn: 1 }, name: 'customer_last_contact' },
    { key: { workspaceId: 1, 'domains.expiresOn': 1 }, name: 'customer_domain_expiry' },
  ],
} as const;

export function prepareCustomerDocuments(
  workspace: Workspace,
  authorizedWorkspaceId: string,
): {
  businessTypes: BusinessTypeDocument[];
  customers: CustomerDocument[];
} {
  validateAuthorizedWorkspaceId(authorizedWorkspaceId);
  const valid = validateWorkspace(workspace);
  return {
    businessTypes: valid.businessTypes.map((type) => ({
      ...type,
      workspaceId: authorizedWorkspaceId,
    })),
    customers: valid.customers.map((customer) => ({
      ...customer,
      workspaceId: authorizedWorkspaceId,
    })),
  };
}
