#!/usr/bin/env bash
# Parallel sessions = several Edge Function instances hitting the same database at once.
set -euo pipefail
DB=$1
P="psql -X -q -tA -d $DB"
U=f0f0f0f0-0000-0000-0000-00000000000f
$P -c "insert into auth.users (id, email, email_confirmed_at) values ('$U', 'conc@example.com', now()) on conflict do nothing" >/dev/null
$P -c "update public.app_settings set value = 100 where key = 'max_parallel_jobs'; update public.app_settings set value = 1000 where key in ('user_paid_per_minute', 'ip_paid_per_minute'); select public.ensure_free_credits('$U')" >/dev/null
TMP=$(mktemp -d)
# 1. 25 parallel reservations of 5 credits against 50 credits: exactly 10 may pass
for i in $(seq 1 25); do ($P -c "select case when public.reserve_generation_v2('$U', 'm', 'image', 0.05, 'conc-key-$i') ? 'error' then 'no' else 'ok' end" >"$TMP/r$i" 2>/dev/null || echo err >"$TMP/r$i") & done; wait
OKS=$(cat "$TMP"/r* | grep -cx ok || true)
[ "$OKS" = 10 ] && echo "  ok - 25 parallel reservations, 50 credits: exactly 10 accepted (no overspend)" || { echo "FAILED: $OKS accepted"; exit 1; }
# 2. the same idempotency key from 10 sessions at once: one job
for i in $(seq 1 10); do ($P -c "select public.reserve_generation_v2('$U', 'm', 'image', 0, 'same-key-0001')" >/dev/null 2>&1 || true) & done; wait
N=$($P -c "select count(*) from public.generation_reservations where idempotency_key = 'same-key-0001'")
[ "$N" = 1 ] && echo "  ok - 10 parallel requests with one Idempotency-Key: one job" || { echo "FAILED: $N jobs"; exit 1; }
# 3. settle the same reservation from 5 sessions at once: credits leave once
R=$($P -c "select id from public.generation_reservations where idempotency_key = 'conc-key-1' or (user_id = '$U' and status = 'pending') limit 1")
BEFORE=$($P -c "select public.credits_available('$U')")
for i in $(seq 1 5); do ($P -c "select public.settle_generation('$R', 'conc@example.com', 0.05)" >/dev/null 2>&1 || true) & done; wait
AFTER=$($P -c "select public.credits_available('$U')")
[ $((BEFORE - AFTER)) = 5 ] && echo "  ok - 5 parallel settles of one job: charged once" || { echo "FAILED: charged $((BEFORE - AFTER))"; exit 1; }
# 4. distributed limiter: 20 sessions, limit 5 per window
for i in $(seq 1 20); do ($P -c "select public.rate_limit_hit('conc:limiter', 5, 60)" >"$TMP/l$i" 2>/dev/null || echo err >"$TMP/l$i") & done; wait
Z=$(cat "$TMP"/l* | grep -cx 0 || true)
[ "$Z" = 5 ] && echo "  ok - limiter shared by 20 parallel sessions lets exactly 5 through" || { echo "FAILED: $Z allowed"; exit 1; }
rm -rf "$TMP"
echo "CONCURRENCY TESTS PASSED"
