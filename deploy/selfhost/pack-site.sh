#!/usr/bin/env bash
# Builds oneflow-site.tar.gz for install-site.sh (the website from the KZ server instead of Vercel):
#   oneflow-site/install-site.sh   (run on the server: sudo bash ~/oneflow-site/install-site.sh <site.zip>)
#   oneflow-site/oneflow-site      (installed to /usr/local/sbin; deploy | rollback | status | dns | go-live | check)
#
#   bash deploy/selfhost/pack-site.sh <output-dir>
set -euo pipefail
ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/../.." && pwd)"
OUT="${1:?output dir}"
SRC="$ROOT/deploy/selfhost/site"

bash -n "$SRC/install-site.sh"
bash -n "$SRC/oneflow-site"

STAGE="$(mktemp -d)"
PKG="$STAGE/oneflow-site"
mkdir -p "$PKG"
cp "$SRC/install-site.sh" "$SRC/oneflow-site" "$PKG/"
sed -i 's/\r$//' "$PKG/install-site.sh" "$PKG/oneflow-site"
chmod 755 "$PKG/install-site.sh" "$PKG/oneflow-site"
(cd "$PKG" && find . -type f ! -name SHA256SUMS -print0 | sort -z | xargs -0 sha256sum > SHA256SUMS)

mkdir -p "$OUT"
tar --owner=0 --group=0 --numeric-owner --sort=name -czf "$OUT/oneflow-site.tar.gz" -C "$STAGE" oneflow-site
sha256sum "$OUT/oneflow-site.tar.gz"
