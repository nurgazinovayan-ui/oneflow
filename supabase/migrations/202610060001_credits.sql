-- Credits instead of a monthly dollar cap (by request: «только пополнения», credits that live a year).
--
-- Run once in Supabase Studio → SQL editor, after 202610010001_generation_guard.sql.
--
-- Model:
--   * 1 credit = 1 cent of real provider cost. Everything is still logged in USD (generation_log);
--     credits are what the user sees and what gates generation.
--   * Credits arrive in packs (a top-up, an admin grant, the one-off free starter pack). Every pack
--     lives credit_pack_months (12) from the day it was added; spending always takes the pack that
--     expires first.
--   * reserve_generation keeps its signature, so no Edge Function changes are needed: before a paid
--     call it checks that the user's unexpired credits minus what is already reserved cover the
--     estimate; settle_generation logs the real cost and takes it out of the packs.
--   * Accounts listed in generation_overrides (the owner, a company domain) keep the old monthly
--     USD cap and never touch packs.
--   * Top-up pricing (tiers, minimum, maximum) lives in app_settings so the UI and the future
--     payment webhook read the same numbers: credits_for_topup(usd).

insert into public.app_settings (key, value) values
  ('topup_min_usd', 10),
  ('topup_max_usd', 500),
  ('credits_per_usd', 50),          -- $10–49
  ('topup_tier2_from_usd', 50),
  ('credits_per_usd_tier2', 55),    -- $50–199 (+10%)
  ('topup_tier3_from_usd', 200),
  ('credits_per_usd_tier3', 60),    -- $200+ (+20%)
  ('free_credits', 50),             -- one-off starter pack for every confirmed account
  ('credit_pack_months', 12)
on conflict (key) do nothing;

create table if not exists public.credit_packs (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references auth.users(id) on delete cascade,
  source text not null check (source in ('topup', 'admin', 'free')),
  credits_total integer not null check (credits_total > 0),
  credits_left integer not null check (credits_left >= 0),
  amount_usd numeric,                       -- what the user paid (top-ups)
  external_id text unique,                  -- payment id: the webhook can retry without double-crediting
  note text,
  created_at timestamptz not null default now(),
  expires_at timestamptz not null
);
alter table public.credit_packs enable row level security;  -- no policies: service role only
create index if not exists credit_packs_user_idx on public.credit_packs (user_id, expires_at) where credits_left > 0;
create unique index if not exists credit_packs_one_free on public.credit_packs (user_id) where source = 'free';

-- usd → credits (always rounds up: a 3.4¢ call costs 4 credits)
create or replace function public.usd_to_credits(p_usd numeric) returns integer
language sql immutable as $$ select greatest(0, ceil(coalesce(p_usd, 0) * 100 - 1e-9))::integer $$;

create or replace function public.setting(p_key text) returns numeric
language sql stable security definer set search_path = public as $$
  select value from public.app_settings where key = p_key
$$;

-- How many credits a top-up of p_usd buys (tiered). Null when outside the allowed range.
create or replace function public.credits_for_topup(p_usd numeric) returns integer
language plpgsql stable security definer set search_path = public as $$
declare v_rate numeric;
begin
  if p_usd is null or p_usd < setting('topup_min_usd') or p_usd > setting('topup_max_usd') then return null; end if;
  v_rate := case
    when p_usd >= setting('topup_tier3_from_usd') then setting('credits_per_usd_tier3')
    when p_usd >= setting('topup_tier2_from_usd') then setting('credits_per_usd_tier2')
    else setting('credits_per_usd') end;
  return floor(p_usd * v_rate)::integer;
end $$;

-- True when the account is on the old monthly USD cap (generation_overrides).
create or replace function public.generation_has_override(p_user uuid) returns boolean
language sql stable security definer set search_path = public as $$
  select exists (
    select 1 from public.generation_overrides o, auth.users u
     where u.id = p_user and (o.match = lower(u.email) or (o.match like '@%' and lower(u.email) like '%' || o.match))
  )
$$;

-- Adds a pack. Idempotent on p_external_id (a payment id), so a retried webhook credits once.
create or replace function public.grant_credits(p_user uuid, p_source text, p_credits integer, p_amount_usd numeric, p_note text, p_external_id text)
returns uuid
language plpgsql volatile security definer set search_path = public as $$
declare v_id uuid;
begin
  if p_credits is null or p_credits <= 0 then raise exception 'bad_amount'; end if;
  if p_external_id is not null then
    select id into v_id from public.credit_packs where external_id = p_external_id;
    if found then return v_id; end if;
  end if;
  insert into public.credit_packs (user_id, source, credits_total, credits_left, amount_usd, note, external_id, expires_at)
  values (p_user, p_source, p_credits, p_credits, p_amount_usd, p_note, p_external_id,
          now() + make_interval(months => setting('credit_pack_months')::int))
  returning id into v_id;
  return v_id;
end $$;

-- The one-off starter pack, given the first time a confirmed account is checked.
create or replace function public.ensure_free_credits(p_user uuid) returns void
language plpgsql volatile security definer set search_path = public as $$
begin
  if not exists (select 1 from auth.users where id = p_user and email_confirmed_at is not null) then return; end if;
  if coalesce(setting('free_credits'), 0) <= 0 then return; end if;
  insert into public.credit_packs (user_id, source, credits_total, credits_left, note, expires_at)
  values (p_user, 'free', setting('free_credits')::int, setting('free_credits')::int, 'Стартовые кредиты',
          now() + make_interval(months => setting('credit_pack_months')::int))
  on conflict do nothing;
end $$;

drop function if exists public.credit_balance(uuid);  -- the return shape changed during development
-- What the user sees: unexpired credits, credits held by running generations, and the soonest expiry.
create or replace function public.credit_balance(p_user uuid)
returns table (available integer, reserved integer, active_total integer, next_expiry_at timestamptz, next_expiry_credits integer, unlimited boolean)
language plpgsql volatile security definer set search_path = public as $$
begin
  perform public.ensure_free_credits(p_user);
  return query
  with packs as (
    select credits_left, credits_total, expires_at from public.credit_packs
     where user_id = p_user and credits_left > 0 and expires_at > now()
  ), soon as (
    select expires_at, sum(credits_left)::integer as c from packs group by expires_at order by expires_at limit 1
  )
  select
    coalesce((select sum(credits_left) from packs), 0)::integer,
    coalesce((select sum(public.usd_to_credits(amount_usd)) from public.generation_reservations
               where user_id = p_user and status = 'pending'), 0)::integer,
    coalesce((select sum(credits_total) from packs), 0)::integer,  -- for the ring: left of what these packs started with
    (select expires_at from soon),
    (select c from soon),
    public.generation_has_override(p_user);
end $$;

-- Same signature as before; credits instead of the monthly cap unless the account has an override.
create or replace function public.reserve_generation(p_user uuid, p_model text, p_category text, p_amount numeric)
returns uuid
language plpgsql volatile security definer set search_path = public as $$
declare
  v_spent numeric;
  v_pending numeric;
  v_running int;
  v_available integer;
  v_id uuid;
begin
  if p_amount is null or p_amount < 0 then raise exception 'bad_amount'; end if;
  if not exists (select 1 from auth.users where id = p_user and email_confirmed_at is not null) then
    raise exception 'email_not_confirmed';
  end if;
  if p_amount > setting('max_single_job_usd') then
    raise exception 'job_too_expensive';
  end if;
  perform pg_advisory_xact_lock(hashtextextended(p_user::text, 0));  -- serialises this user's reservations
  -- a crashed function must not keep budget locked forever
  update public.generation_reservations set status = 'released', settled_at = now()
   where user_id = p_user and status = 'pending' and created_at < now() - interval '20 minutes';
  select coalesce(sum(amount_usd), 0), count(*) into v_pending, v_running from public.generation_reservations
   where user_id = p_user and status = 'pending';
  if v_running >= setting('max_parallel_jobs') then
    raise exception 'too_many_jobs';
  end if;

  if public.generation_has_override(p_user) then
    select coalesce(sum(cost_usd), 0) into v_spent from public.generation_log
     where user_id = p_user and created_at >= date_trunc('month', now());
    if v_spent + v_pending + p_amount > public.generation_allowance(p_user) then
      raise exception 'quota_exceeded';
    end if;
  else
    perform public.ensure_free_credits(p_user);
    select coalesce(sum(credits_left), 0)::integer into v_available from public.credit_packs
     where user_id = p_user and credits_left > 0 and expires_at > now();
    if (select coalesce(sum(public.usd_to_credits(amount_usd)), 0) from public.generation_reservations
         where user_id = p_user and status = 'pending') + public.usd_to_credits(p_amount) > v_available then
      raise exception 'quota_exceeded';
    end if;
  end if;

  insert into public.generation_reservations (user_id, model, category, amount_usd)
  values (p_user, p_model, p_category, p_amount) returning id into v_id;
  return v_id;
end $$;

-- Success: log the real cost once, then take it out of the packs that expire first. If the real
-- cost came out a little above what was left, the packs just reach zero (the overshoot is ours).
create or replace function public.settle_generation(p_reservation uuid, p_email text, p_cost numeric)
returns void
language plpgsql volatile security definer set search_path = public as $$
declare
  r public.generation_reservations;
  v_cost numeric;
  v_need integer;
  p record;
  v_take integer;
begin
  update public.generation_reservations set status = 'settled', settled_at = now()
   where id = p_reservation and status = 'pending' returning * into r;
  if not found then return; end if;
  v_cost := coalesce(p_cost, r.amount_usd);
  insert into public.generation_log (user_id, email, model, category, cost_usd)
  values (r.user_id, p_email, r.model, r.category, v_cost);

  if public.generation_has_override(r.user_id) then return; end if;
  v_need := public.usd_to_credits(v_cost);
  for p in
    select id, credits_left from public.credit_packs
     where user_id = r.user_id and credits_left > 0 and expires_at > now()
     order by expires_at, created_at
     for update
  loop
    exit when v_need <= 0;
    v_take := least(v_need, p.credits_left);
    update public.credit_packs set credits_left = credits_left - v_take where id = p.id;
    v_need := v_need - v_take;
  end loop;
end $$;

revoke all on function public.setting(text) from public, anon, authenticated;
revoke all on function public.credits_for_topup(numeric) from public, anon, authenticated;
revoke all on function public.generation_has_override(uuid) from public, anon, authenticated;
revoke all on function public.grant_credits(uuid, text, integer, numeric, text, text) from public, anon, authenticated;
revoke all on function public.ensure_free_credits(uuid) from public, anon, authenticated;
revoke all on function public.credit_balance(uuid) from public, anon, authenticated;
revoke all on function public.reserve_generation(uuid, text, text, numeric) from public, anon, authenticated;
revoke all on function public.settle_generation(uuid, text, numeric) from public, anon, authenticated;
grant execute on function public.setting(text) to service_role;
grant execute on function public.credits_for_topup(numeric) to service_role;
grant execute on function public.generation_has_override(uuid) to service_role;
grant execute on function public.grant_credits(uuid, text, integer, numeric, text, text) to service_role;
grant execute on function public.ensure_free_credits(uuid) to service_role;
grant execute on function public.credit_balance(uuid) to service_role;
grant execute on function public.reserve_generation(uuid, text, text, numeric) to service_role;
grant execute on function public.settle_generation(uuid, text, numeric) to service_role;
