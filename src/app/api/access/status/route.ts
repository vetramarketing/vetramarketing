import 'server-only';
import { checkRequestAccess, privateCache } from '@/lib/server/access-response';

export const dynamic = 'force-dynamic';

export async function GET(request: Request) {
  const session = await checkRequestAccess(request);
  if (session instanceof Response) return session;
  return Response.json({ authenticated: true, expiresAt: session.expiresAt }, { headers: privateCache });
}
