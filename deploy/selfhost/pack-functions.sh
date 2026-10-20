#!/usr/bin/env bash
# Builds oneflow-functions.tar.gz for install-functions.sh:
#   oneflow-functions/install-functions.sh
#   oneflow-functions/main/index.ts          (router with per-function JWT check)
#   oneflow-functions/functions/<name>/…     (this repo's supabase/functions, plus admin-api,
#                                             admin-send-message and support-submit from the admin repo)
#
#   bash deploy/selfhost/pack-functions.sh <admin-repo-dir> <output-dir>
set -euo pipefail
ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/../.." && pwd)"
ADMIN_REPO="${1:?admin repo dir (test_ayan/admin)}"
OUT="${2:?output dir}"

node "$ROOT/scripts/sync-edge-guard.mjs" --check --admin-repo "$ADMIN_REPO"

STAGE="$(mktemp -d)"
PKG="$STAGE/oneflow-functions"
mkdir -p "$PKG/functions" "$PKG/main"
for d in "$ROOT"/supabase/functions/*/; do
  name="$(basename "$d")"
  [[ "$name" == _* ]] && continue
  cp -a "$d" "$PKG/functions/$name"
done
# the admin site's functions: admin-api and support-submit (the landing's support form) live only
# there; its admin-send-message has the message and recipient limits, so it replaces this repo's copy
for name in admin-api admin-send-message support-submit; do
  rm -rf "${PKG:?}/functions/$name"
  cp -a "$ADMIN_REPO/supabase/functions/$name" "$PKG/functions/$name"
done
cp "$ROOT/deploy/selfhost/functions-main/index.ts" "$PKG/main/index.ts"
cp "$ROOT/deploy/selfhost/install-functions.sh" "$PKG/install-functions.sh"
find "$PKG" -name '*.ts' -o -name '*.sh' | xargs sed -i 's/\r$//'
(cd "$PKG" && find . -type f ! -name SHA256SUMS -print0 | sort -z | xargs -0 sha256sum > SHA256SUMS)

mkdir -p "$OUT"
tar --owner=0 --group=0 --numeric-owner -czf "$OUT/oneflow-functions.tar.gz" -C "$STAGE" oneflow-functions
echo "functions: $(ls "$PKG/functions" | wc -l)"
sha256sum "$OUT/oneflow-functions.tar.gz"
