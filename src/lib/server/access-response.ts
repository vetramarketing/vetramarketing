import { readAccessSession, SessionStoreUnavailable, type SessionRequest } from './site-access';

export const privateCache = { 'Cache-Control': 'private, no-store' };

export function accessRequired() {
  return Response.json({ code: 'PIN_REQUIRED' }, { status: 401, headers: privateCache });
}

/** Only a definitive denial should end a browser session. An outage preserves the cookie and draft. */
export async function checkRequestAccess(request: SessionRequest, document = false) {
  try {
    return (await readAccessSession(request)) ?? accessRequired();
  } catch (error) {
    if (!(error instanceof SessionStoreUnavailable)) throw error;
    const headers = { ...privateCache, 'Retry-After': '10', 'X-Vetra-Session': 'unavailable' };
    if (document)
      return new Response(
        'ยังตรวจสอบเซสชันไม่ได้ กรุณารอสักครู่แล้วโหลดหน้านี้ใหม่\n\nYour session could not be verified. Please reload this page in a moment.',
        { status: 503, headers: { ...headers, 'Content-Type': 'text/plain; charset=utf-8' } },
      );
    return Response.json({ code: 'SESSION_VERIFICATION_UNAVAILABLE' }, { status: 503, headers });
  }
}
