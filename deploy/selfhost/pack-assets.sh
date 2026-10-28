#!/usr/bin/env bash
# Builds oneflow-assets.tar.gz for assets-setup.sh (every generation kept for its owner):
#   oneflow-assets/assets-setup.sh   (run on the server: sudo bash ~/oneflow-assets/assets-setup.sh)
#   oneflow-assets/user_assets.sql   (supabase/migrations/202610280002_user_assets.sql)
#
#   bash deploy/selfhost/pack-assets.sh <output-dir>
set -euo pipefail
ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/../.." && pwd)"
OUT="${1:?output dir}"
SRC="$ROOT/deploy/selfhost/assets-setup"
SQL="$ROOT/supabase/migrations/202610280002_user_assets.sql"

bash -n "$SRC/assets-setup.sh"
grep -q "create table if not exists public.user_assets" "$SQL" || { echo "user_assets.sql without the table" >&2; exit 1; }

STAGE="$(mktemp -d)"
PKG="$STAGE/oneflow-assets"
mkdir -p "$PKG"
cp "$SRC/assets-setup.sh" "$PKG/"
cp "$SQL" "$PKG/user_assets.sql"
sed -i 's/\r$//' "$PKG/assets-setup.sh" "$PKG/user_assets.sql"
chmod 755 "$PKG/assets-setup.sh"; chmod 644 "$PKG/user_assets.sql"
(cd "$PKG" && find . -type f ! -name SHA256SUMS -print0 | sort -z | xargs -0 sha256sum > SHA256SUMS)

mkdir -p "$OUT"
tar --owner=0 --group=0 --numeric-owner --sort=name -czf "$OUT/oneflow-assets.tar.gz" -C "$STAGE" oneflow-assets
sha256sum "$OUT/oneflow-assets.tar.gz"
