import { newCustomer } from './customer-data';
import type { Order } from './orders';
import { emptyShippingAddress, validShippingPhone, type ShippingAddress } from './shipping-address';
import type { Customer } from './types';

export function recipientForCustomer(customer: Customer): ShippingAddress {
  if (customer.recipient) return { ...customer.recipient };
  return {
    ...emptyShippingAddress(),
    phone: validShippingPhone(customer.phone) ? customer.phone : '',
  };
}

/** Prepare the customer and order for the same workspace commit. */
export function syncOrderCustomer(customers: Customer[], order: Order, original?: Order) {
  const keys = Object.keys(order.recipient) as (keyof ShippingAddress)[];
  if (!order.customerId) {
    const name = order.customerName.trim();
    const unchangedManualEntry =
      original &&
      !original.customerId &&
      original.companyId === order.companyId &&
      original.customerName === order.customerName &&
      keys.every((key) => original.recipient[key] === order.recipient[key]);
    if (!name || unchangedManualEntry) return { customers, order };
    const customer: Customer = {
      ...newCustomer(order.companyId, order.updatedAt),
      name,
      phone: order.recipient.phone,
      ...(keys.some((key) => order.recipient[key].trim()) && { recipient: { ...order.recipient } }),
    };
    return { customers: [...customers, customer], order: { ...order, customerId: customer.id } };
  }

  const customer = customers.find(
    (item) => item.id === order.customerId && item.companyId === order.companyId && !item.deletedAt,
  );
  // Orders can outlive their original customer records.
  if (!customer) return { customers, order };
  const editingSameCustomer =
    original?.customerId === customer.id && original.companyId === order.companyId;
  const recipient = recipientForCustomer(customer);
  let changed = false;
  for (const key of keys) {
    const next = order.recipient[key];
    // Seed a missing delivery profile, then keep later status edits from replaying old addresses.
    if (customer.recipient && editingSameCustomer) {
      if (original.recipient[key] === next) continue;
    } else if (!next.trim()) continue;
    if (recipient[key] !== next || !customer.recipient) {
      recipient[key] = next;
      changed = true;
    }
  }
  if (!changed) return { customers, order };
  const updated = {
    ...customer,
    recipient,
    phone: customer.phone || recipient.phone,
    updatedAt: new Date(
      Math.max(Date.parse(customer.updatedAt), Date.parse(order.updatedAt)),
    ).toISOString(),
  };
  return { customers: customers.map((item) => (item === customer ? updated : item)), order };
}
