import { NextResponse, type NextRequest } from 'next/server';
import { accessRequired, privateCache } from './lib/server/access-response';
import { hasValidSession, safeWorkspaceReturn } from './lib/server/site-access';

// The unlock screen is standalone. Application chunks can contain bundled business records.
const publicFiles = new Set([
  '/unlock',
  '/access/unlock.css',
  '/access/unlock.js',
  '/icon.svg',
  '/logo_white.svg',
]);
const accessEndpoints = new Set(['/api/access/unlock', '/api/access/lock', '/api/access/status']);

export function proxy(request: NextRequest) {
  const path = request.nextUrl.pathname;
  const read = request.method === 'GET' || request.method === 'HEAD';
  if ((read && publicFiles.has(path)) || accessEndpoints.has(path) || hasValidSession(request)) {
    const response = NextResponse.next();
    response.headers.set('Cache-Control', privateCache['Cache-Control']);
    return response;
  }

  if (!read || path.startsWith('/api/') || path.startsWith('/_next/') || path.includes('.')) {
    return accessRequired();
  }
  const next = safeWorkspaceReturn(path);
  const unlock = new URL('/unlock', request.url);
  if (next !== '/') unlock.searchParams.set('next', next);
  return NextResponse.redirect(unlock, { status: 303, headers: privateCache });
}
