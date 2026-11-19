import 'server-only';
import { bookFlashShipment } from '@/lib/shipping/gateway';

export const runtime = 'nodejs';

export function POST(request: Request) {
  return bookFlashShipment(request);
}
