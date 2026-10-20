#!/usr/bin/env bash
# Builds oneflow-admin-fix.tar.gz for admin-fix.sh (what the admin panel needs on the KZ server):
#   oneflow-admin-fix/admin-fix.sh   (run on the server: sudo bash ~/oneflow-admin-fix/admin-fix.sh)
#   oneflow-admin-fix/admin.sql      (from the admin repo: site_content, support_tickets, the site-media bucket)
#
#   bash deploy/selfhost/pack-admin-fix.sh <admin-repo-dir> <output-dir>
set -euo pipefail
ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/../.." && pwd)"
ADMIN_REPO="${1:?admin repo dir (test_ayan/admin)}"
OUT="${2:?output dir}"
SRC="$ROOT/deploy/selfhost/admin-fix"

bash -n "$SRC/admin-fix.sh"
grep -q "insert into storage.buckets" "$ADMIN_REPO/supabase/admin.sql" || { echo "admin.sql without the site-media bucket" >&2; exit 1; }

STAGE="$(mktemp -d)"
PKG="$STAGE/oneflow-admin-fix"
mkdir -p "$PKG"
cp "$SRC/admin-fix.sh" "$PKG/"
cp "$ADMIN_REPO/supabase/admin.sql" "$PKG/admin.sql"
sed -i 's/\r$//' "$PKG/admin-fix.sh" "$PKG/admin.sql"
chmod 755 "$PKG/admin-fix.sh"; chmod 644 "$PKG/admin.sql"
(cd "$PKG" && find . -type f ! -name SHA256SUMS -print0 | sort -z | xargs -0 sha256sum > SHA256SUMS)

mkdir -p "$OUT"
tar --owner=0 --group=0 --numeric-owner --sort=name -czf "$OUT/oneflow-admin-fix.tar.gz" -C "$STAGE" oneflow-admin-fix
sha256sum "$OUT/oneflow-admin-fix.tar.gz"
