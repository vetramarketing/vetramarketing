import 'server-only';
import { accessRequired } from '@/lib/server/access-response';
import { hasValidSession } from '@/lib/server/site-access';
import { CATALOG_IMAGE_LIMITS } from '@/lib/cloudinary-media';
import { getWorkspaceMongoDb, workspaceDatabaseScope } from '@/lib/server/mongo-workspace';
import {
  catalogImageTarget,
  stageCatalogImage,
  StageError,
  validSubmissionId,
} from '@/lib/server/staged-images';
import { isLocalWorkspaceRequest } from '@/lib/server/workspace-request';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';
const json = (value: unknown, status = 200) =>
  Response.json(value, { status, headers: { 'Cache-Control': 'private, no-store' } });
type Context = { params: Promise<{ collection: string; recordId: string }> };

export async function PUT(request: Request, context: Context) {
  if (!hasValidSession(request)) return accessRequired();
  if (!isLocalWorkspaceRequest(request)) return json({ code: 'LOCAL_ACCESS_REQUIRED' }, 403);
  const id = request.headers.get('x-submission-id') ?? '';
  if (!validSubmissionId(id) || !request.body) return json({ code: 'INVALID_SUBMISSION' }, 400);
  const mime = request.headers.get('content-type') ?? '';
  if (!CATALOG_IMAGE_LIMITS.mimeTypes.some((type) => type === mime))
    return json({ code: 'UNSUPPORTED_IMAGE' }, 415);
  const limit = CATALOG_IMAGE_LIMITS.maxUploadBytes;
  if (Number(request.headers.get('content-length')) > limit)
    return json({ code: 'IMAGE_TOO_LARGE' }, 413);
  const reader = request.body.getReader();
  try {
    const { collection, recordId } = await context.params;
    const target = catalogImageTarget(collection, recordId);
    const chunks: Uint8Array[] = [];
    let size = 0;
    for (;;) {
      const { done, value } = await reader.read();
      if (done) break;
      size += value.length;
      if (size > limit) return json({ code: 'IMAGE_TOO_LARGE' }, 413);
      chunks.push(value);
    }
    return json(
      await stageCatalogImage(
        await getWorkspaceMongoDb(),
        await workspaceDatabaseScope(),
        target,
        id,
        mime,
        Buffer.concat(chunks),
      ),
    );
  } catch (error) {
    return error instanceof StageError
      ? json({ code: error.code }, error.status)
      : json({ code: 'IMAGE_UPLOAD_UNAVAILABLE' }, 503);
  } finally {
    await reader.cancel().catch(() => undefined);
  }
}
