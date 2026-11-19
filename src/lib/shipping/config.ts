import { ShippingError } from './errors';

export type FlashMode = 'training' | 'production';
export interface ShippingConfiguration {
  enabled: boolean;
  origin: string;
  mode: FlashMode;
  merchantId: string;
  apiKey: string;
}

const defaultOrigin = 'http://127.0.0.1:3100';
const loopbackNames = new Set(['127.0.0.1', 'localhost', '[::1]']);

export function readShippingConfiguration(
  env: Record<string, string | undefined> = process.env,
): ShippingConfiguration {
  const requestedOrigin = env.VETRA_LOCAL_SHIPPING_ORIGIN || defaultOrigin;
  let origin = '';
  try {
    const url = new URL(requestedOrigin);
    if (
      url.protocol === 'http:' &&
      loopbackNames.has(url.hostname) &&
      url.username === '' &&
      url.password === '' &&
      url.pathname === '/' &&
      !url.search &&
      !url.hash
    )
      origin = url.origin;
  } catch {
    // Invalid settings disable the local gateway instead of broadening access.
  }
  const mode = env.FLASH_API_MODE === 'production' ? 'production' : 'training';
  const validMode = !env.FLASH_API_MODE || ['training', 'production'].includes(env.FLASH_API_MODE);
  return {
    enabled: env.VETRA_LOCAL_SHIPPING_ENABLED === 'true' && !!origin && validMode,
    origin,
    mode,
    merchantId: env.FLASH_MCH_ID?.trim() || '',
    apiKey: env.FLASH_API_KEY?.trim() || '',
  };
}

export function shippingIsConfigured(config: ShippingConfiguration): boolean {
  return !!config.merchantId && config.merchantId.length <= 32 && !!config.apiKey;
}

export function isLocalShippingRequest(request: Request, config: ShippingConfiguration): boolean {
  if (!config.origin) return false;
  const origin = new URL(config.origin);
  const forwardedHost = request.headers.get('x-forwarded-host');
  const forwardedProto = request.headers.get('x-forwarded-proto');
  return (
    new URL(request.url).origin === config.origin &&
    request.headers.get('host') === origin.host &&
    (!forwardedHost || forwardedHost === origin.host) &&
    (!forwardedProto || forwardedProto === 'http') &&
    !request.headers.has('forwarded')
  );
}

/** This gateway is for the loopback-bound local app only, not public hosting. */
export function requireLocalShippingRequest(request: Request, config: ShippingConfiguration): void {
  if (!config.enabled) {
    throw new ShippingError(
      'SHIPPING_DISABLED',
      'Enable the local shipping connector to continue.',
      503,
    );
  }
  if (
    !isLocalShippingRequest(request, config) ||
    request.headers.get('origin') !== config.origin ||
    (request.headers.has('sec-fetch-site') &&
      request.headers.get('sec-fetch-site') !== 'same-origin')
  ) {
    throw new ShippingError(
      'LOCAL_ACCESS_REQUIRED',
      'Use the local workspace to manage shipping.',
      403,
    );
  }
  if (!shippingIsConfigured(config)) {
    throw new ShippingError(
      'FLASH_NOT_CONFIGURED',
      'Configure the Flash merchant account on this computer first.',
      503,
    );
  }
}
