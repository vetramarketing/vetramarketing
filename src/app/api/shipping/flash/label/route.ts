import 'server-only';
import { accessRequired } from '@/lib/server/access-response';
import { hasValidSession } from '@/lib/server/site-access';
import { downloadFlashLabel } from '@/lib/shipping/gateway';

export const runtime = 'nodejs';

export function POST(request: Request) {
  if (!hasValidSession(request)) return accessRequired();
  return downloadFlashLabel(request);
}
