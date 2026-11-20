import 'server-only';
import { checkRequestAccess } from '@/lib/server/access-response';
import { CarrierLabelError, MAX_CARRIER_LABEL_BYTES } from '@/lib/order-labels';
import { getWorkspaceMongoDb } from '@/lib/server/mongo-workspace';
import { mongoLabelStore, storeUploadedLabel, validLabelId } from '@/lib/server/mongo-labels';
import { isTrustedWorkspaceRequest } from '@/lib/server/workspace-request';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';
type Context = { params: Promise<{ id: string }> };
const headers = { 'Cache-Control': 'private, no-store' };
const status = (code: number) => new Response(null, { status: code, headers });

export async function GET(request: Request, context: Context) {
  const access = await checkRequestAccess(request);
  if (access instanceof Response) return access;
  if (!isTrustedWorkspaceRequest(request)) return status(403);
  const { id } = await context.params;
  if (!validLabelId(id)) return status(400);
  try {
    const bytes = await mongoLabelStore(await getWorkspaceMongoDb()).read(id);
    if (!bytes) return status(404);
    return new Response(Uint8Array.from(bytes), {
      headers: {
        ...headers,
        'Content-Type': 'application/pdf',
        'Content-Disposition': 'attachment; filename="carrier-label.pdf"',
      },
    });
  } catch {
    return status(503);
  }
}

export async function PUT(request: Request, context: Context) {
  const access = await checkRequestAccess(request);
  if (access instanceof Response) return access;
  if (!isTrustedWorkspaceRequest(request)) return status(403);
  const { id } = await context.params;
  if (!validLabelId(id) || !request.body) return status(400);
  if (request.headers.get('content-type') !== 'application/pdf') return status(415);
  if (Number(request.headers.get('content-length')) > MAX_CARRIER_LABEL_BYTES) return status(413);
  const reader = request.body.getReader();
  try {
    const chunks: Uint8Array[] = [];
    let size = 0;
    for (;;) {
      const { done, value } = await reader.read();
      if (done) break;
      size += value.length;
      if (size > MAX_CARRIER_LABEL_BYTES) return status(413);
      chunks.push(value);
    }
    const ok = await storeUploadedLabel(await getWorkspaceMongoDb(), id, Buffer.concat(chunks));
    return status(ok ? 204 : 400);
  } catch (error) {
    return status(error instanceof CarrierLabelError ? 400 : 503);
  } finally {
    await reader.cancel().catch(() => undefined);
  }
}
