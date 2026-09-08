#!/usr/bin/env bash
# Per-boot startup for the TG Summarizer dev environment (Cloud Agent).
#
# Brings up the PostgreSQL 18 cluster and runs the repository's canonical
# prestart sequence (backend/scripts/prestart.sh: wait for DB, migrate, run the
# data backfills, create the bootstrap superuser, backfill follows) *before*
# Cursor launches the terminals. Cursor runs `start` before `terminals`, so this
# serialises the one-time database initialisation ahead of the API and worker.
#
# Doing init here is not optional cleanliness: init_db() is a query-then-insert
# with no concurrency guard and BOTH the API (app/main.py) and the worker
# (app/worker.py) call it on boot, so on a fresh database two simultaneous
# terminals can race to create the bootstrap superuser and one dies on a unique
# violation. Seeding once here means both later calls are idempotent no-ops.
#
# Dependency installation and toolchain setup live in `.cursor/install.sh`; this
# only starts services and initialises data, and must be safe to re-run.
set -euo pipefail

REPO_ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
cd "$REPO_ROOT"
export PATH="$HOME/.local/bin:$HOME/.bun/bin:$PATH"

# Start the local Postgres cluster if it is not already accepting connections.
# Harmless no-op when the app targets an external database.
if ! sudo -u postgres pg_isready -q 2>/dev/null; then
  sudo pg_ctlcluster 18 main start 2>/dev/null || true
fi

# Canonical prestart: migrate (set -e inside, no suppression), seed roles and
# the bootstrap superuser, run the idempotent backfills. `uv run` puts the
# project's python/alembic on PATH for the script. A failure here aborts start
# rather than booting the terminals against a broken or unseeded database.
log_and_run() { printf '\n=== %s ===\n' "prestart"; ( cd "$REPO_ROOT/backend" && uv run bash scripts/prestart.sh ); }
log_and_run

echo "start.sh complete: PostgreSQL up, schema migrated, initial data seeded"
