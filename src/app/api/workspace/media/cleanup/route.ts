import 'server-only';
import { checkRequestAccess } from '@/lib/server/access-response';
import { cleanupWorkspaceImages } from '@/lib/server/mongo-workspace';
import { isTrustedWorkspaceRequest } from '@/lib/server/workspace-request';
import { StageError } from '@/lib/server/staged-images';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';
const json = (value: unknown, status = 200) =>
  Response.json(value, { status, headers: { 'Cache-Control': 'private, no-store' } });
export async function POST(request: Request) {
  const access = await checkRequestAccess(request);
  if (access instanceof Response) return access;
  if (!isTrustedWorkspaceRequest(request)) return json({ code: 'WORKSPACE_ORIGIN_REQUIRED' }, 403);
  try {
    return json(
      await cleanupWorkspaceImages(new URL(request.url).searchParams.get('submissionId')),
    );
  } catch (error) {
    return error instanceof StageError
      ? json({ code: error.code }, error.status)
      : json({ code: 'IMAGE_CLEANUP_UNAVAILABLE' }, 503);
  }
}
