const loopback = new Set(['localhost', '127.0.0.1', '[::1]']);

/** The direct local server accepts loopback clients; proxies cannot establish local trust. */
export function isLocalWorkspaceRequest(request: Request): boolean {
  if (process.env.VERCEL || process.env.AWS_LAMBDA_FUNCTION_NAME) return false;
  const host = request.headers.get('host');
  if (!host || !/^(localhost|127\.0\.0\.1|\[::1\])(:\d{1,5})?$/i.test(host)) return false;
  const url = new URL(request.url);
  if (!loopback.has(url.hostname) || !['http:', 'https:'].includes(url.protocol)) return false;
  if (!URL.canParse(url.protocol + '//' + host)) return false;
  const origin = new URL(url.protocol + '//' + host);
  const port = process.env.PORT || '3100';
  if (process.env.VETRA_WORKSPACE_ORIGIN) {
    if (origin.origin !== process.env.VETRA_WORKSPACE_ORIGIN) return false;
  } else if (url.protocol !== 'http:' || (origin.port || '80') !== port) return false;
  if (url.port !== origin.port || (url.protocol === 'https:' && url.host !== host)) return false;
  const forwardedHost = request.headers.get('x-forwarded-host');
  const forwardedProto = request.headers.get('x-forwarded-proto');
  const hops = request.headers.get('x-forwarded-for');
  if (
    request.headers.has('forwarded') ||
    (forwardedHost && forwardedHost !== host) ||
    (forwardedProto && forwardedProto + ':' !== url.protocol) ||
    (hops && !['127.0.0.1', '::1', '::ffff:127.0.0.1'].includes(hops))
  )
    return false;
  const site = request.headers.get('sec-fetch-site');
  if (site && site !== 'same-origin') return false;
  const originHeader = request.headers.get('origin');
  return originHeader === origin.origin || (request.method === 'GET' && !originHeader);
}

/** A production deployment serves one HTTPS origin. Preview aliases never inherit this access. */
export function isTrustedWorkspaceRequest(request: Request): boolean {
  if (!process.env.VERCEL) return isLocalWorkspaceRequest(request);
  if (
    process.env.VERCEL !== '1' ||
    process.env.VERCEL_ENV !== 'production' ||
    (process.env.VERCEL_TARGET_ENV && process.env.VERCEL_TARGET_ENV !== 'production')
  )
    return false;

  const domain = process.env.VERCEL_PROJECT_PRODUCTION_URL;
  const configured = domain ? 'https://' + domain : process.env.VETRA_WORKSPACE_ORIGIN;
  if (!configured || !URL.canParse(configured)) return false;
  const origin = new URL(configured);
  if (
    origin.protocol !== 'https:' ||
    loopback.has(origin.hostname) ||
    origin.hostname.includes('*') ||
    (configured !== origin.origin && configured !== origin.origin + '/')
  )
    return false;
  if (new URL(request.url).origin !== origin.origin || request.headers.get('host') !== origin.host)
    return false;

  // Vercel forwards public client IPs. Only the configured URL and matching host establish trust.
  const forwardedHost = request.headers.get('x-forwarded-host');
  const forwardedProto = request.headers.get('x-forwarded-proto');
  if (
    (forwardedHost !== null && forwardedHost !== origin.host) ||
    (forwardedProto !== null && forwardedProto !== 'https')
  )
    return false;

  const read = request.method === 'GET' || request.method === 'HEAD';
  const site = request.headers.get('sec-fetch-site');
  if (site && site !== 'same-origin' && !(read && site === 'none')) return false;
  const originHeader = request.headers.get('origin');
  return originHeader === origin.origin || (read && originHeader === null);
}
