-- Security hardening: money, abuse and audit (docs/security/audit.md, items F-01 … F-12).
--
-- Apply once in Supabase Studio → SQL editor, AFTER 202610010001_generation_guard.sql,
-- 202610060001_credits.sql and 202610070001_legal_consent.sql. Safe to re-run. It never deletes
-- users, projects, credit packs or generation history, and never lowers a balance.
--
-- What it adds:
--   * reserve_generation_v2: one atomic gate for every paid call. Under a per-user advisory lock it
--     checks, in this order: the kill switch, a per-account block, e-mail confirmation, the
--     single-job ceiling, the idempotency key, per-user and per-IP request rates, parallel jobs,
--     the global and per-user spend caps, the organisation (domain) pool, and finally credits or
--     the monthly allowance.
--   * Idempotency: a repeated Idempotency-Key of the same user never creates a second paid job.
--   * Async provider jobs (video): a reservation can be "submitted" (the provider accepted and will
--     bill us); such budget is never auto-released, only resolved by the owner polling the job or
--     by the reconciler, which charges the estimate after submitted_job_max_hours.
--   * A credit ledger (credit_ledger) and debts (credit_debts): a real cost above what was left on
--     the packs is recorded as a debt that the next top-up repays, instead of being lost. The sum of
--     a user ledger always equals credits_available().
--   * security_events: an append-only journal for spend alerts, kill-switch flips, admin actions,
--     webhook anomalies and rate-limit blocks.
--   * rate_limit_hit: a distributed fixed-window limiter in Postgres (shared by every Edge Function
--     instance, so it is not a per-process in-memory counter).
--   * Webhook idempotency and ordering for subscription events (webhook_events,
--     subscription_apply_event).
--   * messenger-files becomes a private bucket (files are served by short-lived signed URLs).
--
-- Comments avoid apostrophes and dollar signs on purpose: the Studio SQL editor splits scripts on
-- them inside comments. Function bodies use dollar-fn quoting.
--
-- Money thresholds are NOT invented here: every USD cap below starts at -1 (= off) and must be
-- set by the owner, see docs/security/deployment.md («Что нужно утвердить владельцу»).

-- ---------------------------------------------------------------------------------------------
-- 1. Settings
insert into public.app_settings (key, value) values
  ('paid_generation_enabled', 1),   -- kill switch: 0 stops every new paid job at once
  ('global_daily_usd_cap', -1),     -- OWNER MUST SET: all users together, per UTC day
  ('global_hourly_usd_cap', -1),    -- OWNER MUST SET: all users together, rolling hour
  ('user_daily_usd_cap', -1),       -- OWNER MUST SET: one account, per UTC day
  ('alert_user_daily_usd', -1),     -- OWNER MUST SET: journal + notify when one account passes it
  ('alert_global_daily_usd', -1),   -- OWNER MUST SET: journal + notify when the service passes it
  ('user_paid_per_minute', 30),     -- technical rate limit: paid requests per account per minute
  ('ip_paid_per_minute', 120),      -- technical rate limit: paid requests per client IP per minute
  ('submitted_job_max_hours', 24),  -- an unpolled provider job is charged at its estimate after this
  ('pending_job_max_minutes', 20)   -- a synchronous job older than this is treated as crashed
on conflict (key) do nothing;

-- Organisation pool: a domain row in generation_overrides (for example @mechta.kz) may also cap
-- the whole domain per month, on top of the per-account cap it already gives.
alter table public.generation_overrides add column if not exists pool_monthly_usd numeric
  check (pool_monthly_usd is null or pool_monthly_usd >= 0);

-- ---------------------------------------------------------------------------------------------
-- 2. Reservations become jobs
alter table public.generation_reservations add column if not exists idempotency_key text
  check (idempotency_key is null or idempotency_key ~ '^[A-Za-z0-9_-]{8,80}$');
alter table public.generation_reservations add column if not exists function_name text;
alter table public.generation_reservations add column if not exists client_ip_hash text;
alter table public.generation_reservations add column if not exists provider_job_id text;
alter table public.generation_reservations add column if not exists submitted_at timestamptz;
alter table public.generation_reservations add column if not exists updated_at timestamptz not null default now();
alter table public.generation_reservations add column if not exists cost_usd numeric;
alter table public.generation_reservations add column if not exists result jsonb;
alter table public.generation_reservations add column if not exists close_reason text;
alter table public.generation_reservations drop constraint if exists generation_reservations_status_check;
alter table public.generation_reservations add constraint generation_reservations_status_check
  check (status in ('pending', 'submitted', 'finishing', 'settled', 'released', 'expired'));
create unique index if not exists generation_reservations_idem_idx
  on public.generation_reservations (user_id, idempotency_key) where idempotency_key is not null;
create index if not exists generation_reservations_open_idx
  on public.generation_reservations (status, created_at) where status in ('pending', 'submitted', 'finishing');
create index if not exists generation_reservations_ip_idx
  on public.generation_reservations (client_ip_hash, created_at) where client_ip_hash is not null;
create index if not exists generation_reservations_created_idx on public.generation_reservations (created_at);

-- ---------------------------------------------------------------------------------------------
-- 3. Ledger, debts, journal, limiter, webhooks
create table if not exists public.credit_ledger (
  id bigserial primary key,
  user_id uuid not null references auth.users(id) on delete cascade,
  delta integer not null,
  kind text not null check (kind in ('topup', 'admin', 'free', 'spend', 'debt', 'debt_repaid', 'auto_settle')),
  reservation_id uuid,
  pack_id uuid,
  note text,
  created_at timestamptz not null default now()
);
create index if not exists credit_ledger_user_idx on public.credit_ledger (user_id, created_at desc);
alter table public.credit_ledger enable row level security;  -- no policies: service role only

create table if not exists public.credit_debts (
  user_id uuid primary key references auth.users(id) on delete cascade,
  credits integer not null default 0 check (credits >= 0),
  updated_at timestamptz not null default now()
);
alter table public.credit_debts enable row level security;  -- no policies: service role only

create table if not exists public.security_events (
  id bigserial primary key,
  created_at timestamptz not null default now(),
  kind text not null check (length(kind) <= 60),
  severity text not null default 'info' check (severity in ('info', 'warning', 'critical')),
  user_id uuid,
  details jsonb not null default '{}'::jsonb,
  dedupe_key text unique
);
create index if not exists security_events_created_idx on public.security_events (created_at desc);
create index if not exists security_events_kind_idx on public.security_events (kind, created_at desc);
alter table public.security_events enable row level security;  -- no policies: service role only

create table if not exists public.rate_limit_counters (
  bucket text not null check (length(bucket) <= 200),
  window_start timestamptz not null,
  hits integer not null default 0,
  primary key (bucket, window_start)
);
alter table public.rate_limit_counters enable row level security;  -- no policies: service role only

create table if not exists public.webhook_events (
  id text primary key,               -- sha256 of the raw signed body
  provider text not null,
  event_name text not null default '',
  received_at timestamptz not null default now(),
  outcome text not null default 'received'
);
alter table public.webhook_events enable row level security;  -- no policies: service role only
alter table public.subscriptions add column if not exists provider_updated_at timestamptz;

-- Per-account stop for paid generation (incident response). A row blocks every new paid job of
-- that user, whatever the credits, subscription or override say. Removing the row lifts it. The
-- user, projects and credits stay untouched.
create table if not exists public.generation_blocks (
  user_id uuid primary key references auth.users(id) on delete cascade,
  reason text not null default '' check (length(reason) <= 500),
  created_at timestamptz not null default now()
);
alter table public.generation_blocks enable row level security;  -- no policies: service role only

-- ---------------------------------------------------------------------------------------------
-- 4. Helpers
create or replace function public.log_security_event(p_kind text, p_severity text, p_user uuid, p_details jsonb, p_dedupe text)
returns boolean
language plpgsql volatile security definer set search_path = public as $fn$
begin
  insert into public.security_events (kind, severity, user_id, details, dedupe_key)
  values (left(p_kind, 60), case when p_severity in ('info', 'warning', 'critical') then p_severity else 'info' end,
          p_user, coalesce(p_details, '{}'::jsonb), p_dedupe)
  on conflict (dedupe_key) do nothing;
  return found;
end $fn$;

-- Fixed-window counter. Returns 0 when the hit is allowed, otherwise the seconds until the window
-- resets (for Retry-After). One row per bucket and window; old windows are swept now and then.
create or replace function public.rate_limit_hit(p_bucket text, p_limit integer, p_window_seconds integer)
returns integer
language plpgsql volatile security definer set search_path = public as $fn$
declare
  v_window timestamptz;
  v_hits integer;
begin
  if p_limit is null or p_limit <= 0 or p_window_seconds is null or p_window_seconds <= 0 then return 0; end if;
  v_window := to_timestamp(floor(extract(epoch from now()) / p_window_seconds) * p_window_seconds);
  insert into public.rate_limit_counters as c (bucket, window_start, hits) values (left(p_bucket, 200), v_window, 1)
  on conflict (bucket, window_start) do update set hits = c.hits + 1
  returning hits into v_hits;
  if random() < 0.01 then
    delete from public.rate_limit_counters where window_start < now() - interval '1 day';
  end if;
  if v_hits > p_limit then
    return greatest(1, ceil(extract(epoch from (v_window + make_interval(secs => p_window_seconds) - now())))::integer);
  end if;
  return 0;
end $fn$;

-- Unexpired credits minus debt.
create or replace function public.credits_available(p_user uuid) returns integer
language sql stable security definer set search_path = public as $fn$
  select greatest(0,
    coalesce((select sum(credits_left) from public.credit_packs
               where user_id = p_user and credits_left > 0 and expires_at > now()), 0)::integer
    - coalesce((select credits from public.credit_debts where user_id = p_user), 0))
$fn$;

-- ---------------------------------------------------------------------------------------------
-- 5. Credits in: packs repay debt first, every change goes to the ledger
create or replace function public.grant_credits(p_user uuid, p_source text, p_credits integer, p_amount_usd numeric, p_note text, p_external_id text)
returns uuid
language plpgsql volatile security definer set search_path = public as $fn$
declare
  v_id uuid;
  v_debt integer;
  v_pay integer;
begin
  if p_credits is null or p_credits <= 0 then raise exception 'bad_amount'; end if;
  if p_source not in ('topup', 'admin', 'free') then raise exception 'bad_source'; end if;
  insert into public.credit_packs (user_id, source, credits_total, credits_left, amount_usd, note, external_id, expires_at)
  values (p_user, p_source, p_credits, p_credits, p_amount_usd, p_note, p_external_id,
          now() + make_interval(months => setting('credit_pack_months')::int))
  on conflict (external_id) do nothing
  returning id into v_id;
  if v_id is null then  -- the same payment again: credited once
    select id into v_id from public.credit_packs where external_id = p_external_id;
    return v_id;
  end if;
  insert into public.credit_ledger (user_id, delta, kind, pack_id, note) values (p_user, p_credits, p_source, v_id, left(p_note, 300));
  select credits into v_debt from public.credit_debts where user_id = p_user for update;
  if coalesce(v_debt, 0) > 0 then
    v_pay := least(v_debt, p_credits);
    update public.credit_packs set credits_left = credits_left - v_pay where id = v_id;
    update public.credit_debts set credits = credits - v_pay, updated_at = now() where user_id = p_user;
    -- the debt row already lowered the balance when it was taken, so repaying it moves credits
    -- between pack and debt without changing what is available: a zero-delta audit entry
    insert into public.credit_ledger (user_id, delta, kind, pack_id, note) values (p_user, 0, 'debt_repaid', v_id, v_pay || ' credits of debt repaid from this pack');
  end if;
  return v_id;
end $fn$;

create or replace function public.ensure_free_credits(p_user uuid) returns void
language plpgsql volatile security definer set search_path = public as $fn$
declare v_id uuid;
begin
  if not exists (select 1 from auth.users where id = p_user and email_confirmed_at is not null) then return; end if;
  if coalesce(setting('free_credits'), 0) <= 0 then return; end if;
  insert into public.credit_packs (user_id, source, credits_total, credits_left, note, expires_at)
  values (p_user, 'free', setting('free_credits')::int, setting('free_credits')::int, 'Стартовые кредиты',
          now() + make_interval(months => setting('credit_pack_months')::int))
  on conflict do nothing
  returning id into v_id;
  if v_id is not null then
    insert into public.credit_ledger (user_id, delta, kind, pack_id, note) values (p_user, setting('free_credits')::int, 'free', v_id, 'starter pack');
  end if;
end $fn$;

-- ---------------------------------------------------------------------------------------------
-- 6. Credits out
drop function if exists public.settle_generation(uuid, text, numeric);
create or replace function public.settle_generation(p_reservation uuid, p_email text, p_cost numeric, p_result jsonb default null)
returns void
language plpgsql volatile security definer set search_path = public as $fn$
declare
  r public.generation_reservations;
  v_cost numeric;
  v_need integer;
  v_taken integer := 0;
  p record;
  v_take integer;
begin
  update public.generation_reservations
     set status = 'settled', settled_at = now(), updated_at = now(),
         cost_usd = greatest(coalesce(p_cost, amount_usd), 0),
         result = case when p_result is not null and length(p_result::text) <= 65536 then p_result end
   where id = p_reservation and status in ('pending', 'submitted', 'finishing')
  returning * into r;
  if not found then return; end if;  -- already settled or released: a repeated call is a no-op
  v_cost := r.cost_usd;
  insert into public.generation_log (user_id, email, model, category, cost_usd)
  values (r.user_id, coalesce(p_email, ''), r.model, r.category, v_cost);

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
    v_taken := v_taken + v_take;
  end loop;
  if v_taken > 0 then
    insert into public.credit_ledger (user_id, delta, kind, reservation_id, note)
    values (r.user_id, -v_taken, case when r.close_reason = 'auto_settle' then 'auto_settle' else 'spend' end, r.id, left(r.model, 120));
  end if;
  if v_need > 0 then  -- the real cost was above what the packs held: a debt, repaid by the next pack
    insert into public.credit_debts as d (user_id, credits) values (r.user_id, v_need)
    on conflict (user_id) do update set credits = d.credits + excluded.credits, updated_at = now();
    insert into public.credit_ledger (user_id, delta, kind, reservation_id, note) values (r.user_id, -v_need, 'debt', r.id, left(r.model, 120));
    perform public.log_security_event('credit_debt', 'warning', r.user_id,
      jsonb_build_object('reservation', r.id, 'credits', v_need, 'model', r.model), null);
  end if;
end $fn$;

-- Failure before the provider billed anything: give the reservation back.
create or replace function public.release_generation(p_reservation uuid) returns void
language sql volatile security definer set search_path = public as $fn$
  update public.generation_reservations set status = 'released', settled_at = now(), updated_at = now(), close_reason = coalesce(close_reason, 'failed')
   where id = p_reservation and status in ('pending', 'submitted', 'finishing');
$fn$;

-- The provider accepted an async job: from now on the budget is held until the job resolves.
create or replace function public.mark_generation_submitted(p_reservation uuid, p_provider_job text) returns boolean
language plpgsql volatile security definer set search_path = public as $fn$
begin
  update public.generation_reservations
     set status = 'submitted', provider_job_id = left(p_provider_job, 200), submitted_at = now(), updated_at = now()
   where id = p_reservation and status = 'pending';
  return found;
end $fn$;

-- Exactly one poller may finish (download, store, settle) a completed async job. A claim older
-- than ten minutes is considered abandoned and can be taken again.
create or replace function public.claim_generation_completion(p_reservation uuid, p_user uuid) returns boolean
language plpgsql volatile security definer set search_path = public as $fn$
begin
  update public.generation_reservations set status = 'finishing', updated_at = now()
   where id = p_reservation and user_id = p_user
     and (status = 'submitted' or (status = 'finishing' and updated_at < now() - interval '10 minutes'));
  return found;
end $fn$;

-- Close what is stuck. Synchronous jobs (pending, no provider id) older than pending_job_max_minutes
-- crashed before or during the call: released, recorded as expired, and journaled. Async jobs the
-- provider accepted (submitted/finishing) and nobody polled for submitted_job_max_hours are
-- charged at their estimate, because the provider billed us.
create or replace function public.reconcile_generations(p_user uuid default null) returns integer
language plpgsql volatile security definer set search_path = public as $fn$
declare
  r record;
  n integer := 0;
begin
  for r in
    update public.generation_reservations set status = 'expired', settled_at = now(), updated_at = now(), close_reason = 'stale_pending'
     where status = 'pending' and (p_user is null or user_id = p_user)
       and created_at < now() - make_interval(mins => coalesce(setting('pending_job_max_minutes'), 20)::int)
    returning id, user_id, model, amount_usd
  loop
    n := n + 1;
    perform public.log_security_event('job_expired', 'warning', r.user_id,
      jsonb_build_object('reservation', r.id, 'model', r.model, 'usd', r.amount_usd), 'job_expired:' || r.id);
  end loop;
  for r in
    select g.id, g.user_id, u.email from public.generation_reservations g join auth.users u on u.id = g.user_id
     where g.status in ('submitted', 'finishing') and (p_user is null or g.user_id = p_user)
       and coalesce(g.submitted_at, g.created_at) < now() - make_interval(hours => coalesce(setting('submitted_job_max_hours'), 24)::int)
  loop
    update public.generation_reservations set close_reason = 'auto_settle' where id = r.id;
    perform public.settle_generation(r.id, r.email, null, null);
    perform public.log_security_event('job_auto_settled', 'warning', r.user_id, jsonb_build_object('reservation', r.id), 'job_auto_settled:' || r.id);
    n := n + 1;
  end loop;
  return n;
end $fn$;

-- ---------------------------------------------------------------------------------------------
-- 7. The gate
-- Returns {id, replay, status, result, alert} or {error, retry_after}. Errors: bad_amount,
-- service_paused, account_blocked, email_not_confirmed, job_too_expensive, bad_idempotency_key, rate_limited,
-- too_many_jobs, spend_limit, quota_exceeded. Refusals are RETURNED, not raised, so the journal
-- entries written on the way (security_events) are committed instead of rolled back.
create or replace function public.reserve_generation_v2(
  p_user uuid, p_model text, p_category text, p_amount numeric,
  p_idempotency_key text default null, p_function text default null, p_ip_hash text default null)
returns jsonb
language plpgsql volatile security definer set search_path = public as $fn$
declare
  v_existing public.generation_reservations;
  v_email text;
  v_pending numeric;
  v_running int;
  v_available integer;
  v_recent int;
  v_global_day numeric;
  v_global_hour numeric;
  v_user_day numeric;
  v_spent numeric;
  v_domain text;
  v_pool numeric;
  v_alert text;
  v_id uuid;
  v_global_caps boolean;
begin
  if p_amount is null or p_amount < 0 then return jsonb_build_object('error', 'bad_amount'); end if;
  if coalesce(setting('paid_generation_enabled'), 1) < 1 then return jsonb_build_object('error', 'service_paused'); end if;
  if exists (select 1 from public.generation_blocks where user_id = p_user) then return jsonb_build_object('error', 'account_blocked'); end if;
  select lower(email) into v_email from auth.users where id = p_user and email_confirmed_at is not null;
  if v_email is null then return jsonb_build_object('error', 'email_not_confirmed'); end if;
  if p_amount > setting('max_single_job_usd') then return jsonb_build_object('error', 'job_too_expensive'); end if;
  if p_idempotency_key is not null and p_idempotency_key !~ '^[A-Za-z0-9_-]{8,80}$' then
    return jsonb_build_object('error', 'bad_idempotency_key');
  end if;

  -- global caps need a global order, otherwise two users could pass the same remaining budget
  v_global_caps := coalesce(setting('global_daily_usd_cap'), -1) >= 0 or coalesce(setting('global_hourly_usd_cap'), -1) >= 0;
  if v_global_caps then perform pg_advisory_xact_lock(7426001); end if;
  perform pg_advisory_xact_lock(hashtextextended(p_user::text, 0));  -- serialises this user

  if p_idempotency_key is not null then
    select * into v_existing from public.generation_reservations where user_id = p_user and idempotency_key = p_idempotency_key;
    if found then
      return jsonb_build_object('id', v_existing.id, 'replay', true, 'status', v_existing.status, 'result', v_existing.result);
    end if;
  end if;

  perform public.reconcile_generations(p_user);

  -- request rate (rejected attempts do not create rows, so they do not count)
  select count(*) into v_recent from public.generation_reservations
   where user_id = p_user and created_at > now() - interval '1 minute';
  if v_recent >= coalesce(setting('user_paid_per_minute'), 30) then return jsonb_build_object('error', 'rate_limited', 'retry_after', 60); end if;
  if p_ip_hash is not null then
    select count(*) into v_recent from public.generation_reservations
     where client_ip_hash = p_ip_hash and created_at > now() - interval '1 minute';
    if v_recent >= coalesce(setting('ip_paid_per_minute'), 120) then return jsonb_build_object('error', 'rate_limited', 'retry_after', 60); end if;
  end if;

  select coalesce(sum(amount_usd), 0), count(*) into v_pending, v_running from public.generation_reservations
   where user_id = p_user and status in ('pending', 'submitted', 'finishing');
  if v_running >= setting('max_parallel_jobs') then return jsonb_build_object('error', 'too_many_jobs'); end if;

  -- spend caps: settled cost plus what is still reserved
  if v_global_caps or coalesce(setting('alert_global_daily_usd'), -1) >= 0 then
    select coalesce(sum(cost_usd), 0) into v_global_day from public.generation_log where created_at >= date_trunc('day', now());
    v_global_day := v_global_day + coalesce((select sum(amount_usd) from public.generation_reservations
                                              where status in ('pending', 'submitted', 'finishing')), 0);
    if coalesce(setting('global_daily_usd_cap'), -1) >= 0 and v_global_day + p_amount > setting('global_daily_usd_cap') then
      perform public.log_security_event('spend_cap_global_daily', 'critical', p_user, jsonb_build_object('usd', v_global_day), 'cap_global_day:' || current_date);
      return jsonb_build_object('error', 'spend_limit');
    end if;
    if coalesce(setting('global_hourly_usd_cap'), -1) >= 0 then
      select coalesce(sum(cost_usd), 0) into v_global_hour from public.generation_log where created_at >= now() - interval '1 hour';
      v_global_hour := v_global_hour + coalesce((select sum(amount_usd) from public.generation_reservations
                                                  where status in ('pending', 'submitted', 'finishing')), 0);
      if v_global_hour + p_amount > setting('global_hourly_usd_cap') then
        perform public.log_security_event('spend_cap_global_hourly', 'critical', p_user, jsonb_build_object('usd', v_global_hour),
          'cap_global_hour:' || to_char(now(), 'YYYY-MM-DD"T"HH24'));
        return jsonb_build_object('error', 'spend_limit');
      end if;
    end if;
  end if;
  if coalesce(setting('user_daily_usd_cap'), -1) >= 0 or coalesce(setting('alert_user_daily_usd'), -1) >= 0 then
    select coalesce(sum(cost_usd), 0) into v_user_day from public.generation_log
     where user_id = p_user and created_at >= date_trunc('day', now());
    v_user_day := v_user_day + v_pending;
    if coalesce(setting('user_daily_usd_cap'), -1) >= 0 and v_user_day + p_amount > setting('user_daily_usd_cap') then
      perform public.log_security_event('spend_cap_user_daily', 'warning', p_user, jsonb_build_object('usd', v_user_day),
        'cap_user_day:' || p_user || ':' || current_date);
      return jsonb_build_object('error', 'spend_limit');
    end if;
  end if;

  if public.generation_has_override(p_user) then
    select coalesce(sum(cost_usd), 0) into v_spent from public.generation_log
     where user_id = p_user and created_at >= date_trunc('month', now());
    if v_spent + v_pending + p_amount > public.generation_allowance(p_user) then return jsonb_build_object('error', 'quota_exceeded'); end if;
    -- organisation pool: the whole domain together
    select o.match, o.pool_monthly_usd into v_domain, v_pool from public.generation_overrides o
     where o.match like '@%' and v_email like '%' || o.match and o.pool_monthly_usd is not null
     order by o.pool_monthly_usd limit 1;
    if v_domain is not null then
      perform pg_advisory_xact_lock(hashtextextended(v_domain, 1));
      select coalesce(sum(l.cost_usd), 0) into v_spent from public.generation_log l
       where lower(l.email) like '%' || v_domain and l.created_at >= date_trunc('month', now());
      v_spent := v_spent + coalesce((select sum(g.amount_usd) from public.generation_reservations g join auth.users u on u.id = g.user_id
                                      where g.status in ('pending', 'submitted', 'finishing') and lower(u.email) like '%' || v_domain), 0);
      if v_spent + p_amount > v_pool then
        perform public.log_security_event('spend_cap_pool', 'warning', p_user, jsonb_build_object('domain', v_domain, 'usd', v_spent),
          'cap_pool:' || v_domain || ':' || to_char(now(), 'YYYY-MM'));
        return jsonb_build_object('error', 'spend_limit');
      end if;
    end if;
  else
    perform public.ensure_free_credits(p_user);
    v_available := public.credits_available(p_user);
    if (select coalesce(sum(public.usd_to_credits(amount_usd)), 0) from public.generation_reservations
         where user_id = p_user and status in ('pending', 'submitted', 'finishing')) + public.usd_to_credits(p_amount) > v_available then
      return jsonb_build_object('error', 'quota_exceeded');
    end if;
  end if;

  insert into public.generation_reservations (user_id, model, category, amount_usd, idempotency_key, function_name, client_ip_hash)
  values (p_user, p_model, p_category, p_amount, p_idempotency_key, left(p_function, 60), left(p_ip_hash, 64))
  returning id into v_id;

  -- notifications (journal + optional webhook from the Edge Function); they never block by themselves
  if coalesce(setting('alert_user_daily_usd'), -1) >= 0 and v_user_day + p_amount > setting('alert_user_daily_usd') then
    if public.log_security_event('spend_alert_user', 'warning', p_user, jsonb_build_object('usd', v_user_day + p_amount),
         'alert_user_day:' || p_user || ':' || current_date) then
      v_alert := 'user_daily';
    end if;
  end if;
  if coalesce(setting('alert_global_daily_usd'), -1) >= 0 and v_global_day + p_amount > setting('alert_global_daily_usd') then
    if public.log_security_event('spend_alert_global', 'critical', p_user, jsonb_build_object('usd', v_global_day + p_amount),
         'alert_global_day:' || current_date) then
      v_alert := 'global_daily';
    end if;
  end if;
  return jsonb_build_object('id', v_id, 'replay', false, 'status', 'pending', 'result', null, 'alert', v_alert);
end $fn$;

-- The old entry point keeps working for functions that were not redeployed yet, with every new check.
create or replace function public.reserve_generation(p_user uuid, p_model text, p_category text, p_amount numeric)
returns uuid
language plpgsql volatile security definer set search_path = public as $fn$
declare v jsonb;
begin
  v := public.reserve_generation_v2(p_user, p_model, p_category, p_amount, null, null, null);
  if v ? 'error' then raise exception '%', v ->> 'error'; end if;
  return (v ->> 'id')::uuid;
end $fn$;

-- What the user sees: credits minus debt, what running jobs hold, soonest expiry.
drop function if exists public.credit_balance(uuid);
create or replace function public.credit_balance(p_user uuid)
returns table (available integer, reserved integer, active_total integer, next_expiry_at timestamptz, next_expiry_credits integer, unlimited boolean)
language plpgsql volatile security definer set search_path = public as $fn$
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
    public.credits_available(p_user),
    coalesce((select sum(public.usd_to_credits(amount_usd)) from public.generation_reservations
               where user_id = p_user and status in ('pending', 'submitted', 'finishing')), 0)::integer,
    coalesce((select sum(credits_total) from packs), 0)::integer,
    (select expires_at from soon),
    (select c from soon),
    public.generation_has_override(p_user);
end $fn$;

-- ---------------------------------------------------------------------------------------------
-- 8. Subscription webhook: once per signed body, never older over newer
create or replace function public.subscription_apply_event(
  p_event_id text, p_event_name text, p_user uuid, p_status text, p_subscription_id text,
  p_customer_id text, p_period_end timestamptz, p_provider_updated_at timestamptz)
returns text
language plpgsql volatile security definer set search_path = public as $fn$
declare v_prev timestamptz;
begin
  insert into public.webhook_events (id, provider, event_name) values (p_event_id, 'lemonsqueezy', left(coalesce(p_event_name, ''), 80))
  on conflict (id) do nothing;
  if not found then return 'duplicate'; end if;
  if not exists (select 1 from auth.users where id = p_user) then
    update public.webhook_events set outcome = 'unknown_user' where id = p_event_id;
    return 'unknown_user';
  end if;
  select provider_updated_at into v_prev from public.subscriptions where user_id = p_user for update;
  if v_prev is not null and p_provider_updated_at is not null and p_provider_updated_at < v_prev then
    update public.webhook_events set outcome = 'stale' where id = p_event_id;
    return 'stale';
  end if;
  insert into public.subscriptions as s (user_id, status, lemonsqueezy_subscription_id, lemonsqueezy_customer_id, current_period_end, updated_at, provider_updated_at)
  values (p_user, left(p_status, 40), left(p_subscription_id, 80), left(p_customer_id, 80), p_period_end, now(), p_provider_updated_at)
  on conflict (user_id) do update set
    status = excluded.status, lemonsqueezy_subscription_id = excluded.lemonsqueezy_subscription_id,
    lemonsqueezy_customer_id = excluded.lemonsqueezy_customer_id, current_period_end = excluded.current_period_end,
    updated_at = now(), provider_updated_at = coalesce(excluded.provider_updated_at, s.provider_updated_at);
  update public.webhook_events set outcome = 'applied' where id = p_event_id;
  return 'applied';
end $fn$;

-- ---------------------------------------------------------------------------------------------
-- 9. Messenger files: private bucket, served by short-lived signed URLs (messenger-list-messages)
do $fn$
begin
  if exists (select 1 from information_schema.tables where table_schema = 'storage' and table_name = 'buckets') then
    update storage.buckets set public = false where id = 'messenger-files';
  end if;
end $fn$;

-- ---------------------------------------------------------------------------------------------
-- 10. Privileges: service role only
revoke all on public.credit_ledger, public.credit_debts, public.security_events, public.rate_limit_counters, public.webhook_events,
  public.generation_blocks from anon, authenticated;
grant all on public.credit_ledger, public.credit_debts, public.security_events, public.rate_limit_counters, public.webhook_events,
  public.generation_blocks to service_role;
grant usage, select on sequence public.credit_ledger_id_seq, public.security_events_id_seq to service_role;

revoke all on function public.log_security_event(text, text, uuid, jsonb, text) from public, anon, authenticated;
revoke all on function public.rate_limit_hit(text, integer, integer) from public, anon, authenticated;
revoke all on function public.credits_available(uuid) from public, anon, authenticated;
revoke all on function public.grant_credits(uuid, text, integer, numeric, text, text) from public, anon, authenticated;
revoke all on function public.ensure_free_credits(uuid) from public, anon, authenticated;
revoke all on function public.settle_generation(uuid, text, numeric, jsonb) from public, anon, authenticated;
revoke all on function public.release_generation(uuid) from public, anon, authenticated;
revoke all on function public.mark_generation_submitted(uuid, text) from public, anon, authenticated;
revoke all on function public.claim_generation_completion(uuid, uuid) from public, anon, authenticated;
revoke all on function public.reconcile_generations(uuid) from public, anon, authenticated;
revoke all on function public.reserve_generation_v2(uuid, text, text, numeric, text, text, text) from public, anon, authenticated;
revoke all on function public.reserve_generation(uuid, text, text, numeric) from public, anon, authenticated;
revoke all on function public.credit_balance(uuid) from public, anon, authenticated;
revoke all on function public.subscription_apply_event(text, text, uuid, text, text, text, timestamptz, timestamptz) from public, anon, authenticated;
grant execute on function public.log_security_event(text, text, uuid, jsonb, text) to service_role;
grant execute on function public.rate_limit_hit(text, integer, integer) to service_role;
grant execute on function public.credits_available(uuid) to service_role;
grant execute on function public.grant_credits(uuid, text, integer, numeric, text, text) to service_role;
grant execute on function public.ensure_free_credits(uuid) to service_role;
grant execute on function public.settle_generation(uuid, text, numeric, jsonb) to service_role;
grant execute on function public.release_generation(uuid) to service_role;
grant execute on function public.mark_generation_submitted(uuid, text) to service_role;
grant execute on function public.claim_generation_completion(uuid, uuid) to service_role;
grant execute on function public.reconcile_generations(uuid) to service_role;
grant execute on function public.reserve_generation_v2(uuid, text, text, numeric, text, text, text) to service_role;
grant execute on function public.reserve_generation(uuid, text, text, numeric) to service_role;
grant execute on function public.credit_balance(uuid) to service_role;
grant execute on function public.subscription_apply_event(text, text, uuid, text, text, text, timestamptz, timestamptz) to service_role;
