#!/usr/bin/env bash
# Builds oneflow-backup.tar.gz for install-backup.sh (encrypted off-site backups, restic → S3):
#   oneflow-backup/install-backup.sh   (run on the server: sudo bash ~/oneflow-backup/install-backup.sh)
#   oneflow-backup/oneflow-backup      (installed to /usr/local/sbin; run | status | check | fetch)
#
#   bash deploy/selfhost/pack-backup.sh <output-dir>
set -euo pipefail
ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/../.." && pwd)"
OUT="${1:?output dir}"
SRC="$ROOT/deploy/selfhost/backup"

bash -n "$SRC/install-backup.sh"
bash -n "$SRC/oneflow-backup"

STAGE="$(mktemp -d)"
PKG="$STAGE/oneflow-backup"
mkdir -p "$PKG"
cp "$SRC/install-backup.sh" "$SRC/oneflow-backup" "$PKG/"
sed -i 's/\r$//' "$PKG/install-backup.sh" "$PKG/oneflow-backup"
chmod 755 "$PKG/install-backup.sh" "$PKG/oneflow-backup"
(cd "$PKG" && find . -type f ! -name SHA256SUMS -print0 | sort -z | xargs -0 sha256sum > SHA256SUMS)

mkdir -p "$OUT"
tar --owner=0 --group=0 --numeric-owner --sort=name -czf "$OUT/oneflow-backup.tar.gz" -C "$STAGE" oneflow-backup
sha256sum "$OUT/oneflow-backup.tar.gz"
