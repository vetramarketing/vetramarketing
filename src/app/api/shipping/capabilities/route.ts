import 'server-only';
import { accessRequired } from '@/lib/server/access-response';
import { hasValidSession } from '@/lib/server/site-access';
import { shippingCapabilities } from '@/lib/shipping/gateway';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

export function GET(request: Request) {
  if (!hasValidSession(request)) return accessRequired();
  return shippingCapabilities(request);
}
