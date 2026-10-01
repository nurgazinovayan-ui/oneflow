-- Security audit C-1/M-1: server-side gate for every paid generation.
--
-- Every generate-* / evaluate-creative / marketing-ai / motion-storyboard / generate-chat call
-- first reserves its estimated cost here and only then calls the provider; afterwards it settles
-- the reservation with the real cost (or releases it on failure). Everything happens inside one
-- transaction under a per-user advisory lock, so N parallel requests can't all pass the check
-- against the same remaining budget (the race a plain "select sum(...) then insert" has).
--
-- Who may spend how much is decided in ONE place, generation_allowance() below:
--   * the email must be confirmed;
--   * an active, non-expired subscription → that plan's monthly cap;
--   * a row in generation_overrides (exact email, or '@domain') → that monthly cap;
--   * otherwise app_settings.free_monthly_usd ($1 / month without a subscription).
-- Change the numbers here (or in Supabase Studio → Table editor), not in the functions.

create table if not exists public.app_settings (
  key text primary key,
  value numeric not null
);
alter table public.app_settings enable row level security;  -- no policies: service role only
insert into public.app_settings (key, value) values
  ('free_monthly_usd', 1),        -- $ per month without a subscription
  ('paid_monthly_usd', 60),       -- cap for an active subscription
  ('max_parallel_jobs', 6),       -- in-flight generations per user (One Launch evaluates formats in parallel)
  ('max_single_job_usd', 5)       -- refuse any single request estimated above this
on conflict (key) do nothing;

-- Per-account / per-domain caps that override the defaults above, e.g. the owner, or a whole
-- company domain: insert into generation_overrides values ('@mechta.kz', 50);
create table if not exists public.generation_overrides (
  match text primary key check (match like '%@%'),  -- 'someone@site.com' or '@site.com'
  monthly_usd numeric not null check (monthly_usd >= 0)
);
alter table public.generation_overrides enable row level security;  -- no policies: service role only
insert into public.generation_overrides (match, monthly_usd) values ('nurgazinov.ayan@gmail.com', 1000)
on conflict (match) do nothing;

create table if not exists public.generation_reservations (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references auth.users(id) on delete cascade,
  model text not null,
  category text not null,
  amount_usd numeric not null check (amount_usd >= 0),
  status text not null default 'pending' check (status in ('pending', 'settled', 'released')),
  created_at timestamptz not null default now(),
  settled_at timestamptz
);
create index if not exists generation_reservations_user_idx on public.generation_reservations (user_id, status, created_at);
alter table public.generation_reservations enable row level security;  -- no policies: service role only

create or replace function public.generation_allowance(p_user uuid) returns numeric
language plpgsql stable security definer set search_path = public as $$
declare
  v_email text;
  v_confirmed timestamptz;
  v_status text;
  v_end timestamptz;
  v_override numeric;
begin
  select lower(email), email_confirmed_at into v_email, v_confirmed from auth.users where id = p_user;
  if v_confirmed is null then return 0; end if;
  select monthly_usd into v_override from public.generation_overrides
   where match = v_email or (match like '@%' and v_email like '%' || match)
   order by (match = v_email) desc, monthly_usd desc limit 1;
  select status, current_period_end into v_status, v_end from public.subscriptions where user_id = p_user;
  if v_status in ('active', 'on_trial') and (v_end is null or v_end > now()) then
    return greatest(coalesce(v_override, 0), (select value from public.app_settings where key = 'paid_monthly_usd'));
  end if;
  return coalesce(v_override, (select value from public.app_settings where key = 'free_monthly_usd'));
end $$;

-- Returns the reservation id, or raises 'email_not_confirmed' / 'quota_exceeded' / 'too_many_jobs' /
-- 'job_too_expensive' (the Edge Functions turn these into 403 / 402 / 429 / 400).
create or replace function public.reserve_generation(p_user uuid, p_model text, p_category text, p_amount numeric)
returns uuid
language plpgsql volatile security definer set search_path = public as $$
declare
  v_spent numeric;
  v_pending numeric;
  v_running int;
  v_id uuid;
begin
  if p_amount is null or p_amount < 0 then raise exception 'bad_amount'; end if;
  if not exists (select 1 from auth.users where id = p_user and email_confirmed_at is not null) then
    raise exception 'email_not_confirmed';
  end if;
  if p_amount > (select value from public.app_settings where key = 'max_single_job_usd') then
    raise exception 'job_too_expensive';
  end if;
  perform pg_advisory_xact_lock(hashtextextended(p_user::text, 0));  -- serialises this user's reservations
  -- a crashed function must not keep budget locked forever
  update public.generation_reservations set status = 'released', settled_at = now()
   where user_id = p_user and status = 'pending' and created_at < now() - interval '20 minutes';
  select coalesce(sum(cost_usd), 0) into v_spent from public.generation_log
   where user_id = p_user and created_at >= date_trunc('month', now());
  select coalesce(sum(amount_usd), 0), count(*) into v_pending, v_running from public.generation_reservations
   where user_id = p_user and status = 'pending';
  if v_running >= (select value from public.app_settings where key = 'max_parallel_jobs') then
    raise exception 'too_many_jobs';
  end if;
  if v_spent + v_pending + p_amount > public.generation_allowance(p_user) then
    raise exception 'quota_exceeded';
  end if;
  insert into public.generation_reservations (user_id, model, category, amount_usd)
  values (p_user, p_model, p_category, p_amount) returning id into v_id;
  return v_id;
end $$;

-- Success: write the real cost to generation_log and close the reservation — once. A repeated
-- call with the same id is a no-op (idempotent), so a retried request can't log twice.
create or replace function public.settle_generation(p_reservation uuid, p_email text, p_cost numeric)
returns void
language plpgsql volatile security definer set search_path = public as $$
declare r public.generation_reservations;
begin
  update public.generation_reservations set status = 'settled', settled_at = now()
   where id = p_reservation and status = 'pending' returning * into r;
  if not found then return; end if;
  insert into public.generation_log (user_id, email, model, category, cost_usd)
  values (r.user_id, p_email, r.model, r.category, coalesce(p_cost, r.amount_usd));
end $$;

-- Failure: give the reserved amount back (nothing is logged).
create or replace function public.release_generation(p_reservation uuid) returns void
language sql volatile security definer set search_path = public as $$
  update public.generation_reservations set status = 'released', settled_at = now()
   where id = p_reservation and status = 'pending';
$$;

revoke all on function public.generation_allowance(uuid) from public, anon, authenticated;
revoke all on function public.reserve_generation(uuid, text, text, numeric) from public, anon, authenticated;
revoke all on function public.settle_generation(uuid, text, numeric) from public, anon, authenticated;
revoke all on function public.release_generation(uuid) from public, anon, authenticated;
grant execute on function public.generation_allowance(uuid) to service_role;
grant execute on function public.reserve_generation(uuid, text, text, numeric) to service_role;
grant execute on function public.settle_generation(uuid, text, numeric) to service_role;
grant execute on function public.release_generation(uuid) to service_role;
