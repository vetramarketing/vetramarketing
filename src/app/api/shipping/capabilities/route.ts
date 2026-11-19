import 'server-only';
import { shippingCapabilities } from '@/lib/shipping/gateway';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

export function GET(request: Request) {
  return shippingCapabilities(request);
}
