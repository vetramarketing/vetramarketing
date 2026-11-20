export const sessionDeniedEvent = 'vetra-workspace-session-denied';
export const sessionUnavailableEvent = 'vetra-workspace-session-unavailable';

/** A denied private API request also locks data already rendered by the browser. */
export async function workspaceApiFetch(input: RequestInfo | URL, init?: RequestInit) {
  const response = await fetch(input, init);
  if (typeof window !== 'undefined') {
    if (response.status === 401) window.dispatchEvent(new Event(sessionDeniedEvent));
    if (response.status === 503 && response.headers.get('X-Vetra-Session') === 'unavailable')
      window.dispatchEvent(new Event(sessionUnavailableEvent));
  }
  return response;
}
