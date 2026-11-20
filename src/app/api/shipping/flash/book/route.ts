import 'server-only';
import { checkRequestAccess } from '@/lib/server/access-response';
import { bookFlashShipment } from '@/lib/shipping/gateway';

export const runtime = 'nodejs';

export async function POST(request: Request) {
  const access = await checkRequestAccess(request);
  if (access instanceof Response) return access;
  return bookFlashShipment(request);
}
