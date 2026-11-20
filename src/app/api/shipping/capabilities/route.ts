import 'server-only';
import { checkRequestAccess } from '@/lib/server/access-response';
import { shippingCapabilities } from '@/lib/shipping/gateway';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

export async function GET(request: Request) {
  const access = await checkRequestAccess(request);
  if (access instanceof Response) return access;
  return shippingCapabilities(request);
}
