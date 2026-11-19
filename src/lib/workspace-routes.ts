import type { View } from './types';

export const workspaceViews: readonly View[] = [
  'overview',
  'posts',
  'scripts',
  'groups',
  'analytics',
  'products',
  'companies',
  'customers',
  'orders',
  'settings',
  'trash',
];

export function isWorkspaceView(value: string): value is View {
  return workspaceViews.some((view) => view === value);
}

export function workspacePath(view: View): string {
  return view === 'overview' ? '/' : `/${view}`;
}

export function viewFromPath(pathname: string): View | null {
  if (pathname === '/') return 'overview';
  const section = pathname.match(/^\/([^/]+)\/?$/)?.[1];
  if (section === 'stores') return 'companies';
  return section && isWorkspaceView(section) ? section : null;
}
