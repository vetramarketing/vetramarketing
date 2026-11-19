import { safePostUrl } from './data';

/** Open synchronously so the caller can count only a successfully created navigation. */
export function openPostLinkInNewTab(url: string, browser: Pick<Window, 'open'> = window): boolean {
  if (!url || !safePostUrl(url)) return false;

  let child: Window | null;
  try {
    child = browser.open('about:blank', '_blank');
  } catch {
    return false;
  }
  if (!child) return false;

  try {
    child.opener = null;
    const link = child.document.createElement('a');
    link.href = url;
    link.target = '_self';
    link.rel = 'noreferrer';
    child.document.body.appendChild(link);
    link.click();
    return true;
  } catch {
    try {
      child.close();
    } catch {
      // Cleanup may be unavailable after the newly created tab has already closed.
    }
    return false;
  }
}
