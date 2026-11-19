import 'server-only';
import { readAccessSession } from '@/lib/server/site-access';
import { accessRequired, privateCache } from '@/lib/server/access-response';

export const dynamic = 'force-dynamic';

export function GET(request: Request) {
  const session = readAccessSession(request);
  return session
    ? Response.json(
        { authenticated: true, expiresAt: session.expiresAt },
        { headers: privateCache },
      )
    : accessRequired();
}
