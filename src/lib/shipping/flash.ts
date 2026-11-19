// Node-only implementation: never import this module from client components.
import { createHash, randomBytes } from 'node:crypto';
import { orderTotals, validateOrderForShipment, type Order } from '../orders';
import type { ShippingConfiguration } from './config';
import { ShippingError } from './errors';

export type FlashParameters = Record<string, string>;
export type FlashLabelSize = '100x180' | '100x75';
export const FLASH_LABEL_MAX_BYTES = 5 * 1024 * 1024;
export const FLASH_BASE_URLS = {
  training: 'https://open-api-tra.flashexpress.com',
  production: 'https://open-api.flashexpress.com',
} as const;

const signatureBlank = /^[\u0009-\u000d\u001c-\u0020]*$/;

/** Official algorithm signs unencoded, ASCII-key-sorted nonblank values. */
export function signFlashParameters(parameters: FlashParameters, apiKey: string): string {
  const entries = Object.keys(parameters)
    .filter((key) => key !== 'sign' && !signatureBlank.test(parameters[key]))
    .sort()
    .map((key) => `${key}=${parameters[key]}`);
  return createHash('sha256')
    .update(`${entries.join('&')}&key=${apiKey}`, 'utf8')
    .digest('hex')
    .toUpperCase();
}

export function flashOrderReference(orderId: string): string {
  return `VETRA-${createHash('sha256').update(orderId).digest('hex').slice(0, 48)}`;
}

function addressParameters(prefix: 'src' | 'dst', address: Order['recipient']): FlashParameters {
  return {
    [`${prefix}Name`]: address.name.trim(),
    [`${prefix}Phone`]: address.phone.trim(),
    [`${prefix}ProvinceName`]: address.province.trim(),
    [`${prefix}CityName`]: address.district.trim(),
    [`${prefix}DistrictName`]: address.subdistrict.trim(),
    [`${prefix}PostalCode`]: address.postalCode.trim(),
    [`${prefix}DetailAddress`]: address.address.trim(),
  };
}

export function flashOrderParameters(order: Order): FlashParameters {
  try {
    validateOrderForShipment(order);
  } catch {
    throw new ShippingError(
      'INVALID_ORDER',
      'Complete the order, sender, recipient, and parcel details before booking.',
    );
  }
  if (order.carrier !== 'flash') {
    throw new ShippingError(
      'UNSUPPORTED_CARRIER',
      'Automatic booking currently supports Flash Express only.',
    );
  }
  for (const address of [order.sender, order.recipient]) {
    if (
      address.name.length > 50 ||
      address.phone.length > 20 ||
      address.address.length > 300 ||
      address.province.length > 150 ||
      address.district.length > 150 ||
      address.subdistrict.length > 150
    )
      throw new ShippingError(
        'FLASH_ADDRESS_LIMIT',
        'Shorten the sender or recipient details to fit the Flash label.',
      );
  }
  const cod = order.paymentMethod === 'cod';
  if (
    (cod || order.status === 'cod') &&
    (!cod ||
      order.status !== 'cod' ||
      (order.legacyWorkflow && order.legacyWorkflow.paymentStatus !== 'unpaid'))
  ) {
    throw new ShippingError(
      'FLASH_COD_PAYMENT_STATUS',
      'Cash on delivery requires a COD order with an unpaid cash-on-delivery balance.',
    );
  }
  const parameters: FlashParameters = {
    outTradeNo: flashOrderReference(order.id),
    ...addressParameters('src', order.sender),
    ...addressParameters('dst', order.recipient),
    expressCategory: '1',
    articleCategory: '99',
    weight: String(order.parcel.weightGrams),
    insured: '0',
    opdInsureEnabled: '0',
    codEnabled: cod ? '1' : '0',
    settlementType: '1',
  };
  for (const dimension of ['width', 'length', 'height'] as const) {
    const value = order.parcel[`${dimension}Cm`];
    if (value) {
      if (!Number.isInteger(value))
        throw new ShippingError(
          'FLASH_DIMENSIONS',
          'Flash requires parcel dimensions in whole centimetres.',
        );
      parameters[dimension] = String(value);
    }
  }
  if (cod) {
    if (order.items.length > 10 || order.items.some((item) => item.quantity > 999)) {
      throw new ShippingError(
        'FLASH_COD_ITEMS',
        'Flash COD supports up to 10 item lines and 999 units per line.',
      );
    }
    const total = orderTotals(order).totalSatang;
    if (total <= 0)
      throw new ShippingError(
        'FLASH_COD_AMOUNT',
        'A cash-on-delivery order must have a positive total.',
      );
    parameters.codAmount = String(total);
    parameters.subItemTypes = JSON.stringify(
      order.items.map((item) => ({
        itemName: item.name.slice(0, 200),
        itemQuantity: item.quantity,
      })),
    );
  }
  return parameters;
}

export function flashRequestFingerprint(parameters: FlashParameters, companyId: string): string {
  return createHash('sha256')
    .update(
      JSON.stringify([
        companyId,
        Object.entries(parameters).sort(([a], [b]) => (a < b ? -1 : a > b ? 1 : 0)),
      ]),
    )
    .digest('hex');
}

async function readLimitedResponse(response: Response, limit: number): Promise<Uint8Array> {
  const statedLength = Number(response.headers.get('content-length') || 0);
  if (statedLength > limit || !response.body)
    throw new ShippingError(
      'FLASH_RESPONSE_INVALID',
      'Flash returned an unreadable response.',
      502,
    );
  const reader = response.body.getReader();
  const parts: Uint8Array[] = [];
  let length = 0;
  try {
    while (true) {
      const { done, value } = await reader.read();
      if (done) break;
      length += value.length;
      if (length > limit)
        throw new ShippingError(
          'FLASH_RESPONSE_INVALID',
          'Flash returned a response that is too large.',
          502,
        );
      parts.push(value);
    }
  } finally {
    await reader.cancel().catch(() => undefined);
  }
  const data = new Uint8Array(length);
  let offset = 0;
  for (const part of parts) {
    data.set(part, offset);
    offset += part.length;
  }
  return data;
}

function rejection(code: number): ShippingError {
  const messages: Record<number, string> = {
    1001: 'Flash could not find this merchant account.',
    1002: 'Flash could not verify the merchant credentials.',
    1003: 'Flash already has this order. Reconcile its tracking number before continuing.',
    1004: 'Flash could not match the sender address.',
    1005: 'Flash could not match the recipient address.',
    1007: 'Flash could not find the sender warehouse.',
    1008: 'COD is not enabled for this Flash merchant account.',
    1009: 'Flash rejected the COD amount.',
    1018: 'Flash needs a complete sender address.',
    1020: 'Flash rejected the declared insurance value.',
    1021: 'Flash needs a five-digit postcode.',
    1022: 'The sender address is outside Flash service coverage.',
  };
  return new ShippingError(
    code === 1003 ? 'BOOKING_NEEDS_RECONCILIATION' : 'FLASH_REJECTED',
    messages[code] || 'Flash could not confirm this shipment. Check it with Flash before retrying.',
    409,
    code,
  );
}

export interface FlashClient {
  create(parameters: FlashParameters): Promise<{ trackingNumber: string; outTradeNo: string }>;
  label(trackingNumber: string, size: FlashLabelSize): Promise<Uint8Array>;
}

/** Fixed official hosts prevent arbitrary proxying; no request is retried here. */
export function createFlashClient(
  config: ShippingConfiguration,
  fetcher: typeof fetch = fetch,
): FlashClient {
  const request = async (path: string, fields: FlashParameters, pdf = false) => {
    const parameters = {
      ...fields,
      mchId: config.merchantId,
      nonceStr: randomBytes(16).toString('hex'),
    };
    const body = new URLSearchParams({
      ...parameters,
      sign: signFlashParameters(parameters, config.apiKey),
    });
    try {
      return await fetcher(`${FLASH_BASE_URLS[config.mode]}${path}`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/x-www-form-urlencoded',
          Accept: pdf ? 'application/pdf, application/json' : 'application/json',
          'Accept-Language': 'en',
        },
        body: body.toString(),
        signal: AbortSignal.timeout(20_000),
        redirect: 'error',
        cache: 'no-store',
      });
    } catch {
      throw new ShippingError(
        'FLASH_CONNECTION_UNKNOWN',
        'Flash did not confirm the result. Check the shipment before trying again.',
        502,
      );
    }
  };
  return {
    async create(parameters) {
      const response = await request('/open/v3/orders', parameters);
      let raw: unknown;
      try {
        raw = JSON.parse(
          new TextDecoder().decode(await readLimitedResponse(response, 1024 * 1024)),
        );
      } catch {
        throw new ShippingError(
          'FLASH_RESPONSE_UNKNOWN',
          'Flash returned an unreadable booking result. Check the shipment before trying again.',
          502,
        );
      }
      if (!raw || typeof raw !== 'object')
        throw new ShippingError(
          'FLASH_RESPONSE_UNKNOWN',
          'Flash did not confirm the booking result.',
          502,
        );
      const result = raw as {
        code?: unknown;
        data?: { pno?: unknown; outTradeNo?: unknown; mchId?: unknown };
      };
      if (result.code !== 1) {
        if (typeof result.code === 'number') throw rejection(result.code);
        throw new ShippingError(
          'FLASH_RESPONSE_UNKNOWN',
          'Flash did not confirm the booking result.',
          502,
        );
      }
      if (
        !response.ok ||
        !result.data ||
        typeof result.data.pno !== 'string' ||
        !/^[A-Za-z0-9]{1,20}$/.test(result.data.pno) ||
        result.data.outTradeNo !== parameters.outTradeNo ||
        result.data.mchId !== config.merchantId
      ) {
        throw new ShippingError(
          'FLASH_RESPONSE_UNKNOWN',
          'Flash returned a booking result that could not be verified.',
          502,
        );
      }
      return { trackingNumber: result.data.pno, outTradeNo: result.data.outTradeNo };
    },
    async label(trackingNumber, size) {
      if (!/^[A-Za-z0-9]{1,20}$/.test(trackingNumber))
        throw new ShippingError('INVALID_TRACKING', 'The saved Flash tracking number is invalid.');
      const path = `/open/v1/orders/${trackingNumber}/${size === '100x75' ? 'small/' : ''}pre_print`;
      const response = await request(path, {}, true);
      const bytes = await readLimitedResponse(response, FLASH_LABEL_MAX_BYTES);
      if (!response.ok || new TextDecoder().decode(bytes.slice(0, 5)) !== '%PDF-') {
        throw new ShippingError(
          'FLASH_LABEL_UNAVAILABLE',
          'The shipment is saved, but Flash has not returned its PDF label. Try downloading the label again.',
          502,
        );
      }
      return bytes;
    },
  };
}
