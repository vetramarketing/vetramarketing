export const sessionDeniedEvent = 'vetra-workspace-session-denied';

/** A denied private API request also locks data already rendered by the browser. */
export async function workspaceApiFetch(input: RequestInfo | URL, init?: RequestInit) {
  const response = await fetch(input, init);
  if (response.status === 401 && typeof window !== 'undefined') {
    window.dispatchEvent(new Event(sessionDeniedEvent));
  }
  return response;
}
