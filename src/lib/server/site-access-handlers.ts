import { isTrustedWorkspaceRequest } from './workspace-request';
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
  return request.method === 'POST' && isTrustedWorkspaceRequest(request);
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

export async function lockRequest(request: Request) {
  if (!trustedPost(request)) return new Response(null, { status: 403, headers });
  try {
    await lockAccess(request);
    return redirect('/unlock', cookie(request, '', 0));
  } catch {
    return new Response('Could not lock the workspace. Please retry.', { status: 503, headers });
  }
}
