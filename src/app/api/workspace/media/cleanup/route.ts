import 'server-only';
import { cleanupWorkspaceImages } from '@/lib/server/mongo-workspace';
import { isLocalWorkspaceRequest } from '@/lib/server/workspace-request';
import { StageError } from '@/lib/server/staged-images';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';
const json = (value: unknown, status = 200) =>
  Response.json(value, { status, headers: { 'Cache-Control': 'private, no-store' } });
export async function POST(request: Request) {
  if (!isLocalWorkspaceRequest(request)) return json({ code: 'LOCAL_ACCESS_REQUIRED' }, 403);
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
