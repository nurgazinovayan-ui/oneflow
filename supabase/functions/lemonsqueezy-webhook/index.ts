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
  return constantTimeEqual(expected, header);
}

async function findUserIdByEmail(email: string): Promise<string | null> {
  const target = email.toLowerCase();
  let page = 1;
  const perPage = 200;
  for (let i = 0; i < 10; i++) {
    const { data, error } = await supabaseAdmin.auth.admin.listUsers({ page, perPage });
    if (error || !data) return null;
    const match = data.users.find((u) => (u.email ?? '').toLowerCase() === target);
    if (match) return match.id;
    if (data.users.length < perPage) return null;
    page += 1;
  }
  return null;
}

Deno.serve(async (req) => {
  const rawBody = await req.text();
  const signatureHeader = req.headers.get('X-Signature');

  const valid = await verifySignature(rawBody, signatureHeader);
  if (!valid) {
    return new Response('Invalid signature', { status: 401 });
  }

  const payload = JSON.parse(rawBody);
  const eventName: string = payload.meta?.event_name ?? '';

  if (!eventName.startsWith('subscription_')) {
    // Not something we track — acknowledge so LemonSqueezy doesn't retry.
    return new Response('ok', { status: 200 });
  }

  const attributes = payload.data?.attributes ?? {};
  const status: string | undefined = attributes.status;
  // Active subscriptions have renews_at set; cancelled/expired ones have ends_at instead.
  const currentPeriodEnd: string | null = attributes.renews_at ?? attributes.ends_at ?? null;

  let userId: string | undefined = payload.meta?.custom_data?.user_id;
  if (!userId && attributes.user_email) {
    userId = (await findUserIdByEmail(attributes.user_email)) ?? undefined;
  }

  if (!userId || !status) {
    console.error('lemonsqueezy-webhook: missing user_id or status', {
      userId,
      status,
      email: attributes.user_email,
    });
    return new Response('ok', { status: 200 });
  }

  const { error } = await supabaseAdmin.from('subscriptions').upsert({
    user_id: userId,
    status,
    lemonsqueezy_subscription_id: payload.data?.id ?? null,
    lemonsqueezy_customer_id: attributes.customer_id ? String(attributes.customer_id) : null,
    current_period_end: currentPeriodEnd,
    updated_at: new Date().toISOString(),
  });

  if (error) {
    console.error('Failed to upsert subscription', error);
    return new Response('error', { status: 500 });
  }

  return new Response('ok', { status: 200 });
});
