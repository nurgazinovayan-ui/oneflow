#!/usr/bin/env bash
# Runs the database security tests against a THROWAWAY local Postgres (never production):
#   PGHOST=<socket dir or host> PGPORT=<port> PGUSER=postgres tests/security/run_db_tests.sh
# Creates database sec_test, loads the Supabase stubs, applies every migration, runs the SQL suite
# and the concurrency checks, then drops the database.
set -euo pipefail
cd "$(dirname "$0")/../.."
DB=${SEC_TEST_DB:-sec_test}
P="psql -v ON_ERROR_STOP=1 -q -X"
$P -d postgres -c "drop database if exists $DB" -c "create database $DB" >/dev/null
$P -d "$DB" -f tests/security/stubs.sql >/dev/null
$P -d "$DB" -f supabase/schema.sql >/dev/null 2>&1
for f in supabase/migrations/*.sql; do $P -d "$DB" -f "$f" >/dev/null 2>&1 || { echo "migration failed: $f"; $P -d "$DB" -f "$f" 2>&1 | grep -v NOTICE | head -5; exit 1; }; done
if [ -n "${ADMIN_SQL:-}" ]; then $P -d "$DB" -f "$ADMIN_SQL" >/dev/null 2>&1; fi
OUT=$($P -d "$DB" -f tests/security/db_security_test.sql 2>&1) || { echo "$OUT" | grep -E "ok - |ERROR|FAILED|expected" ; echo "DB SECURITY TESTS FAILED"; exit 1; }
echo "$OUT" | grep -E "ok - |PASSED" | sed 's/^psql:[^ ]* NOTICE:  /  /'
bash tests/security/concurrency_test.sh "$DB"
[ -n "${KEEP_DB:-}" ] || $P -d postgres -c "drop database $DB" >/dev/null
