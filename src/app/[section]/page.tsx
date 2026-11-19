import { notFound, redirect } from 'next/navigation';
import AuthenticatedWorkspace from '@/components/AuthenticatedWorkspace';
import { isWorkspaceView } from '@/lib/workspace-routes';
import { requirePageAccess } from '@/lib/server/require-page-access';

export const dynamic = 'force-dynamic';

export default async function SectionPage({ params }: { params: Promise<{ section: string }> }) {
  const { section } = await params;
  await requirePageAccess('/' + section);
  if (section === 'stores') redirect('/companies');
  if (!isWorkspaceView(section)) notFound();
  return <AuthenticatedWorkspace initialView={section} />;
}
