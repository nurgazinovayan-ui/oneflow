-- Acceptance of the Terms of Service and the Privacy Policy (by request: without it neither sign-up
-- nor payment goes through).
--
-- Run once in Supabase Studio -> SQL editor, after 202610060001_credits.sql (uses public.setting).
-- Safe to run again.
--
--   * legal_consents keeps every acceptance: which edition, when, from which IP and browser, and in
--     which context (signup, login, payment). The legal-consent Edge Function writes it after login
--     and before payment; the trigger below writes it for e-mail sign-ups.
--   * E-mail sign-up: the app sends the accepted edition in the sign-up metadata (legal_version).
--     A sign-up without it is refused by the database itself, so it cannot be skipped by calling
--     the auth API directly. Google sign-ups cannot carry metadata: the app shows the window before
--     the redirect and the app stays locked after login until the acceptance is on record.
--   * legal_version is the edition users accept; it equals LEGAL_VERSION in src/legalContent.ts.
--     Raising it asks every account to accept again at the next login.
--   * legal_enforce_signup = 0 lets a sign-up without the metadata through (for example a user
--     added by hand in Authentication -> Users). Set it back to 1 afterwards.

insert into public.app_settings (key, value) values
  ('legal_version', 20260901),
  ('legal_enforce_signup', 1)
on conflict (key) do nothing;

create table if not exists public.legal_consents (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references auth.users(id) on delete cascade,
  version integer not null,
  context text not null check (context in ('signup', 'login', 'payment')),
  accepted_at timestamptz not null default now(),
  ip text,
  user_agent text,
  details jsonb
);
alter table public.legal_consents enable row level security;  -- no policies: service role only
create index if not exists legal_consents_user_idx on public.legal_consents (user_id, version);

-- True when the account has accepted the current edition (or a newer one).
create or replace function public.has_legal_consent(p_user uuid) returns boolean
language sql stable security definer set search_path = public as $fn$
  select exists (
    select 1 from public.legal_consents
     where user_id = p_user and version >= public.setting('legal_version')
  )
$fn$;

-- Before an e-mail account is created: the sign-up must carry the accepted edition.
create or replace function public.legal_signup_guard() returns trigger
language plpgsql security definer set search_path = public as $fn$
declare
  v_meta text := new.raw_user_meta_data ->> 'legal_version';
begin
  if coalesce(new.raw_app_meta_data ->> 'provider', '') <> 'email' then return new; end if;
  if coalesce(public.setting('legal_enforce_signup'), 1) = 0 then return new; end if;
  if v_meta is null or v_meta !~ '^[0-9]{8}$' or v_meta::integer < public.setting('legal_version') then
    raise exception 'legal_consent_required' using errcode = 'check_violation';
  end if;
  return new;
end $fn$;

-- After any account is created with the accepted edition in its metadata: keep the record.
create or replace function public.legal_signup_record() returns trigger
language plpgsql security definer set search_path = public as $fn$
declare
  v_meta text := new.raw_user_meta_data ->> 'legal_version';
begin
  if v_meta is not null and v_meta ~ '^[0-9]{8}$' then
    insert into public.legal_consents (user_id, version, context, details)
    values (new.id, v_meta::integer, 'signup',
            jsonb_build_object('provider', new.raw_app_meta_data ->> 'provider',
                               'client_accepted_at', left(new.raw_user_meta_data ->> 'legal_accepted_at', 40)));
  end if;
  return new;
end $fn$;

drop trigger if exists legal_signup_guard on auth.users;
create trigger legal_signup_guard before insert on auth.users
  for each row execute function public.legal_signup_guard();
drop trigger if exists legal_signup_record on auth.users;
create trigger legal_signup_record after insert on auth.users
  for each row execute function public.legal_signup_record();

revoke all on function public.has_legal_consent(uuid) from public, anon, authenticated;
revoke all on function public.legal_signup_guard() from public, anon, authenticated;
revoke all on function public.legal_signup_record() from public, anon, authenticated;
grant execute on function public.has_legal_consent(uuid) to service_role;
