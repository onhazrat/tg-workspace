#!/usr/bin/env bash
# Rebuild the CRAP score report for backend/app and frontend/src.
#
#   bash scripts/crap/run.sh [out.html]    # default: crap-report/crap-scores.html
#
# Needs the dev Postgres from .env running (docker compose up -d db) and `uv sync`
# plus `bun install` done. Takes ~8 minutes, nearly all of it the pytest suite.
# The suite runs against its own throwaway database, so it never truncates
# app_test under another run, and the database is dropped on exit.

set -euo pipefail

ROOT=$(git rev-parse --show-toplevel)
HERE="$ROOT/scripts/crap"
OUT="${1:-$ROOT/crap-report/crap-scores.html}"
WORK=$(mktemp -d)
DB="app_test_crap_$$"

testdb() {
  (cd "$ROOT/backend" && uv run python -W ignore - "$1" "$DB" <<'PY'
import sys
import psycopg
from app.core.config import settings

action, name = sys.argv[1:3]
with psycopg.connect(
    host=settings.POSTGRES_SERVER,
    port=settings.POSTGRES_PORT,
    user=settings.POSTGRES_USER,
    password=settings.POSTGRES_PASSWORD,
    dbname="postgres",
    autocommit=True,
) as conn:
    if action == "create":
        conn.execute(f'CREATE DATABASE "{name}"')
    else:
        conn.execute(f'DROP DATABASE IF EXISTS "{name}" WITH (FORCE)')
PY
  )
}

cleanup() {
  testdb drop >/dev/null 2>&1 || echo "warning: could not drop database $DB" >&2
  rm -rf "$WORK"
}
trap cleanup EXIT

echo "==> backend: complexity (radon)"
(cd "$ROOT/backend" && uv run --no-project --with radon==6.0.1 \
  radon cc -j -e "app/alembic/*" app >"$WORK/radon.json")

echo "==> backend: coverage over the pytest suite in $DB (~7 min)"
testdb create
(cd "$ROOT/backend" && POSTGRES_DB="$DB" uv run alembic upgrade head >"$WORK/alembic.log" 2>&1) \
  || { cat "$WORK/alembic.log" >&2; exit 1; }
# A failing test still leaves usable coverage, so report it and carry on.
(cd "$ROOT/backend" && COVERAGE_FILE="$WORK/.coverage" TEST_POSTGRES_DB="$DB" \
  uv run coverage run -m pytest tests/ -q -p no:cacheprovider --color=no >"$WORK/pytest.log" 2>&1) \
  || echo "warning: pytest reported failures, see the summary below" >&2
BACKEND_TESTS=$(grep -E "^[0-9]+ (passed|failed)" "$WORK/pytest.log" | tail -1 | sed -E 's/, [0-9]+ warnings?//; s/ in [0-9.]+s.*//')
(cd "$ROOT/backend" && COVERAGE_FILE="$WORK/.coverage" uv run coverage json -q -o "$WORK/coverage.json")
BACKEND_LINE_COV=$(python3 -c "import json,sys; print(f\"{json.load(open(sys.argv[1]))['totals']['percent_covered']:.0f}%\")" "$WORK/coverage.json")
python3 "$HERE/backend_crap.py" "$WORK/radon.json" "$WORK/coverage.json" "$WORK/backend.json"

echo "==> frontend: coverage over bun test src"
(cd "$ROOT/frontend" && bun test src --coverage --coverage-reporter=lcov \
  --coverage-dir="$WORK/fecov" >"$WORK/bun.log" 2>&1) \
  || echo "warning: bun test reported failures, see the summary below" >&2
FRONTEND_TESTS=$(sed -E 's/\x1b\[[0-9;]*m//g' "$WORK/bun.log" | grep -E "^ *[0-9]+ (pass|fail)$" | xargs | sed -E 's/ (pass|fail)/ \1ed,/g; s/,$//')
bun "$HERE/frontend_crap.ts" "$ROOT/frontend" "$WORK/fecov/lcov.info" "$WORK/frontend.json"

echo "==> backend tests: $BACKEND_TESTS ($BACKEND_LINE_COV of lines); frontend tests: $FRONTEND_TESTS"
python3 "$HERE/build_report.py" "$WORK/backend.json" "$WORK/frontend.json" "$OUT" \
  --commit "$(git -C "$ROOT" rev-parse --short HEAD)" \
  --backend-tests "$BACKEND_TESTS" \
  --backend-line-cov "$BACKEND_LINE_COV" \
  --frontend-tests "$FRONTEND_TESTS"
