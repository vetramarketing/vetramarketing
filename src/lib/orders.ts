import type { Locale, Workspace } from './types';
import { validCustomerDate } from './customer-data';
import { entityEditIsCurrent } from './entity-edit';
import { effectiveProductCompanyIds } from './product-company';
import { syncOrderCustomer } from './order-customer';
import {
  emptyShippingAddress,
  validateShippingAddress,
  type ShippingAddress,
} from './shipping-address';
export {
  emptyShippingAddress,
  validateShippingAddress,
  type ShippingAddress,
} from './shipping-address';

export const CARRIER_IDS = ['flash', 'thailand-post', 'kex', 'jnt', 'dhl', 'other'] as const;
export type CarrierId = (typeof CARRIER_IDS)[number];
export const ORDER_STATUSES = [
  'ordered',
  'cod',
  'paid',
  'shipped',
  'completed',
  'cancelled',
] as const;
export type OrderStatus = (typeof ORDER_STATUSES)[number];
export type OrderPaymentMethod = 'transfer' | 'cash' | 'cod';
const legacyStatuses = ['draft', 'confirmed', 'shipped', 'completed', 'cancelled'] as const;
const legacyPaymentStatuses = ['unpaid', 'paid', 'refunded'] as const;
interface LegacyWorkflow {
  status: (typeof legacyStatuses)[number];
  paymentStatus: (typeof legacyPaymentStatuses)[number];
}
export interface OrderItem {
  id: string;
  productId?: string;
  /** Snapshot: later catalog edits must not rewrite the order. */
  name: string;
  quantity: number;
  unitPriceSatang: number;
}
export interface OrderLabel {
  id: string;
  name: string;
  size: number;
  sha256: string;
  addedAt: string;
}
export interface OrderShipment {
  source: 'flash-api';
  mode: 'training' | 'production';
  trackingNumber: string;
  bookedAt: string;
  requestId: string;
}
export interface Order {
  id: string;
  number: string;
  /** Quantity-only entries have no recorded prices, payment, or delivery details. */
  quantitySource?: 'opening' | 'imported' | 'quick';
  companyId: string;
  customerId?: string;
  customerName: string;
  orderedOn: string;
  items: OrderItem[];
  discountSatang: number;
  shippingSatang: number;
  paymentMethod: OrderPaymentMethod;
  status: OrderStatus;
  /** Original bookkeeping values from records created before the single-status workflow. */
  legacyWorkflow?: LegacyWorkflow;
  recipient: ShippingAddress;
  sender?: ShippingAddress;
  carrier: CarrierId;
  parcel: { weightGrams: number; widthCm: number; lengthCm: number; heightCm: number };
  trackingNumber?: string;
  label?: OrderLabel;
  shipment?: OrderShipment;
  notes: string;
  createdAt: string;
  updatedAt: string;
  deletedAt?: string;
}
export interface ShippingSettings {
  defaultCarrier: CarrierId;
  senders: Record<string, ShippingAddress>;
}

/** Persist only facts recorded in the customer quantity form. */
export function serializeOrder(order: Order) {
  if (!order.quantitySource) return order;
  const {
    id,
    number,
    quantitySource,
    companyId,
    customerId,
    customerName,
    orderedOn,
    status,
    createdAt,
    updatedAt,
    deletedAt,
  } = order;
  return {
    id,
    number,
    quantitySource,
    companyId,
    customerId,
    customerName,
    orderedOn,
    status,
    createdAt,
    updatedAt,
    ...(deletedAt ? { deletedAt } : {}),
    items: order.items.map(({ id, productId, name, quantity }) => ({
      id,
      ...(productId ? { productId } : {}),
      name,
      quantity,
    })),
  };
}

export const MAX_ORDER_MONEY_SATANG = 100_000_000_000;
export const MAX_ORDER_QUANTITY = 1_000_000;
export const MAX_ORDER_LABEL_BYTES = 10 * 1024 * 1024;
const paymentMethods = ['transfer', 'cash', 'cod'] as const;

export function defaultShippingSettings(): ShippingSettings {
  return { defaultCarrier: 'flash', senders: {} };
}

/** Decimal parsing avoids floating-point rounding and refuses silently rounded prices. */
export function parseMoneySatang(value: string): number | null {
  const match = /^(\d+)(?:\.(\d{1,2}))?$/.exec(value.trim());
  if (!match) return null;
  const result = Number(match[1]) * 100 + Number((match[2] ?? '').padEnd(2, '0'));
  return Number.isSafeInteger(result) && result <= MAX_ORDER_MONEY_SATANG ? result : null;
}
export function formatMoneySatang(value: number, locale: Locale = 'en'): string {
  return new Intl.NumberFormat(locale === 'th' ? 'th-TH' : 'en-US', {
    style: 'currency',
    currency: 'THB',
    currencyDisplay: 'narrowSymbol',
    minimumFractionDigits: 2,
    maximumFractionDigits: 2,
  }).format(value / 100);
}

function record(value: unknown, label: string): Record<string, unknown> {
  if (!value || typeof value !== 'object' || Array.isArray(value))
    throw new Error(`${label} must be an object.`);
  return value as Record<string, unknown>;
}
function text(
  value: unknown,
  label: string,
  limit: number,
  required = false,
  invalidCharacters = /[\u0000-\u0008\u000b\u000c\u000e-\u001f\u007f]/,
): string {
  if (
    typeof value !== 'string' ||
    value.length > limit ||
    (required && !value.trim()) ||
    invalidCharacters.test(value)
  )
    throw new Error(`${label} is invalid.`);
  return value;
}
function identifier(value: unknown, label: string): string {
  const result = text(value, label, 100, true);
  if (
    !/^[A-Za-z0-9_.-]+$/.test(result) ||
    ['__proto__', 'constructor', 'prototype'].includes(result)
  )
    throw new Error(`${label} is invalid.`);
  return result;
}
function list(value: unknown, label: string, max: number): unknown[] {
  if (!Array.isArray(value) || value.length > max)
    throw new Error(`${label} must contain at most ${max} items.`);
  return value;
}
function integer(value: unknown, label: string, max: number, min = 0): number {
  if (typeof value !== 'number' || !Number.isSafeInteger(value) || value < min || value > max)
    throw new Error(`${label} must be a whole number from ${min} to ${max}.`);
  return value;
}
function choice<T extends string>(value: unknown, choices: readonly T[], label: string): T {
  if (typeof value !== 'string' || !choices.includes(value as T))
    throw new Error(`${label} is invalid.`);
  return value as T;
}
function timestamp(value: unknown, label: string): string {
  const result = text(value, label, 40, true);
  if (
    !/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(?:\.\d{1,3})?(?:Z|[+-]\d{2}:\d{2})$/.test(result) ||
    !validCustomerDate(result.slice(0, 10)) ||
    !Number.isFinite(Date.parse(result))
  )
    throw new Error(`${label} must be a valid timestamp.`);
  return result;
}
function dateOnly(value: unknown, label: string): string {
  const result = text(value, label, 10, true);
  if (!validCustomerDate(result)) throw new Error(`${label} must be a valid YYYY-MM-DD date.`);
  return result;
}
function tracking(value: unknown): string {
  const result = text(value, 'Tracking number', 80);
  if (result && !/^[A-Za-z0-9][A-Za-z0-9_-]{2,79}$/.test(result))
    throw new Error('Tracking number must contain 3–80 letters, numbers, hyphens, or underscores.');
  return result;
}
export function orderTotals(
  order: Pick<Order, 'items' | 'discountSatang' | 'shippingSatang' | 'quantitySource'>,
) {
  let subtotalSatang = 0;
  for (const item of order.items) {
    const quantity = integer(
      item.quantity,
      'Item quantity',
      MAX_ORDER_QUANTITY,
      isImportedQuantity(order.quantitySource) ? 0 : 1,
    );
    const price = integer(item.unitPriceSatang, 'Unit price', MAX_ORDER_MONEY_SATANG);
    const amount = quantity * price;
    if (!Number.isSafeInteger(amount) || amount > MAX_ORDER_MONEY_SATANG - subtotalSatang)
      throw new Error('Order subtotal is too large.');
    subtotalSatang += amount;
  }
  const discountSatang = integer(order.discountSatang, 'Discount', MAX_ORDER_MONEY_SATANG);
  const shippingSatang = integer(order.shippingSatang, 'Shipping charge', MAX_ORDER_MONEY_SATANG);
  if (discountSatang > subtotalSatang)
    throw new Error('Discount cannot exceed the items subtotal.');
  const totalSatang = subtotalSatang - discountSatang + shippingSatang;
  if (totalSatang > MAX_ORDER_MONEY_SATANG) throw new Error('Order total is too large.');
  return { subtotalSatang, discountSatang, shippingSatang, totalSatang };
}

/** Only the legacy carrier connector requires sender, weight, and complete addresses. */
export function validateOrderForShipment(
  order: Order,
): asserts order is Order & { sender: ShippingAddress } {
  if (order.quantitySource)
    throw new Error('Quantity-only orders have no carrier booking details.');
  if (order.status === 'cancelled' || order.deletedAt)
    throw new Error('A cancelled or deleted order cannot be shipped.');
  if (!order.items.length) throw new Error('Add at least one order item.');
  orderTotals(order);
  if (!order.sender) throw new Error('Sender is required for carrier booking.');
  for (const [name, address] of [
    ['Sender', order.sender],
    ['Recipient', order.recipient],
  ] as const) {
    validateShippingAddress(address, name);
    if (Object.values(address).some((value) => !value.trim()))
      throw new Error(`${name} name, phone, and complete address are required.`);
    const digits = address.phone.replace(/\D/g, '');
    if (digits.length < 9 || digits.length > 15)
      throw new Error(`${name} phone must contain 9–15 digits.`);
  }
  integer(order.parcel.weightGrams, 'Parcel weight in grams', 1_000_000, 1);
}

function readWorkflow(source: Record<string, unknown>): Pick<Order, 'status' | 'legacyWorkflow'> {
  const migrating = source.paymentStatus !== undefined;
  const original = migrating ? source : source.legacyWorkflow;
  const legacy = original === undefined ? undefined : record(original, 'Original order workflow');
  const legacyWorkflow = legacy && {
    status: choice(legacy.status, legacyStatuses, 'Original order status'),
    paymentStatus: choice(legacy.paymentStatus, legacyPaymentStatuses, 'Original payment status'),
  };
  if (migrating && legacyWorkflow) {
    const { status, paymentStatus } = legacyWorkflow;
    if (status !== 'draft' && status !== 'confirmed') return { status, legacyWorkflow };
    if (paymentStatus === 'paid') return { status: 'paid', legacyWorkflow };
    if (source.paymentMethod === 'cod' && paymentStatus === 'unpaid')
      return { status: 'cod', legacyWorkflow };
    return { status: 'ordered', legacyWorkflow };
  }
  return {
    status: choice(source.status, ORDER_STATUSES, 'Order status'),
    ...(legacyWorkflow ? { legacyWorkflow } : {}),
  };
}

/** Older imports may contain a known zero, an unknown date, or no recorded items. */
function isImportedQuantity(source: Order['quantitySource']): boolean {
  return source === 'imported' || source === 'opening';
}

export function validateOrder(value: unknown, companyIds?: ReadonlySet<string>): Order {
  const raw = record(value, 'Order');
  const quantitySource =
    raw.quantitySource === undefined
      ? undefined
      : choice(
          raw.quantitySource,
          ['opening', 'imported', 'quick'] as const,
          'Quantity entry type',
        );
  // Expand compact quantity documents for shared workspace operations. serializeOrder
  // removes these empty form defaults again when writing the workspace or a backup.
  const source = quantitySource
    ? ({
        discountSatang: 0,
        shippingSatang: 0,
        recipient: emptyShippingAddress(),
        carrier: 'flash',
        parcel: { weightGrams: 0, widthCm: 0, lengthCm: 0, heightCm: 0 },
        notes: '',
        ...raw,
        paymentMethod: raw.status === 'cod' ? 'cod' : 'transfer',
      } as Record<string, unknown>)
    : raw;
  if (
    quantitySource &&
    (!source.customerId ||
      source.shipment !== undefined ||
      source.label !== undefined ||
      source.sender !== undefined ||
      source.trackingNumber !== undefined)
  )
    throw new Error('Quantity-only orders require a customer and cannot contain carrier bookings.');
  const companyId = identifier(source.companyId, 'Order company ID');
  if (companyIds && !companyIds.has(companyId))
    throw new Error('An order references a missing company.');
  const items = list(
    source.items,
    'Order items',
    isImportedQuantity(quantitySource) ? 10000 : 200,
  ).map((raw): OrderItem => {
    const item = record(raw, 'Order item');
    return {
      id: identifier(item.id, 'Order item ID'),
      ...(item.productId === undefined
        ? {}
        : { productId: identifier(item.productId, 'Order product ID') }),
      // Historical catalog labels allowed control characters other than NUL.
      // Preserve those snapshots when importing an existing product balance.
      name: text(item.name, 'Order item name', 200, true, quantitySource ? /\u0000/ : undefined),
      quantity: integer(
        item.quantity,
        'Item quantity',
        MAX_ORDER_QUANTITY,
        isImportedQuantity(quantitySource) ? 0 : 1,
      ),
      unitPriceSatang: integer(
        quantitySource && item.unitPriceSatang === undefined ? 0 : item.unitPriceSatang,
        'Unit price',
        quantitySource ? 0 : MAX_ORDER_MONEY_SATANG,
      ),
    };
  });
  if (new Set(items.map((item) => item.id)).size !== items.length)
    throw new Error('Order items contain duplicate IDs.');
  if (quantitySource === 'quick' && !items.length) throw new Error('Add at least one order item.');
  const parcel = record(source.parcel, 'Parcel');
  const result: Order = {
    id: identifier(source.id, 'Order ID'),
    number: text(source.number, 'Order number', 60, true),
    ...(quantitySource ? { quantitySource } : {}),
    companyId,
    ...(source.customerId === undefined
      ? {}
      : { customerId: identifier(source.customerId, 'Order customer ID') }),
    customerName: text(source.customerName, 'Customer name', 200),
    orderedOn:
      isImportedQuantity(quantitySource) && source.orderedOn === ''
        ? ''
        : dateOnly(source.orderedOn, 'Order date'),
    items,
    discountSatang: integer(
      source.discountSatang,
      'Discount',
      quantitySource ? 0 : MAX_ORDER_MONEY_SATANG,
    ),
    shippingSatang: integer(
      source.shippingSatang,
      'Shipping charge',
      quantitySource ? 0 : MAX_ORDER_MONEY_SATANG,
    ),
    paymentMethod: choice(source.paymentMethod, paymentMethods, 'Payment method'),
    ...readWorkflow(source),
    ...(source.sender === undefined
      ? {}
      : { sender: validateShippingAddress(source.sender, 'Sender') }),
    recipient: validateShippingAddress(source.recipient, 'Recipient'),
    carrier: choice(source.carrier, CARRIER_IDS, 'Carrier'),
    parcel: {
      weightGrams: integer(parcel.weightGrams, 'Parcel weight in grams', 1_000_000),
      widthCm: integer(parcel.widthCm, 'Parcel width in cm', 1000),
      lengthCm: integer(parcel.lengthCm, 'Parcel length in cm', 1000),
      heightCm: integer(parcel.heightCm, 'Parcel height in cm', 1000),
    },
    ...(source.trackingNumber === undefined
      ? {}
      : { trackingNumber: tracking(source.trackingNumber) }),
    notes: text(source.notes, 'Order notes', 10000),
    createdAt: timestamp(source.createdAt, 'Order creation date'),
    updatedAt: timestamp(source.updatedAt, 'Order update date'),
    ...(source.deletedAt === undefined
      ? {}
      : { deletedAt: timestamp(source.deletedAt, 'Order deletion date') }),
  };
  if (!/^[A-Za-z0-9][A-Za-z0-9._/-]{0,59}$/.test(result.number))
    throw new Error('Order number is invalid.');
  if (
    quantitySource &&
    (Object.values(result.recipient).some(Boolean) ||
      Object.values(result.parcel).some(Boolean) ||
      result.carrier !== 'flash' ||
      result.notes ||
      result.legacyWorkflow ||
      (raw.paymentMethod !== undefined &&
        raw.paymentMethod !== 'cod' &&
        raw.paymentMethod !== 'transfer'))
  )
    throw new Error('Quantity-only orders cannot contain extra payment or delivery details.');
  if (result.status === 'cod' && result.paymentMethod !== 'cod')
    throw new Error('COD status requires the cash-on-delivery payment method.');
  if (Date.parse(result.updatedAt) < Date.parse(result.createdAt))
    throw new Error('Order update date cannot precede its creation date.');
  if (source.label !== undefined) {
    const label = record(source.label, 'Order label');
    const sha256 = text(label.sha256, 'Label checksum', 64, true);
    if (!/^[a-f0-9]{64}$/.test(sha256)) throw new Error('Label checksum is invalid.');
    result.label = {
      id: identifier(label.id, 'Label ID'),
      name: text(label.name, 'Label filename', 255, true),
      size: integer(label.size, 'Label size', MAX_ORDER_LABEL_BYTES, 1),
      sha256,
      addedAt: timestamp(label.addedAt, 'Label date'),
    };
    if (!result.trackingNumber)
      throw new Error('Enter the carrier tracking number before attaching a label.');
  }
  if (source.shipment !== undefined) {
    const shipment = record(source.shipment, 'Shipment');
    result.shipment = {
      source: choice(shipment.source, ['flash-api'], 'Shipment source'),
      mode: choice(shipment.mode, ['training', 'production'], 'Shipment environment'),
      trackingNumber: tracking(shipment.trackingNumber),
      bookedAt: timestamp(shipment.bookedAt, 'Shipment booking date'),
      requestId: identifier(shipment.requestId, 'Shipment request ID'),
    };
    if (
      result.carrier !== 'flash' ||
      !result.trackingNumber ||
      result.shipment.trackingNumber !== result.trackingNumber
    )
      throw new Error('Shipment carrier or tracking number does not match this order.');
    if (result.status === 'cancelled')
      throw new Error('Cancel the carrier shipment before cancelling this order.');
    if (
      result.shipment.mode === 'training' &&
      (result.status === 'shipped' || result.status === 'completed')
    )
      throw new Error('A test shipment cannot be marked as shipped or completed.');
    validateOrderForShipment({ ...result, deletedAt: undefined });
  }
  orderTotals(result);
  return result;
}

export function validateOrders(value: unknown, companyIds: ReadonlySet<string>): Order[] {
  // Leave room for the opening balances of up to 10,000 existing customers.
  const orders = list(value === undefined ? [] : value, 'Orders', 30000).map((order) =>
    validateOrder(order, companyIds),
  );
  const ids = new Set<string>();
  const numbers = new Set<string>();
  const trackingNumbers = new Set<string>();
  const labelIds = new Set<string>();
  const labelHashes = new Set<string>();
  for (const order of orders) {
    if (ids.has(order.id)) throw new Error('Orders contain duplicate IDs.');
    if (numbers.has(order.number.toUpperCase()))
      throw new Error('Orders contain duplicate order numbers.');
    ids.add(order.id);
    numbers.add(order.number.toUpperCase());
    if (order.trackingNumber) {
      const key = `${order.carrier}:${order.trackingNumber.toUpperCase()}`;
      if (trackingNumbers.has(key))
        throw new Error('The same carrier tracking number is already assigned to another order.');
      trackingNumbers.add(key);
    }
    if (order.label) {
      if (labelIds.has(order.label.id) || labelHashes.has(order.label.sha256))
        throw new Error('This carrier label is already assigned to another order.');
      labelIds.add(order.label.id);
      labelHashes.add(order.label.sha256);
    }
  }
  return orders;
}

export function validateShippingSettings(
  value: unknown,
  companyIds: ReadonlySet<string>,
): ShippingSettings {
  if (value === undefined) return defaultShippingSettings();
  const source = record(value, 'Shipping settings');
  const entries = Object.entries(record(source.senders, 'Company senders'));
  if (entries.length > 100) throw new Error('Too many company sender addresses.');
  return {
    defaultCarrier: choice(source.defaultCarrier, CARRIER_IDS, 'Default carrier'),
    senders: Object.fromEntries(
      entries.map(([key, address]) => {
        const companyId = identifier(key, 'Sender company ID');
        if (!companyIds.has(companyId)) throw new Error('A sender references a missing company.');
        return [companyId, validateShippingAddress(address, 'Company sender')];
      }),
    ),
  };
}

/** Preserve high-water marks even after the related order expires from Trash. */
export function validateOrderSequences(
  value: unknown,
  orders: readonly Order[],
): Record<string, number> {
  const entries = Object.entries(value === undefined ? {} : record(value, 'Order sequences'));
  if (entries.length > 50000) throw new Error('Too many order date sequences.');
  const sequences: Record<string, number> = Object.fromEntries(
    entries.map(([key, sequence]) => {
      if (
        !/^\d{8}$/.test(key) ||
        !validCustomerDate(`${key.slice(0, 4)}-${key.slice(4, 6)}-${key.slice(6, 8)}`)
      )
        throw new Error('Order sequence date is invalid.');
      return [key, integer(sequence, 'Order sequence', 999_999_999, 1)];
    }),
  );
  for (const order of orders) {
    const match = /^VT-(\d{8})-(\d{3,9})$/.exec(order.number);
    if (
      !match ||
      !validCustomerDate(`${match[1].slice(0, 4)}-${match[1].slice(4, 6)}-${match[1].slice(6, 8)}`)
    )
      continue;
    const sequence = Number(match[2]);
    if (sequence > 0) sequences[match[1]] = Math.max(sequences[match[1]] ?? 0, sequence);
  }
  return sequences;
}

export function nextOrderNumber(
  orders: readonly Order[],
  orderedOn: string,
  sequences: Readonly<Record<string, number>> = {},
): string {
  dateOnly(orderedOn, 'Order date');
  const dateKey = orderedOn.replaceAll('-', '');
  const prefix = `VT-${dateKey}-`;
  let max = integer(sequences[dateKey] ?? 0, 'Order sequence', 999_999_999);
  for (const order of orders) {
    if (!order.number.startsWith(prefix)) continue;
    const suffix = order.number.slice(prefix.length);
    if (/^\d+$/.test(suffix) && Number.isSafeInteger(Number(suffix)))
      max = Math.max(max, Number(suffix));
  }
  if (max >= 999_999_999) throw new Error('Order number sequence has reached its limit.');
  return `${prefix}${String(max + 1).padStart(3, '0')}`;
}

export class OrderSaveError extends Error {
  constructor(
    readonly code:
      'conflict' | 'validation' | 'duplicate-tracking' | 'duplicate-label' | 'shipment-locked',
    message: string,
  ) {
    super(message);
    this.name = 'OrderSaveError';
  }
}
function shipmentDetails(order: Order) {
  return {
    id: order.id,
    number: order.number,
    companyId: order.companyId,
    customerId: order.customerId,
    customerName: order.customerName,
    orderedOn: order.orderedOn,
    sender: order.sender,
    recipient: order.recipient,
    items: order.items,
    discountSatang: order.discountSatang,
    shippingSatang: order.shippingSatang,
    paymentMethod: order.paymentMethod,
    carrier: order.carrier,
    parcel: order.parcel,
    trackingNumber: order.trackingNumber,
    shipment: order.shipment,
  };
}

/** Prepare against the latest workspace; the repository still guards the final revision. */
export function prepareOrderSave(
  workspace: Workspace,
  draft: Order,
  expectedOriginal: Order | null = null,
): Workspace {
  const orders = workspace.orders ?? [];
  const current = orders.find((order) => order.id === draft.id);
  if (!entityEditIsCurrent(expectedOriginal, current) || current?.deletedAt)
    throw new OrderSaveError(
      'conflict',
      'This order changed or was removed. Reopen it before saving.',
    );
  if (current && (draft.number !== current.number || draft.createdAt !== current.createdAt))
    throw new OrderSaveError(
      'validation',
      'An existing order number and creation date cannot be changed.',
    );
  if (current && current.quantitySource !== draft.quantitySource)
    throw new OrderSaveError('validation', 'An existing order type cannot be changed.');
  if (
    current?.shipment &&
    (!entityEditIsCurrent(shipmentDetails(current), shipmentDetails(draft)) ||
      draft.status === 'cancelled')
  )
    throw new OrderSaveError(
      'shipment-locked',
      'This order has a carrier shipment. Its booked details cannot be changed.',
    );
  if (
    current?.label &&
    draft.label?.id === current.label.id &&
    !entityEditIsCurrent(shipmentDetails(current), shipmentDetails(draft))
  )
    throw new OrderSaveError(
      'shipment-locked',
      'Remove or replace the existing label before changing its delivery details.',
    );
  const trackingKey = draft.trackingNumber?.toUpperCase();
  if (
    trackingKey &&
    orders.some(
      (order) =>
        order.id !== draft.id &&
        order.carrier === draft.carrier &&
        order.trackingNumber?.toUpperCase() === trackingKey,
    )
  )
    throw new OrderSaveError(
      'duplicate-tracking',
      'This tracking number is already assigned to another order, including Trash.',
    );
  if (
    draft.label &&
    orders.some(
      (order) =>
        order.id !== draft.id &&
        order.label &&
        (order.label.id === draft.label!.id || order.label.sha256 === draft.label!.sha256),
    )
  )
    throw new OrderSaveError(
      'duplicate-label',
      'This carrier label is already assigned to another order, including Trash.',
    );
  try {
    const candidate = validateOrder(
      {
        ...draft,
        number:
          current?.number ??
          (draft.number || nextOrderNumber(orders, draft.orderedOn, workspace.orderSequences)),
      },
      new Set(workspace.companies.map((company) => company.id)),
    );
    if (!current && draft.number) {
      const match = /^VT-(\d{8})-(\d{3,9})$/.exec(candidate.number);
      if (match && Number(match[2]) <= (workspace.orderSequences?.[match[1]] ?? 0))
        throw new Error(
          'This order number was already used. Leave it blank to assign a new number.',
        );
    }
    if (candidate.deletedAt) throw new Error('Use Move to Trash to delete an order.');
    const sameCompany = current?.companyId === candidate.companyId;
    if (candidate.customerId && (!sameCompany || current?.customerId !== candidate.customerId)) {
      const customer = workspace.customers.find(
        (item) => item.id === candidate.customerId && !item.deletedAt,
      );
      if (!customer || customer.companyId !== candidate.companyId)
        throw new Error('Choose an active customer belonging to this company.');
    }
    for (const item of candidate.items) {
      if (!item.productId) continue;
      const oldItem =
        sameCompany &&
        current?.items.find((old) => old.id === item.id && old.productId === item.productId);
      if (oldItem) continue;
      const product = workspace.products.find(
        (product) => product.id === item.productId && !product.deletedAt,
      );
      if (
        !product ||
        !effectiveProductCompanyIds(product, workspace.posts).includes(candidate.companyId)
      )
        throw new Error('Choose active products belonging to this company.');
    }
    const synced = candidate.quantitySource
      ? { order: candidate, customers: workspace.customers }
      : syncOrderCustomer(workspace.customers, candidate, current);
    const next = current
      ? orders.map((order) => (order.id === candidate.id ? synced.order : order))
      : [...orders, synced.order];
    validateOrders(next, new Set(workspace.companies.map((company) => company.id)));
    return {
      ...workspace,
      customers: synced.customers,
      orders: next,
      orderSequences: validateOrderSequences(workspace.orderSequences, next),
    };
  } catch (error) {
    throw new OrderSaveError(
      'validation',
      error instanceof Error ? error.message : 'Order is invalid.',
    );
  }
}

/** Move an unchanged order to Trash without losing its snapshots or attached PDF metadata. */
export function prepareOrderTrash(
  workspace: Workspace,
  expectedOriginal: Order,
  deletedAt = new Date().toISOString(),
): Workspace {
  const current = workspace.orders?.find((order) => order.id === expectedOriginal.id);
  if (!entityEditIsCurrent(expectedOriginal, current) || !current || current.deletedAt)
    throw new OrderSaveError(
      'conflict',
      'This order changed or was removed. Reopen it before deleting.',
    );
  if (current.shipment)
    throw new OrderSaveError(
      'shipment-locked',
      'An order with a carrier shipment cannot be moved to Trash.',
    );
  const deleted = validateOrder(
    { ...current, deletedAt, updatedAt: deletedAt },
    new Set(workspace.companies.map((company) => company.id)),
  );
  return {
    ...workspace,
    orders: (workspace.orders ?? []).map((order) => (order.id === deleted.id ? deleted : order)),
  };
}
