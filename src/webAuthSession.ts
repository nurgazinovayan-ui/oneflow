// Shared in-memory session state between WebAuthGate (which owns login/logout) and webApi.ts
// (which needs the current access token to call Edge Functions). Deliberately not persisted
// to localStorage — login is required on every page load, same as the desktop app.
export interface WebSession {
  accessToken: string;
  refreshToken: string;
  userId: string;
  email: string;
  expiresAt: number;
}

let currentSession: WebSession | null = null;

export function getWebSession(): WebSession | null {
  return currentSession;
}

export function setWebSession(session: WebSession | null): void {
  currentSession = session;
}
