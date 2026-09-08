-- Apply once in Supabase SQL Editor, after the trends migrations.
-- Internal @mechta.kz messenger: DMs + group channels. No changes to existing tables.
--
-- Same reasoning as public.presence (see supabase/schema.sql): RLS-gated upsert-on-a-timer
-- turned out unreliable in practice for that table, so this whole feature follows the same
-- split the rest of the backend already uses -- every write (profile heartbeat, channel/
-- member creation, sending a message) goes through a service-role Edge Function
-- (messenger-heartbeat / messenger-create-channel / messenger-send-message), which also
-- re-checks the @mechta.kz domain against the caller's own verified JWT rather than trusting
-- anything the client claims. Only plain SELECTs are exposed to authenticated clients here,
-- the same way admin_messages/subscriptions are read directly via REST elsewhere in this app.
create extension if not exists pgcrypto with schema extensions;

create table if not exists public.messenger_profiles (
  email text primary key check (email ~* '^[^@\s]+@mechta\.kz$'),
  display_name text not null default '' check (length(display_name) <= 120),
  last_seen_at timestamptz not null default now()
);

create table if not exists public.messenger_channels (
  id uuid primary key default gen_random_uuid(),
  kind text not null check (kind in ('dm', 'group')),
  title text not null default '' check (length(title) <= 120),
  created_by text not null check (created_by ~* '^[^@\s]+@mechta\.kz$'),
  created_at timestamptz not null default now()
);

create table if not exists public.messenger_members (
  channel_id uuid not null references public.messenger_channels(id) on delete cascade,
  email text not null check (email ~* '^[^@\s]+@mechta\.kz$'),
  joined_at timestamptz not null default now(),
  primary key (channel_id, email)
);
create index if not exists messenger_members_email_idx on public.messenger_members (email);

create table if not exists public.messenger_messages (
  id uuid primary key default gen_random_uuid(),
  channel_id uuid not null references public.messenger_channels(id) on delete cascade,
  sender_email text not null check (sender_email ~* '^[^@\s]+@mechta\.kz$'),
  body text not null check (length(body) between 1 and 4000),
  created_at timestamptz not null default now()
);
create index if not exists messenger_messages_channel_idx on public.messenger_messages (channel_id, created_at);

alter table public.messenger_profiles enable row level security;
alter table public.messenger_channels enable row level security;
alter table public.messenger_members enable row level security;
alter table public.messenger_messages enable row level security;

-- Membership check reused by every select policy below. security definer so it can read
-- messenger_members regardless of the caller's own RLS grants; still scoped to the caller's
-- own (verified) JWT email, never a client-supplied one.
create or replace function public.is_messenger_member(p_channel_id uuid) returns boolean
language sql stable security definer set search_path = public as $$
  select exists (
    select 1 from public.messenger_members m
    where m.channel_id = p_channel_id and m.email = lower(coalesce(auth.jwt() ->> 'email', ''))
  );
$$;
revoke all on function public.is_messenger_member(uuid) from public;
grant execute on function public.is_messenger_member(uuid) to authenticated;

drop policy if exists "Mechta roster read" on public.messenger_profiles;
create policy "Mechta roster read" on public.messenger_profiles for select to authenticated
  using (lower(coalesce(auth.jwt() ->> 'email', '')) ~* '^[^@\s]+@mechta\.kz$');

drop policy if exists "Members read own channels" on public.messenger_channels;
create policy "Members read own channels" on public.messenger_channels for select to authenticated
  using (public.is_messenger_member(id));

drop policy if exists "Members read membership" on public.messenger_members;
create policy "Members read membership" on public.messenger_members for select to authenticated
  using (public.is_messenger_member(channel_id));

drop policy if exists "Members read messages" on public.messenger_messages;
create policy "Members read messages" on public.messenger_messages for select to authenticated
  using (public.is_messenger_member(channel_id));

-- No insert/update/delete policies for anon/authenticated anywhere above, on purpose: every
-- write goes through a service-role Edge Function, which re-validates the @mechta.kz domain
-- and channel membership against the caller's verified JWT before touching these tables.
revoke all on public.messenger_profiles from anon, authenticated;
grant select on public.messenger_profiles to authenticated;
revoke all on public.messenger_channels from anon, authenticated;
grant select on public.messenger_channels to authenticated;
revoke all on public.messenger_members from anon, authenticated;
grant select on public.messenger_members to authenticated;
revoke all on public.messenger_messages from anon, authenticated;
grant select on public.messenger_messages to authenticated;
grant all on public.messenger_profiles, public.messenger_channels, public.messenger_members, public.messenger_messages to service_role;
