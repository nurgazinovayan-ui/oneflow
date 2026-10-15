#!/usr/bin/env bash
# Builds oneflow-auth.tar.gz for configure-auth.sh (Google sign-in, SMTP, e-mail templates):
#   oneflow-auth/configure-auth.sh     (run on the server: sudo bash ~/oneflow-auth/configure-auth.sh)
#   oneflow-auth/mail-templates/*.html (bilingual RU/EN e-mails that Auth loads through Caddy)
#
#   bash deploy/selfhost/pack-auth.sh <output-dir>
set -euo pipefail
ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/../.." && pwd)"
OUT="${1:?output dir}"
SRC="$ROOT/deploy/selfhost"

bash -n "$SRC/configure-auth.sh"
# every template configure-auth.sh installs must be in the package
for t in $(grep -oE '^TEMPLATES=\(.*\)' "$SRC/configure-auth.sh" | sed -E 's/^TEMPLATES=\((.*)\)/\1/'); do
  [[ -f "$SRC/mail-templates/$t.html" ]] || { echo "missing mail-templates/$t.html" >&2; exit 1; }
done

STAGE="$(mktemp -d)"
PKG="$STAGE/oneflow-auth"
mkdir -p "$PKG/mail-templates"
cp "$SRC/configure-auth.sh" "$PKG/configure-auth.sh"
cp "$SRC"/mail-templates/*.html "$PKG/mail-templates/"
find "$PKG" -type f \( -name '*.sh' -o -name '*.html' \) -print0 | xargs -0 sed -i 's/\r$//'
chmod 755 "$PKG/configure-auth.sh"
chmod 644 "$PKG"/mail-templates/*.html
(cd "$PKG" && find . -type f ! -name SHA256SUMS -print0 | sort -z | xargs -0 sha256sum > SHA256SUMS)

mkdir -p "$OUT"
tar --owner=0 --group=0 --numeric-owner --sort=name -czf "$OUT/oneflow-auth.tar.gz" -C "$STAGE" oneflow-auth
echo "templates: $(ls "$PKG/mail-templates" | wc -l)"
sha256sum "$OUT/oneflow-auth.tar.gz"
