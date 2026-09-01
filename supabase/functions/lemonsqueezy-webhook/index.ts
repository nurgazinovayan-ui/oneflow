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
// Also requires the user_credits/credit_events tables and the credit_user_once() function —
// see the SQL block at the bottom of this comment. Run it once in Supabase Studio's SQL editor.
//
// Then in LemonSqueezy: Settings → Webhooks → Add webhook, URL = this function's URL (shown
// in Supabase Studio after deploy, looks like
// https://<project-ref>.functions.supabase.co/lemonsqueezy-webhook), and subscribe to at
// least: subscription_created, subscription_updated, subscription_cancelled,
// subscription_resumed, subscription_expired, subscription_paused, subscription_unpaused,
// order_created, subscription_payment_success.
//
// order_created fires for a one-time purchase; subscription_payment_success fires each time a
// recurring subscription charge succeeds. Both credit the buyer's user_credits.balance_usd at
// 85% of the real amount charged (attributes.total, in cents) — a one-time top-up that
// accumulates and never resets/expires, kept separate from the subscriptions status table
// above (which only tracks active/cancelled/etc., not money). The 15% held back is the app's
// margin: real Replicate usage is billed to the one shared owner API key regardless of who
// generates, so this is what actually funds that account per paying user.
//
// SQL (run once):
//
//   create table if not exists user_credits (
//     user_id uuid primary key references auth.users(id) on delete cascade,
//     balance_usd numeric not null default 0,
//     updated_at timestamptz default now()
//   );
//   alter table user_credits enable row level security;
//   create policy "select own balance" on user_credits
//     for select using (auth.uid() = user_id);
//   -- No insert/update/delete policy — only Edge Functions (service-role client, which
//   -- bypasses RLS) ever write to this table.
//
//   create table if not exists credit_events (
//     event_id text primary key,
//     user_id uuid not null references auth.users(id) on delete cascade,
//     amount_usd numeric not null,
//     created_at timestamptz default now()
//   );
//   alter table credit_events enable row level security;
//   -- No policies — service-role only, same as user_credits. This table exists purely so a
//   -- retried webhook delivery (same LemonSqueezy event id) can't double-credit a balance.
//
//   create or replace function credit_user_once(p_event_id text, p_user_id uuid, p_amount_usd numeric)
//   returns boolean
//   language plpgsql
//   as $$
//   begin
//     insert into credit_events (event_id, user_id, amount_usd)
//     values (p_event_id, p_user_id, p_amount_usd);
//
//     insert into user_credits (user_id, balance_usd)
//     values (p_user_id, p_amount_usd)
//     on conflict (user_id) do update
//       set balance_usd = user_credits.balance_usd + p_amount_usd,
//           updated_at = now();
//
//     return true;
//   exception
//     when unique_violation then
//       return false;
//   end;
//   $$;
//
//   create or replace function deduct_credit_balance(p_user_id uuid, p_amount_usd numeric)
//   returns numeric
//   language plpgsql
//   as $$
//   declare
//     new_balance numeric;
//   begin
//     update user_credits
//       set balance_usd = greatest(balance_usd - p_amount_usd, 0),
//           updated_at = now()
//     where user_id = p_user_id
//     returning balance_usd into new_balance;
//     return coalesce(new_balance, 0);
//   end;
//   $$;

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
  const attributes = payload.data?.attributes ?? {};

  let userId: string | undefined = payload.meta?.custom_data?.user_id;
  if (!userId && attributes.user_email) {
    userId = (await findUserIdByEmail(attributes.user_email)) ?? undefined;
  }

  if (!userId) {
    console.error('lemonsqueezy-webhook: could not resolve user_id', {
      eventName,
      email: attributes.user_email,
    });
    return new Response('ok', { status: 200 });
  }

  // order_created (one-time purchase) and subscription_payment_success (a recurring charge
  // succeeding) are the only events that represent real money changing hands — credit 85% of
  // the actual charged amount as a permanent balance top-up. Everything else below is
  // subscription *status* bookkeeping, unrelated to the balance.
  if (eventName === 'order_created' || eventName === 'subscription_payment_success') {
    // 'paid' is the only status that means the charge actually succeeded — order_created can
    // also fire for e.g. a $0 test order, and invoices can be created before payment clears.
    if (attributes.status !== 'paid' || typeof attributes.total !== 'number') {
      return new Response('ok', { status: 200 });
    }
    const totalUsd = attributes.total / 100;
    const creditUsd = Math.round(totalUsd * 0.85 * 100) / 100;
    const eventId = `${eventName}:${payload.data?.id ?? crypto.randomUUID()}`;

    const { error } = await supabaseAdmin.rpc('credit_user_once', {
      p_event_id: eventId,
      p_user_id: userId,
      p_amount_usd: creditUsd,
    });
    if (error) {
      console.error('Failed to credit balance', error);
      return new Response('error', { status: 500 });
    }
    return new Response('ok', { status: 200 });
  }

  if (!eventName.startsWith('subscription_')) {
    // Not something we track — acknowledge so LemonSqueezy doesn't retry.
    return new Response('ok', { status: 200 });
  }

  const status: string | undefined = attributes.status;
  // Active subscriptions have renews_at set; cancelled/expired ones have ends_at instead.
  const currentPeriodEnd: string | null = attributes.renews_at ?? attributes.ends_at ?? null;

  if (!status) {
    console.error('lemonsqueezy-webhook: missing status', { userId, eventName });
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
