import 'server-only';
import { headers } from 'next/headers';
import { redirect } from 'next/navigation';
import { hasValidSession, safeWorkspaceReturn } from './site-access';

export async function requirePageAccess(path: string) {
  if (!hasValidSession({ headers: await headers() })) {
    const next = safeWorkspaceReturn(path);
    redirect(next === '/' ? '/unlock' : '/unlock?next=' + encodeURIComponent(next));
  }
}
