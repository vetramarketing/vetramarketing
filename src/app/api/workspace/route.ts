import 'server-only';
import {
  MongoWorkspaceError,
  readMongoWorkspace,
  workspaceDatabaseScope,
  writeMongoWorkspace,
} from '@/lib/server/mongo-workspace';
import { isLocalWorkspaceRequest } from '@/lib/server/workspace-request';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';
const json = (data: unknown, status = 200) =>
  Response.json(data, { status, headers: { 'Cache-Control': 'private, no-store' } });

function failure(error: unknown): Response {
  if (error instanceof MongoWorkspaceError)
    return json(
      { code: error.code, ...(error.postIds && { postIds: error.postIds }) },
      error.status,
    );
  return json({ code: 'WORKSPACE_SERVICE_UNAVAILABLE' }, 503);
}

export async function GET(request: Request) {
  if (!process.env.MONGODB_URI?.trim()) return json({ configured: false });
  if (!isLocalWorkspaceRequest(request)) return json({ code: 'LOCAL_ACCESS_REQUIRED' }, 403);
  try {
    const snapshot = await readMongoWorkspace();
    return snapshot
      ? json({ configured: true, ...snapshot })
      : json(
          {
            configured: true,
            code: 'WORKSPACE_NOT_INITIALIZED',
            databaseScope: await workspaceDatabaseScope(),
          },
          404,
        );
  } catch (error) {
    return failure(error);
  }
}

async function readBody(request: Request): Promise<Record<string, unknown>> {
  const limit = 128 * 1024 * 1024;
  if (
    request.headers.get('content-type')?.split(';')[0].trim().toLowerCase() !== 'application/json'
  )
    throw new MongoWorkspaceError('JSON_REQUIRED', 415);
  if (!request.body) throw new MongoWorkspaceError('INVALID_REQUEST', 400);
  if (Number(request.headers.get('content-length')) > limit)
    throw new MongoWorkspaceError('REQUEST_TOO_LARGE', 413);
  const reader = request.body.getReader();
  const parts: Uint8Array[] = [];
  let bytes = 0;
  try {
    for (;;) {
      const { done, value } = await reader.read();
      if (done) break;
      bytes += value.length;
      if (bytes > limit) throw new MongoWorkspaceError('REQUEST_TOO_LARGE', 413);
      parts.push(value);
    }
  } finally {
    await reader.cancel().catch(() => undefined);
  }
  try {
    const body: unknown = JSON.parse(Buffer.concat(parts).toString('utf8'));
    if (body && typeof body === 'object' && !Array.isArray(body))
      return body as Record<string, unknown>;
  } catch {
    /* Report only the category of invalid input. */
  }
  throw new MongoWorkspaceError('INVALID_REQUEST', 400);
}

export async function POST(request: Request) {
  if (!isLocalWorkspaceRequest(request)) return json({ code: 'LOCAL_ACCESS_REQUIRED' }, 403);
  try {
    const body = await readBody(request);
    if (body.databaseScope !== undefined && body.databaseScope !== (await workspaceDatabaseScope()))
      throw new MongoWorkspaceError('WORKSPACE_REVISION_CONFLICT', 409);
    const snapshot = await writeMongoWorkspace({
      workspace: body.workspace,
      expectedRevision: body.expectedRevision as string | null,
      operationId: body.operationId as string,
    });
    return json({ configured: true, ...snapshot });
  } catch (error) {
    return failure(error);
  }
}
