#!/usr/bin/env bash
# Runs the Edge Function security tests (real function files, faked Supabase and providers; no
# network, no paid calls). Needs Deno 2: DENO=/path/to/deno tests/security/run_edge_tests.sh
set -uo pipefail
cd "$(dirname "$0")/../.."
DENO=${DENO:-deno}
node scripts/sync-edge-guard.mjs --check || { echo "shared blocks out of sync: run node scripts/sync-edge-guard.mjs"; exit 1; }
fail=0
run() { "$DENO" run -A --no-config "$@" 2>&1 | grep -E "ok - |FAILED|passed" || true; "$DENO" run -A --no-config "$@" >/dev/null 2>&1 || fail=1; }
for t in generate-image generate-video lemonsqueezy-webhook admin-access messenger messenger-send messenger-list; do
  run "tests/security/edge/$t.test.ts"
done
for f in generate-chat generate-audio generate-vector generate-video-pro evaluate-creative marketing-ai motion-storyboard; do
  FN=$f run tests/security/edge/paid-functions.test.ts
done
[ $fail = 0 ] && echo "EDGE SECURITY TESTS PASSED" || { echo "EDGE SECURITY TESTS FAILED"; exit 1; }
