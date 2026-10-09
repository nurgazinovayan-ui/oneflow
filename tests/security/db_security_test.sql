-- Security tests for supabase/migrations/202610090001_security_hardening.sql.
-- Run against a THROWAWAY database that has the Supabase stubs (tests/security/stubs.sql) and all
-- migrations applied: tests/security/run_db_tests.sh does exactly that. Never run on production.
\set ON_ERROR_STOP 1
set client_min_messages = notice;

create or replace function pg_temp.expect_error(p_sql text, p_pattern text) returns void language plpgsql as $t$
begin
  begin
    execute p_sql;
  exception when others then
    if sqlerrm ~ p_pattern then return; end if;
    raise exception 'expected error % but got %', p_pattern, sqlerrm;
  end;
  raise exception 'expected error % but the statement succeeded: %', p_pattern, p_sql;
end $t$;
-- A user-facing role must either be refused or see nothing (RLS without policies).
create or replace function pg_temp.denied_or_empty(p_sql text) returns void language plpgsql as $t$
declare n bigint;
begin
  begin
    execute 'select count(*) from (' || p_sql || ') q' into n;
  exception when others then
    if sqlerrm ~ 'permission denied' then return; end if;
    raise;
  end;
  if n <> 0 then raise exception 'expected no rows for %, got %', p_sql, n; end if;
end $t$;
-- reserve_generation_v2 returns refusals as {error}: assert the code
create or replace function pg_temp.expect_refusal(p_sql text, p_code text) returns void language plpgsql as $t$
declare v jsonb;
begin
  execute p_sql into v;
  if coalesce(v ->> 'error', '') <> p_code then raise exception 'expected refusal % but got %', p_code, v; end if;
end $t$;
create or replace function pg_temp.ok(p_cond boolean, p_name text) returns void language plpgsql as $t$
begin
  if not coalesce(p_cond, false) then raise exception 'FAILED: %', p_name; end if;
  raise notice 'ok - %', p_name;
end $t$;

-- fixtures: A and B are ordinary confirmed users, C is unconfirmed, M1/M2 share an organisation domain
insert into auth.users (id, email, email_confirmed_at) values
  ('aaaaaaaa-0000-0000-0000-000000000001', 'alice@example.com', now()),
  ('bbbbbbbb-0000-0000-0000-000000000002', 'bob@example.com', now()),
  ('cccccccc-0000-0000-0000-000000000003', 'carol@example.com', null),
  ('dddddddd-0000-0000-0000-000000000004', 'm1@pool.test', now()),
  ('eeeeeeee-0000-0000-0000-000000000005', 'm2@pool.test', now());
update public.app_settings set value = 100 where key = 'max_parallel_jobs';  -- isolate the credit checks

-- 1. unconfirmed accounts cannot reserve
select pg_temp.expect_refusal($$select public.reserve_generation_v2('cccccccc-0000-0000-0000-000000000003', 'm', 'image', 0.01)$$, 'email_not_confirmed');
select pg_temp.ok(true, 'unconfirmed account is refused');

-- 2. credits: 50 free credits, a reservation above what is left is refused
select pg_temp.ok((public.reserve_generation_v2('aaaaaaaa-0000-0000-0000-000000000001', 'm', 'image', 0.30, 'key-a-000001') ->> 'replay')::boolean = false, 'first reservation accepted');
select pg_temp.expect_refusal($$select public.reserve_generation_v2('aaaaaaaa-0000-0000-0000-000000000001', 'm', 'image', 0.25)$$, 'quota_exceeded');
select pg_temp.ok(true, 'reservation above remaining credits refused');

-- 3. idempotency: the same key never creates a second paid job
select pg_temp.ok((public.reserve_generation_v2('aaaaaaaa-0000-0000-0000-000000000001', 'm', 'image', 0.30, 'key-a-000001') ->> 'replay')::boolean, 'repeated key is a replay');
select pg_temp.ok((select count(*) from public.generation_reservations where idempotency_key = 'key-a-000001') = 1, 'one row per idempotency key');
select pg_temp.expect_refusal($$select public.reserve_generation_v2('aaaaaaaa-0000-0000-0000-000000000001', 'm', 'image', 0.01, 'bad key!')$$, 'bad_idempotency_key');
select pg_temp.ok(true, 'malformed idempotency key refused');

-- 4. settle once: credits leave once, the ledger explains it, a second settle or a release changes nothing
do $t$
declare v_id uuid;
begin
  select id into v_id from public.generation_reservations where idempotency_key = 'key-a-000001';
  perform public.settle_generation(v_id, 'alice@example.com', 0.07);
  perform public.settle_generation(v_id, 'alice@example.com', 0.07);
  perform public.release_generation(v_id);
  perform pg_temp.ok(public.credits_available('aaaaaaaa-0000-0000-0000-000000000001') = 43, 'settled once: 50 - 7 = 43');
  perform pg_temp.ok((select count(*) from public.generation_log where user_id = 'aaaaaaaa-0000-0000-0000-000000000001') = 1, 'one generation_log row');
  perform pg_temp.ok((select sum(delta) from public.credit_ledger where user_id = 'aaaaaaaa-0000-0000-0000-000000000001') = 43, 'ledger sums to the balance');
end $t$;

-- 5. debt: a real cost above the packs is not lost, and the next pack repays it
do $t$
declare v jsonb;
begin
  v := public.reserve_generation_v2('bbbbbbbb-0000-0000-0000-000000000002', 'm', 'chat', 0.05);
  perform public.settle_generation((v ->> 'id')::uuid, 'bob@example.com', 0.80);
  perform pg_temp.ok((select credits from public.credit_debts where user_id = 'bbbbbbbb-0000-0000-0000-000000000002') = 30, 'debt of 30 credits recorded');
  perform pg_temp.ok(public.credits_available('bbbbbbbb-0000-0000-0000-000000000002') = 0, 'nothing available while in debt');
  perform pg_temp.expect_refusal($s$select public.reserve_generation_v2('bbbbbbbb-0000-0000-0000-000000000002', 'm', 'image', 0.01)$s$, 'quota_exceeded');
  perform public.grant_credits('bbbbbbbb-0000-0000-0000-000000000002', 'topup', 100, 2, 'test', 'pay-001');
  perform public.grant_credits('bbbbbbbb-0000-0000-0000-000000000002', 'topup', 100, 2, 'test', 'pay-001');
  perform pg_temp.ok((select count(*) from public.credit_packs where external_id = 'pay-001') = 1, 'same payment credited once');
  perform pg_temp.ok(public.credits_available('bbbbbbbb-0000-0000-0000-000000000002') = 70, 'debt repaid from the top-up: 100 - 30');
  perform pg_temp.ok((select sum(delta) from public.credit_ledger where user_id = 'bbbbbbbb-0000-0000-0000-000000000002') = 70, 'ledger matches after debt');
end $t$;

-- 6. kill switch
update public.app_settings set value = 0 where key = 'paid_generation_enabled';
select pg_temp.expect_refusal($$select public.reserve_generation_v2('aaaaaaaa-0000-0000-0000-000000000001', 'm', 'image', 0.01)$$, 'service_paused');
select pg_temp.expect_error($$select public.reserve_generation('aaaaaaaa-0000-0000-0000-000000000001', 'm', 'image', 0.01)$$, 'service_paused');
update public.app_settings set value = 1 where key = 'paid_generation_enabled';
select pg_temp.ok(true, 'kill switch stops new paid jobs (old and new entry points)');

-- 6b. per-account block: stops a subscribed account too (an override of 0 would not), lifting restores it
insert into auth.users (id, email, email_confirmed_at) values ('ffffffff-0000-0000-0000-000000000006', 'frank@example.com', now());
select pg_temp.ok(public.subscription_apply_event('evt-f', 'subscription_created', 'ffffffff-0000-0000-0000-000000000006', 'active', 'sf', 'cf', now() + interval '30 days', now()) = 'applied', 'F has an active subscription');
insert into public.generation_blocks (user_id, reason) values ('ffffffff-0000-0000-0000-000000000006', 'test incident');
select pg_temp.expect_refusal($$select public.reserve_generation_v2('ffffffff-0000-0000-0000-000000000006', 'm', 'image', 0.01)$$, 'account_blocked');
select pg_temp.expect_error($$select public.reserve_generation('ffffffff-0000-0000-0000-000000000006', 'm', 'image', 0.01)$$, 'account_blocked');
delete from public.generation_blocks where user_id = 'ffffffff-0000-0000-0000-000000000006';
do $t$
declare v jsonb;
begin
  v := public.reserve_generation_v2('ffffffff-0000-0000-0000-000000000006', 'm', 'image', 0.01);
  perform pg_temp.ok(v ? 'id', 'lifting the block restores paid generation');
  perform public.release_generation((v ->> 'id')::uuid);
end $t$;
select pg_temp.ok((select count(*) from auth.users where id = 'ffffffff-0000-0000-0000-000000000006') = 1, 'blocking never touches the account itself');

-- 7. global and per-user daily caps block, and leave a journal entry
update public.app_settings set value = 0.80 where key = 'global_daily_usd_cap';
select pg_temp.expect_refusal($$select public.reserve_generation_v2('aaaaaaaa-0000-0000-0000-000000000001', 'm', 'image', 0.05)$$, 'spend_limit');
select pg_temp.ok((select count(*) from public.security_events where kind = 'spend_cap_global_daily') = 1, 'global cap journaled');
update public.app_settings set value = -1 where key = 'global_daily_usd_cap';
update public.app_settings set value = 0.10 where key = 'user_daily_usd_cap';
select pg_temp.expect_refusal($$select public.reserve_generation_v2('aaaaaaaa-0000-0000-0000-000000000001', 'm', 'image', 0.05)$$, 'spend_limit');
update public.app_settings set value = -1 where key = 'user_daily_usd_cap';
select pg_temp.ok(true, 'per-user daily cap blocks');

-- 8. alerts are journaled once per day and do not block
update public.app_settings set value = 0.01 where key = 'alert_user_daily_usd';
select pg_temp.ok(public.reserve_generation_v2('aaaaaaaa-0000-0000-0000-000000000001', 'm', 'image', 0.01) ->> 'alert' = 'user_daily', 'alert returned once');
select pg_temp.ok(public.reserve_generation_v2('aaaaaaaa-0000-0000-0000-000000000001', 'm', 'image', 0.01) ->> 'alert' is null, 'alert not repeated the same day');
update public.app_settings set value = -1 where key = 'alert_user_daily_usd';

-- 9. request rate per account and per IP
update public.app_settings set value = 3 where key = 'user_paid_per_minute';
select pg_temp.expect_refusal($$select public.reserve_generation_v2('aaaaaaaa-0000-0000-0000-000000000001', 'm', 'image', 0.01)$$, 'rate_limited');
update public.app_settings set value = 30 where key = 'user_paid_per_minute';
update public.app_settings set value = 2 where key = 'ip_paid_per_minute';
select public.reserve_generation_v2('bbbbbbbb-0000-0000-0000-000000000002', 'm', 'image', 0.01, null, 'f', 'iphash-1');
select public.reserve_generation_v2('bbbbbbbb-0000-0000-0000-000000000002', 'm', 'image', 0.01, null, 'f', 'iphash-1');
select pg_temp.expect_refusal($$select public.reserve_generation_v2('dddddddd-0000-0000-0000-000000000004', 'm', 'image', 0.01, null, 'f', 'iphash-1')$$, 'rate_limited');
update public.app_settings set value = 120 where key = 'ip_paid_per_minute';
select pg_temp.ok(true, 'rate limits per account and per IP');

-- 10. async jobs: ownership of completion, no double finishing, unpolled jobs are charged, stale sync jobs expire
do $t$
declare v jsonb; v_id uuid;
begin
  delete from public.generation_reservations where user_id = 'dddddddd-0000-0000-0000-000000000004';
  v := public.reserve_generation_v2('dddddddd-0000-0000-0000-000000000004', 'video', 'video', 0.20, 'job-d-000001');
  v_id := (v ->> 'id')::uuid;
  perform pg_temp.ok(public.mark_generation_submitted(v_id, 'prov-1'), 'job submitted');
  perform pg_temp.ok(not public.claim_generation_completion(v_id, 'aaaaaaaa-0000-0000-0000-000000000001'), 'another user cannot claim the job');
  perform pg_temp.ok(public.claim_generation_completion(v_id, 'dddddddd-0000-0000-0000-000000000004'), 'owner claims completion');
  perform pg_temp.ok(not public.claim_generation_completion(v_id, 'dddddddd-0000-0000-0000-000000000004'), 'second claim refused');
  update public.generation_reservations set status = 'submitted', submitted_at = now() - interval '25 hours' where id = v_id;
  perform public.reconcile_generations(null);
  perform pg_temp.ok((select status from public.generation_reservations where id = v_id) = 'settled', 'unpolled submitted job charged at estimate');
  perform pg_temp.ok(exists (select 1 from public.credit_ledger where reservation_id = v_id and kind = 'auto_settle'), 'auto settle is in the ledger');
  v := public.reserve_generation_v2('dddddddd-0000-0000-0000-000000000004', 'img', 'image', 0.05);
  update public.generation_reservations set created_at = now() - interval '30 minutes' where id = (v ->> 'id')::uuid;
  perform public.reconcile_generations(null);
  perform pg_temp.ok((select status from public.generation_reservations where id = (v ->> 'id')::uuid) = 'expired', 'stale synchronous job expires');
end $t$;

-- 11. organisation pool caps the whole domain
insert into public.generation_overrides (match, monthly_usd, pool_monthly_usd) values ('@pool.test', 50, 1.0);
do $t$
declare v jsonb;
begin
  v := public.reserve_generation_v2('eeeeeeee-0000-0000-0000-000000000005', 'm', 'image', 0.60);
  perform public.settle_generation((v ->> 'id')::uuid, 'm2@pool.test', 0.60);
  perform pg_temp.ok(true, 'first domain member spends 0.60');
end $t$;
select pg_temp.expect_refusal($$select public.reserve_generation_v2('dddddddd-0000-0000-0000-000000000004', 'm', 'image', 0.50)$$, 'spend_limit');
select pg_temp.ok(true, 'second member blocked by the domain pool');

-- 12. subscription webhook: duplicates and stale events never change state
select pg_temp.ok(public.subscription_apply_event('evt-1', 'subscription_updated', 'aaaaaaaa-0000-0000-0000-000000000001', 'expired', 's1', 'c1', now(), '2026-10-09T10:00:00Z') = 'applied', 'event applied');
select pg_temp.ok(public.subscription_apply_event('evt-1', 'subscription_updated', 'aaaaaaaa-0000-0000-0000-000000000001', 'active', 's1', 'c1', now(), '2026-10-09T11:00:00Z') = 'duplicate', 'same event again is a duplicate');
select pg_temp.ok(public.subscription_apply_event('evt-0', 'subscription_updated', 'aaaaaaaa-0000-0000-0000-000000000001', 'active', 's1', 'c1', now(), '2026-10-09T09:00:00Z') = 'stale', 'older event ignored');
select pg_temp.ok((select status from public.subscriptions where user_id = 'aaaaaaaa-0000-0000-0000-000000000001') = 'expired', 'status stays expired');
select pg_temp.ok(public.subscription_apply_event('evt-x', 'subscription_created', '99999999-0000-0000-0000-000000000009', 'active', 's9', 'c9', now(), now()) = 'unknown_user', 'unknown user refused');

-- 13. generic limiter
select pg_temp.ok(public.rate_limit_hit('t:bucket', 2, 60) = 0 and public.rate_limit_hit('t:bucket', 2, 60) = 0 and public.rate_limit_hit('t:bucket', 2, 60) > 0, 'limiter blocks the third hit with Retry-After');

-- 14. users cannot touch the money tables or functions directly (anon / authenticated roles)
set role authenticated;
select set_config('request.jwt.claim.sub', 'bbbbbbbb-0000-0000-0000-000000000002', false);
select pg_temp.ok((select count(*) from public.generation_log) = (select count(*) from public.generation_log where user_id = 'bbbbbbbb-0000-0000-0000-000000000002'), 'B sees only own generation_log rows');
select pg_temp.ok((select count(*) from public.generation_log where user_id = 'aaaaaaaa-0000-0000-0000-000000000001') = 0, 'B cannot read A rows');
select pg_temp.denied_or_empty($$select * from public.credit_packs$$);
select pg_temp.denied_or_empty($$select * from public.credit_ledger$$);
select pg_temp.denied_or_empty($$select * from public.security_events$$);
select pg_temp.denied_or_empty($$select * from public.generation_reservations$$);
select pg_temp.denied_or_empty($$select * from public.generation_blocks$$);
select pg_temp.expect_error($$select public.reserve_generation_v2('bbbbbbbb-0000-0000-0000-000000000002', 'm', 'image', 0)$$, 'permission denied');
select pg_temp.expect_error($$select public.grant_credits('bbbbbbbb-0000-0000-0000-000000000002', 'admin', 1000, 0, 'x', null)$$, 'permission denied');
select pg_temp.expect_error($$select public.settle_generation(gen_random_uuid(), 'x', -100)$$, 'permission denied');
do $t$ begin
  begin update public.app_settings set value = 0 where key = 'paid_generation_enabled'; exception when others then null; end;
end $t$;
select pg_temp.expect_error($$insert into public.subscriptions (user_id, status) values ('bbbbbbbb-0000-0000-0000-000000000002', 'active')$$, 'permission denied|row-level security');
reset role;
select pg_temp.ok((select value from public.app_settings where key = 'paid_generation_enabled') = 1, 'a user cannot flip the kill switch');
set role anon;
select pg_temp.expect_error($$select public.rate_limit_hit('x', 1, 1)$$, 'permission denied');
select pg_temp.denied_or_empty($$select * from public.app_settings$$);
reset role;
select pg_temp.ok(true, 'anon/authenticated cannot reach money tables or functions');
\echo ALL DB SECURITY TESTS PASSED
