export class ShippingError extends Error {
  constructor(
    public readonly code: string,
    message: string,
    public readonly status = 400,
    public readonly carrierCode?: number,
  ) {
    super(message);
    this.name = 'ShippingError';
  }
}

/** Never forward raw carrier responses, credentials, addresses, or stack traces. */
export function shippingErrorResponse(error: unknown): Response {
  const safe =
    error instanceof ShippingError
      ? error
      : new ShippingError('SHIPPING_UNAVAILABLE', 'Shipping is temporarily unavailable.', 503);
  return Response.json(
    { error: { code: safe.code, message: safe.message } },
    { status: safe.status, headers: { 'Cache-Control': 'no-store' } },
  );
}
