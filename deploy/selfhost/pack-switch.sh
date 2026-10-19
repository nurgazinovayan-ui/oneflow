#!/usr/bin/env bash
# Builds oneflow-switch.tar.gz (switch.sh precheck | finish | rollback, RUNBOOK.md).
#
#   bash deploy/selfhost/pack-switch.sh <output-dir>
set -euo pipefail
ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/../.." && pwd)"
OUT="${1:?output dir}"
SRC="$ROOT/deploy/selfhost/switch"

bash -n "$SRC/switch.sh"
STAGE="$(mktemp -d)"
PKG="$STAGE/oneflow-switch"
mkdir -p "$PKG"
cp "$SRC/switch.sh" "$SRC/RUNBOOK.md" "$PKG/"
sed -i 's/\r$//' "$PKG/switch.sh" "$PKG/RUNBOOK.md"
chmod 755 "$PKG/switch.sh"; chmod 644 "$PKG/RUNBOOK.md"
(cd "$PKG" && find . -type f ! -name SHA256SUMS -print0 | sort -z | xargs -0 sha256sum > SHA256SUMS)
mkdir -p "$OUT"
tar --owner=0 --group=0 --numeric-owner --sort=name -czf "$OUT/oneflow-switch.tar.gz" -C "$STAGE" oneflow-switch
sha256sum "$OUT/oneflow-switch.tar.gz"
