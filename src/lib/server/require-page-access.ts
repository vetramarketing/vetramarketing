import 'server-only';
import { headers } from 'next/headers';
import { redirect } from 'next/navigation';
import { safeWorkspaceReturn } from './site-access';
import { checkRequestAccess } from './access-response';

export async function requirePageAccess(path: string) {
  const access = await checkRequestAccess({ headers: await headers() });
  if (access instanceof Response) {
    // If verification failed between the proxy and render, /unlock returns its public 503
    // message (or returns here once the session can be verified).
    const next = safeWorkspaceReturn(path);
    redirect(next === '/' ? '/unlock' : '/unlock?next=' + encodeURIComponent(next));
  }
}
