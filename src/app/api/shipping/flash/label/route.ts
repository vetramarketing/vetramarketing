import 'server-only';
import { downloadFlashLabel } from '@/lib/shipping/gateway';

export const runtime = 'nodejs';

export function POST(request: Request) {
  return downloadFlashLabel(request);
}
