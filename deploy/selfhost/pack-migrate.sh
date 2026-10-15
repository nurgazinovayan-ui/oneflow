#!/usr/bin/env bash
# Builds oneflow-migrate.tar.gz for the move from the old Supabase project to the KZ server:
#   oneflow-migrate/migrate.sh          (run on the server: sudo bash ~/oneflow-migrate/migrate.sh)
#   oneflow-migrate/tools/*.py          (data fix-up, auth/storage extras, file copy, comparison)
#   oneflow-migrate/sql/*.sql           (this repo's supabase/migrations)
#
#   bash deploy/selfhost/pack-migrate.sh <output-dir>
set -euo pipefail
ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/../.." && pwd)"
OUT="${1:?output dir}"
SRC="$ROOT/deploy/selfhost/migrate"

# every repo migration must be listed in migrate.sh (with its "already there" marker), and
# every listed one must exist, so a new migration is never silently left out of the move
listed="$(grep -oE '^(MIGRATIONS=.)?[0-9]{12}_[a-z0-9_]+\.sql\|' "$SRC/migrate.sh" | sed -E 's/^MIGRATIONS=.//; s/\|$//' | sort)"
present="$(cd "$ROOT/supabase/migrations" && ls -1 *.sql | sort)"
if [[ "$listed" != "$present" ]]; then
  echo "migrate.sh MIGRATIONS and supabase/migrations differ:" >&2
  diff <(echo "$listed") <(echo "$present") >&2 || true
  exit 1
fi

bash -n "$SRC/migrate.sh"
python3 -c 'import ast, sys; [ast.parse(open(f, encoding="utf-8").read(), f) for f in sys.argv[1:]]' "$SRC"/tools/*.py

STAGE="$(mktemp -d)"
PKG="$STAGE/oneflow-migrate"
mkdir -p "$PKG/tools" "$PKG/sql"
cp "$SRC/migrate.sh" "$PKG/migrate.sh"
cp "$SRC"/tools/*.py "$PKG/tools/"
cp "$ROOT"/supabase/migrations/*.sql "$PKG/sql/"
find "$PKG" -type f \( -name '*.sh' -o -name '*.py' -o -name '*.sql' \) -print0 | xargs -0 sed -i 's/\r$//'
chmod 755 "$PKG/migrate.sh" "$PKG"/tools/*.py
chmod 644 "$PKG"/sql/*.sql
(cd "$PKG" && find . -type f ! -name SHA256SUMS -print0 | sort -z | xargs -0 sha256sum > SHA256SUMS)

mkdir -p "$OUT"
tar --owner=0 --group=0 --numeric-owner --sort=name -czf "$OUT/oneflow-migrate.tar.gz" -C "$STAGE" oneflow-migrate
echo "migrations: $(echo "$present" | wc -l), tools: $(ls "$PKG/tools" | wc -l)"
sha256sum "$OUT/oneflow-migrate.tar.gz"
