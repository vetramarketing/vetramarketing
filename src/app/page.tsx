import AuthenticatedWorkspace from '@/components/AuthenticatedWorkspace';
import { requirePageAccess } from '@/lib/server/require-page-access';

export const dynamic = 'force-dynamic';

export default async function Page() {
  await requirePageAccess('/');
  return <AuthenticatedWorkspace />;
}
