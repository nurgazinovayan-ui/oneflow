// Deploy this in Supabase Studio → Edge Functions → "Create a new function" → name it
// "lemonsqueezy-webhook" → paste this file's contents → Deploy.
//
// After deploying, set this secret (Edge Functions → lemonsqueezy-webhook → Secrets):
//   LEMONSQUEEZY_WEBHOOK_SECRET — LemonSqueezy Dashboard → Settings → Webhooks → your
//                                  webhook → "Signing secret"
// (No separate Paddle-style "look up customer by id via their API" call needed here — the
// Supabase user id travels through as meta.custom_data.user_id when the app opens the
// checkout link with ?checkout[custom][user_id]=... (post-login paywall flow). When that's
// missing — e.g. the splash screen's "Купить подписку" button, which can be used before
// logging in — this falls back to matching data.attributes.user_email against Supabase auth
// users directly, since LemonSqueezy includes the buyer's email inline on the subscription
// object already.)
//
// Then in LemonSqueezy: Settings → Webhooks → Add webhook, URL = this function's URL (shown
// in Supabase Studio after deploy, looks like
// https://<project-ref>.functions.supabase.co/lemonsqueezy-webhook), and subscribe to at
// least: subscription_created, subscription_updated, subscription_cancelled,
// subscription_resumed, subscription_expired, subscription_paused, subscription_unpaused.
//
// This function only tracks subscription *status* (the `subscriptions` table below) — used by
// the toolbar's "Оформить подписку" upsell pill/avatar-menu item and by the desktop build's own
// separate paywall check (see electron/main.ts). It no longer credits any internal per-user
// balance: generation itself is funded entirely by the single shared OPENROUTER_API_KEY secret
// on each generate-*/evaluate-creative function, topped up directly at openrouter.ai — there is
// no more user_credits ledger to feed, so order_created/subscription_payment_success events are
// intentionally left unhandled below (acknowledged with 200 so LemonSqueezy doesn't retry).
//
// If an older deploy of this project already created the now-unused user_credits/credit_events
// tables and credit_user_once/reserve_credit_balance/refund_credit_balance/deduct_credit_balance
// functions, they're harmless leftovers — nothing calls them anymore. Optional one-time cleanup
// in Supabase Studio's SQL editor, if you want them gone:
//
//   drop function if exists credit_user_once(text, uuid, numeric);
//   drop function if exists deduct_credit_balance(uuid, numeric);
//   drop function if exists reserve_credit_balance(uuid, numeric);
//   drop function if exists refund_credit_balance(uuid, numeric);
//   drop table if exists credit_events;
//   drop table if exists user_credits;

import { createClient } from 'npm:@supabase/supabase-js@2';

const LEMONSQUEEZY_WEBHOOK_SECRET = Deno.env.get('LEMONSQUEEZY_WEBHOOK_SECRET') ?? '';

const supabaseAdmin = createClient(
  Deno.env.get('SUPABASE_URL')!,
  Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!
);

async function hmacSha256Hex(secret: string, message: string): Promise<string> {
  const key = await crypto.subtle.importKey(
    'raw',
    new TextEncoder().encode(secret),
    { name: 'HMAC', hash: 'SHA-256' },
    false,
    ['sign']
  );
  const signature = await crypto.subtle.sign('HMAC', key, new TextEncoder().encode(message));
  return Array.from(new Uint8Array(signature))
    .map((b) => b.toString(16).padStart(2, '0'))
    .join('');
}

function constantTimeEqual(a: string, b: string): boolean {
  if (a.length !== b.length) return false;
  let diff = 0;
  for (let i = 0; i < a.length; i++) diff |= a.charCodeAt(i) ^ b.charCodeAt(i);
  return diff === 0;
}

async function verifySignature(rawBody: string, header: string | null): Promise<boolean> {
  if (!header || !LEMONSQUEEZY_WEBHOOK_SECRET) return false;
  const expected = await hmacSha256Hex(LEMONSQUEEZY_WEBHOOK_SECRET, rawBody);
  return constantTimeEqual(expected, header.trim().toLowerCase());
}

async function findUserIdByEmail(email: string): Promise<string | null> {
  const target = email.toLowerCase();
  let page = 1;
  const perPage = 200;
  for (let i = 0; i < 10; i++) {
    const { data, error } = await supabaseAdmin.auth.admin.listUsers({ page, perPage });
    if (error || !data) return null;
    const users = data.users as { id: string; email?: string }[];
    const match = users.find((u) => (u.email ?? '').toLowerCase() === target);
    if (match) return match.id;
    if (users.length < perPage) return null;
    page += 1;
  }
  return null;
}

// Hardening (audit F-06): the body is capped before it is read, the HMAC is checked on the raw bytes
// before any parsing, and the state change goes through subscription_apply_event, which records the
// event (sha256 of the signed body) once and refuses an event older than the one already applied —
// a redelivered or out-of-order "active" can no longer revive an expired subscription.
const MAX_WEBHOOK_BYTES = 1024 * 1024;

async function sha256Hex(text: string): Promise<string> {
  const digest = await crypto.subtle.digest('SHA-256', new TextEncoder().encode(text));
  return Array.from(new Uint8Array(digest)).map((b) => b.toString(16).padStart(2, '0')).join('');
}

const isoOrNull = (v: unknown): string | null => (typeof v === 'string' && !Number.isNaN(Date.parse(v)) ? v : null);
const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

Deno.serve(async (req) => {
  if (req.method !== 'POST') return new Response('Method not allowed', { status: 405 });
  if (Number(req.headers.get('content-length') ?? '0') > MAX_WEBHOOK_BYTES) return new Response('Too large', { status: 413 });
  const rawBody = await req.text();
  if (rawBody.length > MAX_WEBHOOK_BYTES) return new Response('Too large', { status: 413 });
  const signatureHeader = req.headers.get('X-Signature');

  const valid = await verifySignature(rawBody, signatureHeader);
  if (!valid) {
    return new Response('Invalid signature', { status: 401 });
  }

  let payload: any;
  try {
    payload = JSON.parse(rawBody);
  } catch {
    return new Response('Bad payload', { status: 400 });
  }
  const eventName: string = String(payload.meta?.event_name ?? '');
  const attributes = payload.data?.attributes ?? {};

  if (!eventName.startsWith('subscription_')) {
    // Not something we track (credits are never granted from here) — acknowledge so it is not retried.
    return new Response('ok', { status: 200 });
  }

  // custom_data.user_id comes from the checkout link the app opened for a signed-in user; it is a
  // hint, not proof, so it must be a real uuid of an existing account (checked in the database).
  let userId: string | undefined = typeof payload.meta?.custom_data?.user_id === 'string' && UUID_RE.test(payload.meta.custom_data.user_id)
    ? payload.meta.custom_data.user_id
    : undefined;
  if (!userId && typeof attributes.user_email === 'string') {
    userId = (await findUserIdByEmail(attributes.user_email)) ?? undefined;
  }
  if (!userId) {
    console.error('lemonsqueezy-webhook: could not resolve the account', { eventName });
    return new Response('ok', { status: 200 });
  }

  const status: string | undefined = typeof attributes.status === 'string' ? attributes.status : undefined;
  if (!status) {
    console.error('lemonsqueezy-webhook: missing status', { eventName });
    return new Response('ok', { status: 200 });
  }
  // Active subscriptions have renews_at set; cancelled/expired ones have ends_at instead.
  const currentPeriodEnd = isoOrNull(attributes.renews_at) ?? isoOrNull(attributes.ends_at);

  const { data: outcome, error } = await supabaseAdmin.rpc('subscription_apply_event', {
    p_event_id: await sha256Hex(rawBody),
    p_event_name: eventName,
    p_user: userId,
    p_status: status,
    p_subscription_id: payload.data?.id != null ? String(payload.data.id) : null,
    p_customer_id: attributes.customer_id != null ? String(attributes.customer_id) : null,
    p_period_end: currentPeriodEnd,
    p_provider_updated_at: isoOrNull(attributes.updated_at),
  });
  if (error) {
    console.error('subscription_apply_event failed', error);
    return new Response('error', { status: 500 }); // LemonSqueezy retries; the event id makes the retry safe
  }
  if (outcome !== 'applied') console.warn('lemonsqueezy-webhook:', outcome, eventName);
  return new Response('ok', { status: 200 });
});
