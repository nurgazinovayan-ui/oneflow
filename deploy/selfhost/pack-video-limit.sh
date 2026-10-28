#!/usr/bin/env bash
# Builds oneflow-video-limit.tar.gz: raises the single-job ceiling to the most expensive video.
#   oneflow-video-limit/video-limit.sh   (run on the server: sudo bash ~/oneflow-video-limit/video-limit.sh)
#
#   bash deploy/selfhost/pack-video-limit.sh <output-dir>
set -euo pipefail
ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/../.." && pwd)"
OUT="${1:?output dir}"
SRC="$ROOT/deploy/selfhost/video-limit"

bash -n "$SRC/video-limit.sh"
# The ceiling is not a chosen number: it is the price of the most expensive request the two video
# functions accept (rate per second × longest duration). A price table change must move it too.
max=$(node - "$ROOT/supabase/functions" <<'JS'
const fs = require('fs');
const dir = process.argv[2];
const obj = (src, name) => {
  const m = new RegExp(`const ${name}[^=]*=\\s*(\\{[\\s\\S]*?\\n?\\});`).exec(src);
  if (!m) throw new Error(`${name} not found`);
  return Function(`return (${m[1]})`)();
};
const v = fs.readFileSync(`${dir}/generate-video/index.ts`, 'utf8');
const rates = obj(v, 'VIDEO_PRICE_PER_SECOND_USD'), limits = obj(v, 'VIDEO_MODEL_LIMITS');
let top = 0;
for (const [model, r] of Object.entries(rates)) {
  if (!limits[model]) throw new Error(`no limits for ${model}`);
  for (const res of limits[model].resolutions) top = Math.max(top, (r[res] ?? Object.values(r)[0]) * limits[model].maxDuration);
}
const p = fs.readFileSync(`${dir}/generate-video-pro/index.ts`, 'utf8');
const pro = obj(p, 'SEEDANCE_25_RATES');
const longest = Number(/Math\.min\((\d+), Math\.max\(4, Math\.round\(requested\)\)\)/.exec(p)?.[1]);
if (!longest) throw new Error('generate-video-pro: longest duration not found');
top = Math.max(top, ...Object.values(pro).map((x) => x * longest));
console.log(Math.round(top * 100) / 100);
JS
)
target=$(sed -n 's/^TARGET=\([0-9.]*\).*/\1/p' "$SRC/video-limit.sh")
grep -q "set value = $max where key = 'max_single_job_usd'" "$ROOT/supabase/migrations/202610280001_video_job_ceiling.sql" \
  || { echo "migration 202610280001 does not set $max" >&2; exit 1; }
[[ "$target" == "$max" ]] || { echo "video-limit.sh TARGET=$target, the most expensive video costs \$$max" >&2; exit 1; }
grep -q "= \\\\\$\$TARGET ($(( ${max%.*} * 100 )) кредитов)" "$SRC/video-limit.sh" || { echo "video-limit.sh: the credits shown do not match \$$max" >&2; exit 1; }
echo "most expensive video: \$$max = TARGET"

STAGE="$(mktemp -d)"
PKG="$STAGE/oneflow-video-limit"
mkdir -p "$PKG"
cp "$SRC/video-limit.sh" "$PKG/"
sed -i 's/\r$//' "$PKG/video-limit.sh"
chmod 755 "$PKG/video-limit.sh"
(cd "$PKG" && find . -type f ! -name SHA256SUMS -print0 | sort -z | xargs -0 sha256sum > SHA256SUMS)

mkdir -p "$OUT"
tar --owner=0 --group=0 --numeric-owner --sort=name -czf "$OUT/oneflow-video-limit.tar.gz" -C "$STAGE" oneflow-video-limit
sha256sum "$OUT/oneflow-video-limit.tar.gz"
