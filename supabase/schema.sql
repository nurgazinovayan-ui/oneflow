-- Run this once in Supabase Studio → SQL Editor.
-- Tracks each user's LemonSqueezy subscription status. Written only by the
-- lemonsqueezy-webhook Edge Function (via the service role, which bypasses RLS) — the app
-- itself only ever reads its own row.
--
-- Switched from Paddle (see electron/paymentConfig.ts for why) — if this table was already
-- created by an older version of this file, the paddle_subscription_id/paddle_customer_id
-- columns from that run are harmless leftovers; the block below just adds the new
-- lemonsqueezy_* columns alongside them rather than dropping/renaming anything.

create table if not exists public.subscriptions (
  user_id uuid primary key references auth.users(id) on delete cascade,
  status text not null default 'inactive',
  lemonsqueezy_subscription_id text,
  lemonsqueezy_customer_id text,
  current_period_end timestamptz,
  updated_at timestamptz not null default now()
);

alter table public.subscriptions add column if not exists lemonsqueezy_subscription_id text;
alter table public.subscriptions add column if not exists lemonsqueezy_customer_id text;

alter table public.subscriptions enable row level security;

drop policy if exists "Users can view their own subscription" on public.subscriptions;
create policy "Users can view their own subscription"
  on public.subscriptions for select
  using (auth.uid() = user_id);

-- No insert/update/delete policies for anon/authenticated roles on purpose: with RLS enabled
-- and no such policy, those writes are rejected. Only the lemonsqueezy-webhook Edge Function
-- (using the service role key, which ignores RLS entirely) is able to write to this table.

-- Targeted admin announcements ("Можно ли писать выборочным пользователям сообщение,
-- всплывающее снизу?"). Written only by the admin-send-message Edge Function (service role,
-- which checks the caller is the app owner before inserting) — the app itself only ever reads
-- rows addressed to its own signed-in user, enforced by the select policy below.
create table if not exists public.admin_messages (
  id uuid primary key default gen_random_uuid(),
  target_user_id uuid not null references auth.users(id) on delete cascade,
  body text not null,
  created_at timestamptz not null default now()
);

alter table public.admin_messages enable row level security;

drop policy if exists "Users can view their own admin messages" on public.admin_messages;
create policy "Users can view their own admin messages"
  on public.admin_messages for select
  using (auth.uid() = target_user_id);

-- Same reasoning as subscriptions above: no write policies for anon/authenticated, so only
-- the service-role Edge Function can insert.

-- Lightweight "who's online" tracking for the admin ("возможность смотреть какой аккаунт
-- сейчас онлайн"). Each signed-in client pings the presence-heartbeat Edge Function every
-- ~45s while the app is open (see electron/main.ts / src/webApi.ts, which piggyback this on
-- AdminMessageToast's existing poll timer). A user who stops heartbeating (closed the app)
-- just ages out of the time window the admin-list-online Edge Function queries — no logout
-- hook or cleanup job needed. Written only by presence-heartbeat (service role) — an earlier
-- version let the client upsert its own row directly via RLS, but that turned out unreliable
-- in practice, so both reads and writes now go through service-role Edge Functions like
-- admin_messages/subscriptions above.
create table if not exists public.presence (
  user_id uuid primary key references auth.users(id) on delete cascade,
  email text not null,
  last_seen timestamptz not null default now()
);

alter table public.presence enable row level security;

drop policy if exists "Users can upsert their own presence" on public.presence;
drop policy if exists "Users can update their own presence" on public.presence;

-- No policies at all for anon/authenticated on purpose — regular users can neither read nor
-- write this table directly. presence-heartbeat writes and admin-list-online reads both use
-- the service role, which bypasses RLS entirely.
