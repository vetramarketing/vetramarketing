import { bangkokCalendarNow } from './calendar';
import { buildCustomerPurchaseIndex } from './customer-purchases';
import {
  MAX_ORDER_QUANTITY,
  nextOrderNumber,
  prepareOrderSave,
  validateOrder,
  validateOrderSequences,
  type Order,
} from './orders';
import type { Workspace } from './types';

/** Import legacy counts once. Later versions only convert the opening entries already present. */
export function migrateCustomerOrderQuantities(
  workspace: Workspace,
  seedLegacyCustomers = true,
): Workspace {
  const orders = workspace.orders ?? [];
  const hasOpenings = orders.some((order) => order.quantitySource === 'opening');
  if (!hasOpenings && !seedLegacyCustomers) return workspace;
  const customers = new Map(workspace.customers.map((customer) => [customer.id, customer]));
  const importedCustomers = new Set<string>();
  const sequences = validateOrderSequences(workspace.orderSequences, orders);
  const numbers = new Set(orders.map((order) => order.number.toUpperCase()));
  let undatedSequence = 0;
  function allocateNumber(orderedOn: string): string {
    let number: string;
    do {
      if (orderedOn) {
        number = nextOrderNumber([], orderedOn, sequences);
        sequences[orderedOn.replaceAll('-', '')] = Number(number.split('-')[2]);
      } else {
        number = 'VT-UNDATED-' + String(++undatedSequence).padStart(5, '0');
      }
    } while (numbers.has(number));
    numbers.add(number);
    return number;
  }
  const converted = orders.map((order) => {
    if (order.quantitySource !== 'opening' && order.quantitySource !== 'imported') return order;
    const customer = order.customerId ? customers.get(order.customerId) : undefined;
    const sameCompany = customer?.companyId === order.companyId;
    if (customer && sameCompany) importedCustomers.add(customer.id);
    if (order.quantitySource === 'imported') return order;
    const orderedOn = (sameCompany ? customer?.lastContactOn : '') || order.orderedOn;
    return {
      ...order,
      quantitySource: 'imported' as const,
      number: allocateNumber(orderedOn),
      orderedOn,
    };
  });
  const toSeed = seedLegacyCustomers
    ? workspace.customers.filter((customer) => !importedCustomers.has(customer.id))
    : [];
  if (!hasOpenings && !toSeed.length) return workspace;
  if (toSeed.length) {
    const totals = buildCustomerPurchaseIndex(orders, workspace.customers);
    const products = new Map(workspace.products.map((product) => [product.id, product]));
    const ids = new Set(orders.map((order) => order.id));
    let sequence = 0;
    for (const customer of toSeed) {
      const purchased = totals.get(customer.id)?.byProduct;
      const items = Object.entries(customer.productQuantities ?? {}).map(
        ([productId, recorded]) => {
          const product = products.get(productId);
          if (!product) throw new Error('A customer order references a missing product.');
          return {
            id: productId,
            productId,
            name: product.name,
            quantity: Math.max(0, recorded - (purchased?.get(productId) ?? 0)),
          };
        },
      );
      let id: string;
      do {
        id = 'customer-opening-' + ++sequence;
      } while (ids.has(id));
      const orderedOn = customer.lastContactOn;
      converted.push(
        validateOrder({
          id,
          number: allocateNumber(orderedOn),
          quantitySource: 'imported',
          status: 'ordered',
          orderedOn,
          companyId: customer.companyId,
          customerId: customer.id,
          customerName: customer.name,
          items,
          createdAt: customer.updatedAt,
          updatedAt: customer.updatedAt,
        }),
      );
    }
  }
  return { ...workspace, orders: converted, orderSequences: sequences };
}

/** Optional product context never infers a catalog identity from an item name. */
export function customerProductOrderHistory(
  workspace: Workspace,
  customerId: string,
  productId?: string,
): { order: Order; quantity: number }[] {
  const customer = workspace.customers.find((item) => item.id === customerId);
  if (!customer) return [];
  const filterProduct = productId && productId !== 'all';
  const entries: { order: Order; quantity: number }[] = [];
  for (const order of workspace.orders ?? []) {
    if (
      order.customerId !== customerId ||
      order.companyId !== customer.companyId ||
      order.deletedAt ||
      order.shipment?.mode === 'training'
    )
      continue;
    const items = filterProduct
      ? order.items.filter((item) => item.productId === productId)
      : order.items;
    if (filterProduct && !items.length) continue;
    entries.push({ order, quantity: items.reduce((sum, item) => sum + item.quantity, 0) });
  }
  return entries.sort(
    (a, b) =>
      b.order.orderedOn.localeCompare(a.order.orderedOn) ||
      Date.parse(b.order.createdAt) - Date.parse(a.order.createdAt) ||
      b.order.number.localeCompare(a.order.number),
  );
}

export function prepareCustomerQuantityOrder(
  workspace: Workspace,
  customerId: string,
  productId: string | undefined,
  quantity: number,
  now = new Date(),
): Workspace {
  return prepareCustomerQuantityOrderItems(workspace, customerId, [{ productId, quantity }], now);
}

export function prepareCustomerQuantityOrderItems(
  workspace: Workspace,
  customerId: string,
  lines: readonly { productId?: string; quantity: number }[],
  now = new Date(),
): Workspace {
  if (
    lines.some(
      ({ quantity }) =>
        !Number.isSafeInteger(quantity) || quantity < 1 || quantity > MAX_ORDER_QUANTITY,
    )
  )
    throw new Error('Enter a whole-number quantity from 1 to 1000000.');
  const customer = workspace.customers.find((item) => item.id === customerId && !item.deletedAt);
  if (!customer) throw new Error('Choose an active customer belonging to this company.');
  const products = new Map(
    workspace.products.filter((item) => !item.deletedAt).map((item) => [item.id, item]),
  );
  const items = lines.map(({ productId, quantity }) => {
    const product = productId === undefined ? undefined : products.get(productId);
    if (productId !== undefined && !product)
      throw new Error('Choose active products belonging to this company.');
    return {
      id: crypto.randomUUID(),
      ...(product ? { productId: product.id } : {}),
      name: product?.name ?? 'Quantity',
      quantity,
    };
  });
  const orderedOn = bangkokCalendarNow('date', now);
  const timestamp = now.toISOString();
  const order = validateOrder({
    id: crypto.randomUUID(),
    number: nextOrderNumber(workspace.orders ?? [], orderedOn, workspace.orderSequences),
    companyId: customer.companyId,
    customerId,
    customerName: customer.name,
    quantitySource: 'quick',
    orderedOn,
    status: 'ordered',
    createdAt: timestamp,
    updatedAt: timestamp,
    items,
  });
  return prepareOrderSave(workspace, order);
}
