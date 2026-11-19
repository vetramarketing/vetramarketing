const loopback = new Set(['localhost', '127.0.0.1', '[::1]']);

/** The single-user server is started on loopback. Reject public hosts, proxies and cross-site calls. */
export function isLocalWorkspaceRequest(request: Request): boolean {
  if (process.env.VERCEL || process.env.AWS_LAMBDA_FUNCTION_NAME) return false;
  const host = request.headers.get('host');
  if (!host || !/^(localhost|127\.0\.0\.1|\[::1\])(:\d{1,5})?$/i.test(host)) return false;
  if (!URL.canParse('http://' + host)) return false;
  const origin = new URL('http://' + host);
  const port = process.env.PORT || '3100';
  if (process.env.VETRA_WORKSPACE_ORIGIN) {
    if (origin.origin !== process.env.VETRA_WORKSPACE_ORIGIN) return false;
  } else if ((origin.port || '80') !== port) return false;
  const url = new URL(request.url);
  if (!loopback.has(url.hostname) || url.protocol !== 'http:' || url.port !== origin.port)
    return false;
  const forwardedHost = request.headers.get('x-forwarded-host');
  const forwardedProto = request.headers.get('x-forwarded-proto');
  const hops = request.headers.get('x-forwarded-for');
  if (
    request.headers.has('forwarded') ||
    (forwardedHost && forwardedHost !== host) ||
    (forwardedProto && forwardedProto !== 'http') ||
    (hops && !['127.0.0.1', '::1', '::ffff:127.0.0.1'].includes(hops))
  )
    return false;
  const site = request.headers.get('sec-fetch-site');
  if (site && site !== 'same-origin') return false;
  const originHeader = request.headers.get('origin');
  return originHeader === origin.origin || (request.method === 'GET' && !originHeader);
}
