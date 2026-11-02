#!/usr/bin/env bash
# Applies all migrations to a throwaway local Postgres cluster and runs SQL test files.
# Usage: npm run test:db
set -euo pipefail
ROOT="$(cd "$(dirname "$0")/.." && pwd)"
PGBIN="${PGBIN:-$(ls -d /usr/lib/postgresql/*/bin 2>/dev/null | sort -V | tail -1)}"
[ -x "$PGBIN/initdb" ] || { echo "Postgres binaries not found (set PGBIN)"; exit 1; }
TMP="$(mktemp -d)"
PORT="${PGPORT_TEST:-54329}"
RUNAS=""
if [ "$(id -u)" = "0" ]; then
  id pgtest >/dev/null 2>&1 || useradd -M pgtest
  chown -R pgtest "$TMP"; RUNAS="sudo -u pgtest bash -c"
  command -v sudo >/dev/null || RUNAS="su pgtest -s /bin/bash -c"
fi
run() { if [ -n "$RUNAS" ]; then $RUNAS "$*"; else bash -c "$*"; fi; }
cleanup() { run "$PGBIN/pg_ctl -D $TMP/data -m immediate stop" >/dev/null 2>&1 || true; rm -rf "$TMP"; }
trap cleanup EXIT
run "$PGBIN/initdb -D $TMP/data -U postgres -A trust" >/dev/null
run "$PGBIN/pg_ctl -D $TMP/data -o '-p $PORT -k $TMP -c listen_addresses=' -l $TMP/log -w start" >/dev/null
PSQL="psql -X -q -v ON_ERROR_STOP=1 -h $TMP -p $PORT -U postgres -d postgres"
$PSQL -f "$ROOT/supabase/tests/00_supabase_stub.sql"
for f in "$ROOT"/supabase/migrations/*.sql; do
  echo "migrate: $(basename "$f")"
  $PSQL -f "$f"
done
fail=0
for t in "$ROOT"/supabase/tests/[1-9]*.sql; do
  if $PSQL -f "$t" >"$TMP/out" 2>&1; then echo "  ✓ $(basename "$t")"; else echo "  ✗ $(basename "$t")"; cat "$TMP/out"; fail=1; fi
done
exit $fail
