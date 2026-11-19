// Imported only by Node API routes. No secrets are serialized into client code.
import { validateOrder } from '../orders';
import {
  isLocalShippingRequest,
  readShippingConfiguration,
  requireLocalShippingRequest,
  shippingIsConfigured,
  type ShippingConfiguration,
} from './config';
import { shippingErrorResponse, ShippingError } from './errors';
import { createFlashClient, type FlashClient } from './flash';
import { LocalShippingLedger } from './ledger';

async function readJson(request: Request, limit = 128 * 1024): Promise<Record<string, unknown>> {
  if (!request.headers.get('content-type')?.toLowerCase().startsWith('application/json')) {
    throw new ShippingError('INVALID_REQUEST', 'Send shipping requests as JSON.', 415);
  }
  if (Number(request.headers.get('content-length') || 0) > limit || !request.body) {
    throw new ShippingError('INVALID_REQUEST', 'The shipping request is empty or too large.', 413);
  }
  const reader = request.body.getReader();
  const parts: Uint8Array[] = [];
  let length = 0;
  try {
    while (true) {
      const { done, value } = await reader.read();
      if (done) break;
      length += value.length;
      if (length > limit)
        throw new ShippingError('INVALID_REQUEST', 'The shipping request is too large.', 413);
      parts.push(value);
    }
  } finally {
    await reader.cancel().catch(() => undefined);
  }
  try {
    const raw = JSON.parse(Buffer.concat(parts).toString('utf8')) as unknown;
    if (!raw || typeof raw !== 'object' || Array.isArray(raw)) throw new Error('not object');
    return raw as Record<string, unknown>;
  } catch {
    throw new ShippingError('INVALID_REQUEST', 'The shipping request is not valid JSON.');
  }
}

export function shippingCapabilities(
  request: Request,
  config = readShippingConfiguration(),
): Response {
  const local = isLocalShippingRequest(request, config);
  return Response.json(
    {
      enabled: local && config.enabled,
      configured: local && shippingIsConfigured(config),
      mode: config.mode,
    },
    { headers: { 'Cache-Control': 'no-store', 'X-Content-Type-Options': 'nosniff' } },
  );
}

export interface ShippingGatewayOptions {
  config?: ShippingConfiguration;
  client?: FlashClient;
  directory?: string;
}

export async function bookFlashShipment(
  request: Request,
  options: ShippingGatewayOptions = {},
): Promise<Response> {
  try {
    const config = options.config ?? readShippingConfiguration();
    requireLocalShippingRequest(request, config);
    const body = await readJson(request);
    let order;
    try {
      order = validateOrder(body.order);
    } catch {
      throw new ShippingError(
        'INVALID_ORDER',
        'Review the order details before booking its shipment.',
      );
    }
    const ledger = new LocalShippingLedger(config, options.client ?? createFlashClient(config), {
      directory: options.directory,
    });
    const result = await ledger.book(order);
    return Response.json(result, {
      headers: { 'Cache-Control': 'no-store', 'X-Content-Type-Options': 'nosniff' },
    });
  } catch (error) {
    return shippingErrorResponse(error);
  }
}

export async function downloadFlashLabel(
  request: Request,
  options: ShippingGatewayOptions = {},
): Promise<Response> {
  try {
    const config = options.config ?? readShippingConfiguration();
    requireLocalShippingRequest(request, config);
    const body = await readJson(request, 4096);
    if (
      typeof body.orderId !== 'string' ||
      !/^[A-Za-z0-9_.-]{1,100}$/.test(body.orderId) ||
      !['100x180', '100x75'].includes(body.size as string)
    ) {
      throw new ShippingError(
        'INVALID_LABEL_REQUEST',
        'Choose a saved shipment and a supported label size.',
      );
    }
    const ledger = new LocalShippingLedger(config, options.client ?? createFlashClient(config), {
      directory: options.directory,
    });
    const bytes = await ledger.label(body.orderId, body.size as '100x180' | '100x75');
    return new Response(new Uint8Array(bytes), {
      headers: {
        'Content-Type': 'application/pdf',
        'Content-Disposition': 'attachment; filename="flash-shipping-label.pdf"',
        'Cache-Control': 'no-store',
        'X-Content-Type-Options': 'nosniff',
      },
    });
  } catch (error) {
    return shippingErrorResponse(error);
  }
}
