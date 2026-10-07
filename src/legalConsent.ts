import { LEGAL_VERSION } from './legalContent';

// Acceptance of the Terms of Service + Privacy Policy (ConsentModal). The record that counts is the
// server's (legal_consents, written by the legal-consent Edge Function and, for e-mail sign-ups, by a
// trigger on auth.users from the sign-up metadata below); the browser only keeps two hints:
//   * localStorage: this device already accepted the current edition — Google login can skip the
//     pre-redirect window (the server is still asked after login);
//   * sessionStorage: a Google sign-up accepted right before the redirect — recorded on the way back.

const SUPABASE_URL = import.meta.env.VITE_SUPABASE_URL as string;
const SUPABASE_ANON_KEY = import.meta.env.VITE_SUPABASE_ANON_KEY as string;
const ACCEPTED_KEY = 'oneflow-legal-accepted';
const PENDING_KEY = 'oneflow-legal-pending';
const PENDING_MAX_AGE_MS = 30 * 60_000;

export type ConsentContext = 'signup' | 'login' | 'payment';

export function rememberAccepted(): void {
  try {
    localStorage.setItem(ACCEPTED_KEY, String(LEGAL_VERSION));
  } catch {
    /* storage blocked: the window just shows again next time */
  }
}

export function acceptedOnThisDevice(): boolean {
  try {
    return Number(localStorage.getItem(ACCEPTED_KEY)) >= LEGAL_VERSION;
  } catch {
    return false;
  }
}

export function markPendingSignupConsent(): void {
  try {
    sessionStorage.setItem(PENDING_KEY, JSON.stringify({ v: LEGAL_VERSION, at: Date.now() }));
  } catch {
    /* without it the window is shown again after the redirect */
  }
}

// One-shot: true when this tab accepted the documents just before a Google redirect.
export function takePendingSignupConsent(): boolean {
  try {
    const raw = sessionStorage.getItem(PENDING_KEY);
    sessionStorage.removeItem(PENDING_KEY);
    if (!raw) return false;
    const { v, at } = JSON.parse(raw) as { v: number; at: number };
    return v === LEGAL_VERSION && Date.now() - at < PENDING_MAX_AGE_MS;
  } catch {
    return false;
  }
}

// Goes into the e-mail sign-up request (user metadata); the auth.users trigger refuses a sign-up
// without it and copies it into legal_consents.
export function signupConsentMetadata(): Record<string, unknown> {
  return { legal_version: LEGAL_VERSION, legal_accepted_at: new Date().toISOString() };
}

async function callConsent<T>(accessToken: string, body: unknown): Promise<T> {
  const res = await fetch(`${SUPABASE_URL}/functions/v1/legal-consent`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', apikey: SUPABASE_ANON_KEY, Authorization: `Bearer ${accessToken}` },
    body: JSON.stringify(body),
  });
  const data = await res.json().catch(() => null);
  if (!res.ok) throw new Error(data?.code || data?.error || 'legal_error');
  return data as T;
}

export async function getConsentStatus(accessToken: string): Promise<boolean> {
  const data = await callConsent<{ accepted?: boolean }>(accessToken, { action: 'status' });
  if (data.accepted === true) rememberAccepted();
  return data.accepted === true;
}

export async function acceptConsent(accessToken: string, context: ConsentContext, details?: Record<string, unknown>): Promise<void> {
  await callConsent(accessToken, { action: 'accept', version: LEGAL_VERSION, context, details });
  rememberAccepted();
}
