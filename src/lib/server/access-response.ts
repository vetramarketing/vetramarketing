export const privateCache = { 'Cache-Control': 'private, no-store' };

export function accessRequired() {
  return Response.json({ code: 'PIN_REQUIRED' }, { status: 401, headers: privateCache });
}
