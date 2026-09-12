// Product analytics (PostHog), web build only.
//
// Why events and not pageviews: this app is a single URL. Everything — generation, the canvas,
// the chat, checkout — happens without navigating, so pageview-based analytics would record one
// "/" and nothing else. The questions worth answering are "how many people reach their first
// generation" and "where do they stop", which only named events can answer.
//
// Three rules this module enforces so the rest of the codebase doesn't have to think about them:
//   1. No key configured (VITE_POSTHOG_KEY unset) => every call here is a no-op. A missing key
//      must never break the app, and it is missing by default: the key is per-deployment.
//   2. No cookies and no device id until the visitor accepts. PostHog starts in 'memory'
//      persistence, which keeps everything in the tab and writes no storage; accepting upgrades
//      it to localStorage+cookie, declining opts out entirely.
//   3. The admin's own traffic is dropped, or the first month of data is mostly the founder.

import posthog from 'posthog-js';
import { ADMIN_EMAIL } from './types';

const KEY = import.meta.env.VITE_POSTHOG_KEY as string | undefined;
// Region matters: eu.i.posthog.com keeps data in the EU. Defaults to EU as the safer choice.
const HOST = (import.meta.env.VITE_POSTHOG_HOST as string | undefined) || 'https://eu.i.posthog.com';

export const CONSENT_STORAGE_KEY = 'oneflow-analytics-consent';
export type ConsentChoice = 'accepted' | 'declined';

let started = false;

export function readConsent(): ConsentChoice | null {
  try {
    const value = localStorage.getItem(CONSENT_STORAGE_KEY);
    return value === 'accepted' || value === 'declined' ? value : null;
  } catch {
    // Storage can be unavailable (private mode, blocked cookies). Treat it as "not asked":
    // the banner shows again, and until it's answered nothing is persisted anyway.
    return null;
  }
}

// Analytics is a web-build concern: the desktop app ships no consent banner, and showing one
// there would be a surprise. Gate here rather than at every call site.
function enabled(): boolean {
  return Boolean(KEY) && import.meta.env.VITE_WEB_MODE === '1';
}

export function initAnalytics(): void {
  if (!enabled() || started) return;
  const consent = readConsent();
  if (consent === 'declined') return;
  started = true;
  posthog.init(KEY as string, {
    api_host: HOST,
    // The single-URL point again: there is nothing meaningful to autocapture as a pageview,
    // and autocapturing every click would spend the free tier on noise instead of the funnel.
    capture_pageview: false,
    autocapture: false,
    persistence: consent === 'accepted' ? 'localStorage+cookie' : 'memory',
  });
}

// Called when the banner is answered. Accepting upgrades storage in place so the session that
// was already being measured in memory keeps its identity instead of restarting as a new one.
export function setConsent(choice: ConsentChoice): void {
  try {
    localStorage.setItem(CONSENT_STORAGE_KEY, choice);
  } catch {
    // Nothing to do: without storage the choice can't be remembered past this tab, but it is
    // still honoured below for the rest of the session.
  }
  if (!enabled()) return;
  if (choice === 'declined') {
    if (started) posthog.opt_out_capturing();
    return;
  }
  if (!started) initAnalytics();
  else posthog.set_config({ persistence: 'localStorage+cookie' });
}

export function capture(event: string, properties?: Record<string, unknown>): void {
  if (!enabled() || !started) return;
  posthog.capture(event, properties);
}

// Identified by the account's own id, not by email: the email is the user's personal data and
// there is no analysis here that needs it. is_admin travels as a property so the founder's own
// sessions can be filtered out of any chart that was built before opt-out kicked in.
export function identifyUser(userId: string | null, email: string | null): void {
  if (!enabled() || !started) return;
  const isAdmin = Boolean(email && email.toLowerCase() === ADMIN_EMAIL.toLowerCase());
  if (isAdmin) {
    posthog.opt_out_capturing();
    return;
  }
  if (userId) posthog.identify(userId, { is_admin: false });
}

export function resetUser(): void {
  if (!enabled() || !started) return;
  posthog.reset();
}
