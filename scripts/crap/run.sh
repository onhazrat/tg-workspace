#!/usr/bin/env bash
# Rebuild the CRAP score report for backend/app and frontend/src.
#
#   bash scripts/crap/run.sh [out.html]               # unit tests only: crap-report/crap-scores.html
#   bash scripts/crap/run.sh --with-e2e [out.html]    # plus Playwright: crap-report/crap-scores-e2e.html
#   bash scripts/crap/run.sh --reuse-e2e [out.html]   # plus the Playwright dump already on disk
#   bash scripts/crap/run.sh --update-baseline        # unit only, then rewrite baseline.json
#
# A unit-only run ends with the CRAP ratchet CI runs (ratchet.py check), so a red
# CI check reproduces here. --update-baseline instead rewrites
# scripts/crap/baseline.json to the functions above 30 now, keeping every
# existing reason, and exits 1 until each new entry has one written in.
#
# --with-e2e runs the whole Playwright suite serially with E2E_COVERAGE=1, which
# writes one lcov file per test into frontend/coverage-e2e (see
# frontend/tests/fixtures.ts), and merges Chromium's coverage of frontend/src
# into bun's. It needs the backend on :8000 (docker compose up -d db prestart
# backend) and adds the length of an e2e run. --reuse-e2e merges whatever that
# directory holds from an earlier run, so re-scoring skips Playwright.
#
# Needs the dev Postgres from .env running (docker compose up -d db) and `uv sync`
# plus `bun install` done. Takes ~8 minutes, nearly all of it the pytest suite.
# The suite runs against its own throwaway database, so it never truncates
# app_test under another run, and the database is dropped on exit.

set -euo pipefail

ROOT=$(git rev-parse --show-toplevel)
HERE="$ROOT/scripts/crap"
E2E=""
OUT=""
RATCHET=check
for arg in "$@"; do
  case "$arg" in
    --with-e2e) E2E=run ;;
    --reuse-e2e) E2E=reuse ;;
    --update-baseline) RATCHET=update ;;
    -*) echo "unknown flag: $arg" >&2; exit 2 ;;
    *) OUT="$arg" ;;
  esac
done
if [ -n "$E2E" ] && [ "$RATCHET" = update ]; then
  echo "the baseline is unit-only; --update-baseline cannot take Playwright coverage" >&2
  exit 2
fi
OUT="${OUT:-$ROOT/crap-report/crap-scores${E2E:+-e2e}.html}"
E2E_DIR="$ROOT/frontend/coverage-e2e"
if [ "$E2E" = reuse ] && ! ls "$E2E_DIR"/*.info >/dev/null 2>&1; then
  echo "no Playwright coverage in $E2E_DIR; run with --with-e2e first" >&2
  exit 1
fi
WORK=$(mktemp -d)
ROWS=$(dirname "$OUT")
mkdir -p "$ROWS"
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
  || { echo "warning: pytest reported failures:" >&2; grep -E "^(FAILED|ERROR) " "$WORK/pytest.log" >&2 || true; }
BACKEND_TESTS=$(grep -E "^[0-9]+ (passed|failed)" "$WORK/pytest.log" | tail -1 | sed -E 's/, [0-9]+ warnings?//; s/ in [0-9.]+s.*//')
(cd "$ROOT/backend" && COVERAGE_FILE="$WORK/.coverage" uv run coverage json -q -o "$WORK/coverage.json")
BACKEND_LINE_COV=$(python3 -c "import json,sys; print(f\"{json.load(open(sys.argv[1]))['totals']['percent_covered']:.0f}%\")" "$WORK/coverage.json")
python3 "$HERE/backend_crap.py" "$WORK/radon.json" "$WORK/coverage.json" "$ROWS/backend.json"

echo "==> frontend: coverage over bun test src"
(cd "$ROOT/frontend" && bun test src --coverage --coverage-reporter=lcov \
  --coverage-dir="$WORK/fecov" >"$WORK/bun.log" 2>&1) \
  || echo "warning: bun test reported failures, see the summary below" >&2
FRONTEND_TESTS=$(sed -E 's/\x1b\[[0-9;]*m//g' "$WORK/bun.log" | grep -E "^ *[0-9]+ (pass|fail)$" | xargs | sed -E 's/ (pass|fail)/ \1ed,/g; s/,$//')
E2E_FILES=()
E2E_TESTS=""
if [ "$E2E" = run ]; then
  echo "==> frontend: Chromium coverage over Playwright, serially"
  rm -rf "$E2E_DIR"
  # --reporter=line because the configured html reporter serves the report and
  # waits for Ctrl+C whenever a test fails.
  (cd "$ROOT/frontend" && E2E_COVERAGE=1 bunx playwright test --workers=1 --reporter=line >"$WORK/playwright.log" 2>&1) \
    || { echo "warning: playwright reported failures:" >&2; grep -E "^ +[0-9]+ (passed|failed|flaky|skipped|did not run)|^ +[0-9]+\) \[chromium\]" "$WORK/playwright.log" >&2 || true; }
fi
if [ -n "$E2E" ]; then
  E2E_FILES=("$E2E_DIR"/*.info)
  [ -e "${E2E_FILES[0]}" ] || { echo "Playwright left no coverage in $E2E_DIR; is the backend up on :8000?" >&2; exit 1; }
  E2E_TESTS="${#E2E_FILES[@]} Playwright tests"
fi
bun "$HERE/frontend_crap.ts" "$ROOT/frontend" "$WORK/fecov/lcov.info" "$ROWS/frontend.json" ${E2E_FILES[@]+"${E2E_FILES[@]}"}

echo "==> backend tests: $BACKEND_TESTS ($BACKEND_LINE_COV of lines); frontend tests: $FRONTEND_TESTS${E2E_TESTS:+; merged with $E2E_TESTS}"
python3 "$HERE/build_report.py" "$ROWS/backend.json" "$ROWS/frontend.json" "$OUT" \
  --commit "$(git -C "$ROOT" rev-parse --short HEAD)" \
  --backend-tests "$BACKEND_TESTS" \
  --backend-line-cov "$BACKEND_LINE_COV" \
  --frontend-tests "$FRONTEND_TESTS" \
  ${E2E_TESTS:+--e2e-tests "$E2E_TESTS"}

# The baseline is unit-only, as in CI, so Playwright-merged rows are not judged.
if [ -z "$E2E" ]; then
  python3 "$HERE/ratchet.py" "$RATCHET" "$ROWS/backend.json" "$ROWS/frontend.json"
fi
