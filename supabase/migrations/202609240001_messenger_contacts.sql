-- Apply once in Supabase SQL Editor, after 202609070003_messenger.sql,
-- 202609070004_messenger_media.sql and 202609090001_messenger_read_files.sql.
--
-- Opens the messenger to every registered account (it was @mechta.kz + the owner only) and adds
-- contacts by invitation:
--   * @mechta.kz accounts still see each other automatically, exactly as before.
--   * Everyone else starts with an empty roster and adds people with «Пригласить соавтора»: the
--     invitee gets an accept/decline prompt, and an accepted invite makes the two contacts.
--   * Who may message whom is enforced in messenger-create-channel / messenger-roster (service
--     role), not here — this file only removes the domain restriction from the tables and adds
--     the invites table those functions read.

-- 1. The domain restriction lived in CHECK constraints on four tables
--    (check (public.is_messenger_allowed_email(...)) on profiles.email, channels.created_by,
--    members.email, messages.sender_email). They were declared inline, so Postgres named them
--    itself; drop whichever constraints reference the function rather than guessing names.
do $$
declare r record;
begin
  for r in
    select c.conrelid::regclass as tbl, c.conname
    from pg_constraint c
    where c.contype = 'c'
      and c.conrelid in ('public.messenger_profiles'::regclass, 'public.messenger_channels'::regclass,
                         'public.messenger_members'::regclass, 'public.messenger_messages'::regclass)
      and pg_get_constraintdef(c.oid) ilike '%is_messenger_allowed_email%'
  loop
    execute format('alter table %s drop constraint %I', r.tbl, r.conname);
  end loop;
end $$;

-- is_messenger_allowed_email() itself stays: the "Mechta roster read" RLS policy on
-- messenger_profiles still uses it, which keeps direct REST reads of that table limited to
-- @mechta.kz. The app never reads it directly (everything goes through the service-role Edge
-- Functions), so non-Mechta users lose nothing — and can't list Mechta's staff through it.

-- 2. Invitations. One row per invite; an accepted row is what makes two people contacts.
create table if not exists public.messenger_invites (
  id uuid primary key default gen_random_uuid(),
  from_email text not null check (length(from_email) between 3 and 320),
  to_email text not null check (length(to_email) between 3 and 320),
  status text not null default 'pending' check (status in ('pending', 'accepted', 'declined')),
  created_at timestamptz not null default now(),
  responded_at timestamptz,
  check (from_email <> to_email)
);

-- At most one live link (pending or accepted) per unordered pair, whoever invited whom.
create unique index if not exists messenger_invites_live_pair_idx
  on public.messenger_invites (least(from_email, to_email), greatest(from_email, to_email))
  where status in ('pending', 'accepted');
create index if not exists messenger_invites_to_idx on public.messenger_invites (to_email, status);
create index if not exists messenger_invites_from_idx on public.messenger_invites (from_email, created_at desc);

-- Service role only, like every other messenger table: RLS on, no policies.
alter table public.messenger_invites enable row level security;
