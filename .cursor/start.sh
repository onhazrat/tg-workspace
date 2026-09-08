#!/usr/bin/env bash
# Per-boot startup for the TG Summarizer dev environment (Cloud Agent).
#
# Brings up the PostgreSQL 18 cluster (the API and worker connect to it over
# TCP) and reconciles the schema. Dependency installation and toolchain setup
# live in `.cursor/install.sh`; this only starts services and must be safe to
# re-run. The API, worker and frontend run as `terminals` (see environment.json).
set -euo pipefail

REPO_ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
cd "$REPO_ROOT"
export PATH="$HOME/.local/bin:$HOME/.bun/bin:$PATH"

# Start Postgres if it is not already accepting connections (idempotent).
if ! sudo -u postgres pg_isready -q 2>/dev/null; then
  sudo pg_ctlcluster 18 main start 2>/dev/null || true
fi
for _ in $(seq 1 30); do
  sudo -u postgres pg_isready -q && break || sleep 1
done

# A fresh (non-snapshot) boot may have an empty cluster; reconcile the schema.
# `alembic upgrade head` is a fast no-op once applied, so this is cheap on a
# snapshot boot and correct on a cold one.
if [ -f "$REPO_ROOT/.env" ]; then
  get_env() { grep -E "^$1=" "$REPO_ROOT/.env" | tail -1 | cut -d= -f2- | tr -d '"'; }
  PG_DB_TEST="$(get_env POSTGRES_DB_TEST)"; PG_DB_TEST="${PG_DB_TEST:-app_test}"
  ( cd "$REPO_ROOT/backend" && uv run alembic upgrade head ) || true
  ( cd "$REPO_ROOT/backend" && POSTGRES_DB="${PG_DB_TEST}" uv run alembic upgrade head ) || true
fi

echo "start.sh complete: PostgreSQL up, schema reconciled"
