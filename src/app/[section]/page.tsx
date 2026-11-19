import { notFound, redirect } from 'next/navigation';
import MarketingApp from '@/components/MarketingApp';
import { isWorkspaceView, workspaceViews } from '@/lib/workspace-routes';

export function generateStaticParams() {
  return [...workspaceViews.filter((view) => view !== 'overview'), 'stores'].map((section) => ({
    section,
  }));
}

export default async function SectionPage({ params }: { params: Promise<{ section: string }> }) {
  const { section } = await params;
  if (section === 'stores') redirect('/companies');
  if (!isWorkspaceView(section)) notFound();
  return <MarketingApp initialView={section} />;
}
