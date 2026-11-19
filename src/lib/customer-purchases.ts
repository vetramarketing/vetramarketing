import type { Order } from './orders';
import type { Customer } from './types';

export interface CustomerPurchases {
  total: number;
  byProduct: Map<string, number>;
  productNames: Map<string, string>;
}

export type CustomerPurchaseIndex = ReadonlyMap<string, CustomerPurchases>;

export function countsPurchasedUnits(order: Order): boolean {
  return !order.deletedAt && order.status !== 'cancelled' && order.shipment?.mode !== 'training';
}

/** Count only orders linked by ID to a customer in the same company. */
export function buildCustomerPurchaseIndex(
  orders: readonly Order[],
  customers: readonly Pick<Customer, 'id' | 'companyId'>[],
): CustomerPurchaseIndex {
  const companies = new Map(customers.map((customer) => [customer.id, customer.companyId]));
  const index = new Map<string, CustomerPurchases>();
  for (const order of orders) {
    const id = order.customerId;
    if (!id || companies.get(id) !== order.companyId || !countsPurchasedUnits(order)) continue;
    if (!order.items.length) continue;
    const purchases = index.get(id) ?? { total: 0, byProduct: new Map(), productNames: new Map() };
    for (const item of order.items) {
      purchases.total += item.quantity;
      if (!item.productId) continue;
      purchases.byProduct.set(
        item.productId,
        (purchases.byProduct.get(item.productId) ?? 0) + item.quantity,
      );
      purchases.productNames.set(item.productId, item.name);
    }
    index.set(id, purchases);
  }
  return index;
}
