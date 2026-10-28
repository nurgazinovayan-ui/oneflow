#!/usr/bin/env bash
# Builds oneflow-storage-s3.tar.gz for storage-s3.sh (the server's file storage in an S3 bucket):
#   oneflow-storage-s3/storage-s3.sh   (run on the server: sudo bash ~/oneflow-storage-s3/storage-s3.sh)
#
#   bash deploy/selfhost/pack-storage-s3.sh <output-dir>
set -euo pipefail
ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/../.." && pwd)"
OUT="${1:?output dir}"
SRC="$ROOT/deploy/selfhost/storage-s3"

bash -n "$SRC/storage-s3.sh"
# the keys must never reach a command line (visible in ps): only through curl -K on a pipe
! grep -nE -- '(-u|--user) +"?\$(AK|SK)' "$SRC/storage-s3.sh" || { echo "keys on a command line" >&2; exit 1; }

STAGE="$(mktemp -d)"
PKG="$STAGE/oneflow-storage-s3"
mkdir -p "$PKG"
cp "$SRC/storage-s3.sh" "$PKG/"
sed -i 's/\r$//' "$PKG/storage-s3.sh"
chmod 755 "$PKG/storage-s3.sh"
(cd "$PKG" && find . -type f ! -name SHA256SUMS -print0 | sort -z | xargs -0 sha256sum > SHA256SUMS)

mkdir -p "$OUT"
tar --owner=0 --group=0 --numeric-owner --sort=name -czf "$OUT/oneflow-storage-s3.tar.gz" -C "$STAGE" oneflow-storage-s3
sha256sum "$OUT/oneflow-storage-s3.tar.gz"
