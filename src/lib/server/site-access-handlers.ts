import { isLocalWorkspaceRequest } from './workspace-request';
import {
  lockAccess,
  safeWorkspaceReturn,
  SESSION_COOKIE_NAME,
  SESSION_SECONDS,
  unlockAccess,
} from './site-access';

const headers = { 'Cache-Control': 'private, no-store', 'Referrer-Policy': 'no-referrer' };
const limit = 1024;
const redirect = (location: string, cookie?: string) =>
  new Response(null, {
    status: 303,
    headers: { ...headers, Location: location, ...(cookie && { 'Set-Cookie': cookie }) },
  });
const cookie = (request: Request, token: string, seconds: number) =>
  `${SESSION_COOKIE_NAME}=${token}; Path=/; HttpOnly; SameSite=Strict; Max-Age=${seconds}${new URL(request.url).protocol === 'https:' ? '; Secure' : ''}`;

function trustedPost(request: Request) {
  if (request.method !== 'POST') return false;
  if (new URL(request.url).protocol !== 'https:') return isLocalWorkspaceRequest(request);
  // Direct HTTPS on loopback can be enabled explicitly; forwarded hosts never establish trust.
  const url = new URL(request.url);
  const site = request.headers.get('sec-fetch-site');
  const forwardedHost = request.headers.get('x-forwarded-host');
  const forwardedProtocol = request.headers.get('x-forwarded-proto');
  const hops = request.headers.get('x-forwarded-for');
  return (
    !process.env.VERCEL &&
    !process.env.AWS_LAMBDA_FUNCTION_NAME &&
    ['localhost', '127.0.0.1', '[::1]'].includes(url.hostname) &&
    url.origin === process.env.VETRA_WORKSPACE_ORIGIN &&
    request.headers.get('host') === url.host &&
    request.headers.get('origin') === url.origin &&
    (!site || site === 'same-origin') &&
    !request.headers.has('forwarded') &&
    (!forwardedHost || forwardedHost === url.host) &&
    (!forwardedProtocol || forwardedProtocol === 'https') &&
    (!hops || ['127.0.0.1', '::1', '::ffff:127.0.0.1'].includes(hops))
  );
}

async function readForm(request: Request) {
  if (
    !request.body ||
    request.headers.get('content-type')?.split(';')[0].trim().toLowerCase() !==
      'application/x-www-form-urlencoded'
  )
    return null;
  const reader = request.body.getReader();
  const chunks: Uint8Array[] = [];
  let size = 0;
  try {
    if (Number(request.headers.get('content-length')) > limit) return null;
    for (;;) {
      const { done, value } = await reader.read();
      if (done) break;
      size += value.length;
      if (size > limit) return null;
      chunks.push(value);
    }
    return new URLSearchParams(Buffer.concat(chunks).toString('utf8'));
  } catch {
    return null;
  } finally {
    await reader.cancel().catch(() => undefined);
  }
}

export async function unlockRequest(request: Request) {
  if (!trustedPost(request)) return new Response(null, { status: 403, headers });
  const form = await readForm(request);
  const next = safeWorkspaceReturn(form?.get('next') ?? null);
  const pins = form?.getAll('pin') ?? [];
  const result = await unlockAccess(pins.length === 1 ? pins[0] : '', request);
  return result.status === 'accepted'
    ? redirect(next, cookie(request, result.token, SESSION_SECONDS))
    : redirect('/unlock?' + new URLSearchParams({ error: result.status, next }));
}

export function lockRequest(request: Request) {
  if (!trustedPost(request)) return new Response(null, { status: 403, headers });
  try {
    lockAccess(request);
    return redirect('/unlock', cookie(request, '', 0));
  } catch {
    return new Response('Could not lock the workspace. Please retry.', { status: 503, headers });
  }
}
