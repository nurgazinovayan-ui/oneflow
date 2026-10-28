#!/usr/bin/env bash
# Builds oneflow-video-check.tar.gz: why a video generation is refused, read-only.
#   oneflow-video-check/video-check.sh   (run on the server: sudo bash ~/oneflow-video-check/video-check.sh you@example.com)
#
#   bash deploy/selfhost/pack-video-check.sh <output-dir>
set -euo pipefail
ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/../.." && pwd)"
OUT="${1:?output dir}"
SRC="$ROOT/deploy/selfhost/video-check"

bash -n "$SRC/video-check.sh"
# read-only by construction: no statement in it may write
! grep -Eiq '\b(insert into|delete from|truncate|drop |alter |create |grant |ensure_free_credits|credit_balance|reconcile_generations|reserve_generation)\b' \
  <(grep -v '^ *#' "$SRC/video-check.sh" | grep -v 'update storage.buckets set allowed_mime_types = null') \
  || { echo "video-check.sh must stay read-only" >&2; exit 1; }

STAGE="$(mktemp -d)"
PKG="$STAGE/oneflow-video-check"
mkdir -p "$PKG"
cp "$SRC/video-check.sh" "$PKG/"
sed -i 's/\r$//' "$PKG/video-check.sh"
chmod 755 "$PKG/video-check.sh"
(cd "$PKG" && find . -type f ! -name SHA256SUMS -print0 | sort -z | xargs -0 sha256sum > SHA256SUMS)

mkdir -p "$OUT"
tar --owner=0 --group=0 --numeric-owner --sort=name -czf "$OUT/oneflow-video-check.tar.gz" -C "$STAGE" oneflow-video-check
sha256sum "$OUT/oneflow-video-check.tar.gz"
