#!/usr/bin/env bash
# Idempotent bootstrap for the TG Summarizer dev environment (Cloud Agent).
#
# Installs the toolchains the repo pins but the base image lacks (uv for the
# Python 3.14 backend workspace, bun for the React frontend, PostgreSQL 18 for
# the API/worker), syncs dependencies, provisions the local database, and
# applies migrations to both the dev (`app`) and test (`app_test`) databases.
# Runs from the repo root.
#
# Everything here is durable, source-derived setup that a build snapshot can
# capture once; per-boot service startup and data init live in `.cursor/start.sh`.
set -euo pipefail

REPO_ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
cd "$REPO_ROOT"

log() { printf '\n=== %s ===\n' "$*"; }

# --- uv (Python package/toolchain manager) --------------------------------
if ! command -v uv >/dev/null 2>&1 && [ ! -x "$HOME/.local/bin/uv" ]; then
  log "Installing uv"
  curl -LsSf https://astral.sh/uv/install.sh | sh
fi
export PATH="$HOME/.local/bin:$PATH"
sudo ln -sf "$HOME/.local/bin/uv" /usr/local/bin/uv
sudo ln -sf "$HOME/.local/bin/uvx" /usr/local/bin/uvx 2>/dev/null || true

# --- bun (frontend package manager / runner) ------------------------------
if ! command -v bun >/dev/null 2>&1 && [ ! -x "$HOME/.bun/bin/bun" ]; then
  log "Installing bun"
  curl -fsSL https://bun.sh/install | bash
fi
export PATH="$HOME/.bun/bin:$PATH"
sudo ln -sf "$HOME/.bun/bin/bun" /usr/local/bin/bun
sudo ln -sf "$HOME/.bun/bin/bunx" /usr/local/bin/bunx 2>/dev/null || true

# Make the toolchains discoverable in interactive/login shells (terminals).
if ! grep -q 'TG Summarizer dev PATH' "$HOME/.bashrc" 2>/dev/null; then
  {
    echo ''
    echo '# TG Summarizer dev PATH'
    echo 'export PATH="$HOME/.local/bin:$HOME/.bun/bin:$PATH"'
  } >> "$HOME/.bashrc"
fi

# --- PostgreSQL 18 --------------------------------------------------------
if ! ls /usr/lib/postgresql/18/bin/pg_ctl >/dev/null 2>&1; then
  log "Installing PostgreSQL 18 (PGDG)"
  sudo install -d /usr/share/postgresql-common/pgdg
  sudo curl -fsSL https://www.postgresql.org/media/keys/ACCC4CF8.asc \
    -o /usr/share/postgresql-common/pgdg/apt.postgresql.org.asc
  . /etc/os-release
  echo "deb [signed-by=/usr/share/postgresql-common/pgdg/apt.postgresql.org.asc] https://apt.postgresql.org/pub/repos/apt ${VERSION_CODENAME}-pgdg main" \
    | sudo tee /etc/apt/sources.list.d/pgdg.list
  sudo apt-get update -qq
  sudo apt-get install -y -qq postgresql-18 postgresql-contrib-18
fi

# --- .env (authoritative for both halves; see CLAUDE.md) ------------------
if [ ! -f "$REPO_ROOT/.env" ]; then
  log "Creating .env from .env.example"
  cp "$REPO_ROOT/.env.example" "$REPO_ROOT/.env"
fi

# --- Dependencies ---------------------------------------------------------
log "uv sync (backend, Python 3.14 workspace)"
uv sync

log "bun install (frontend)"
bun install

# --- Resolve the *effective* DB config the app will actually use ----------
# Read it from the app's own pydantic Settings so provisioning matches runtime
# exactly: environment variables (e.g. an injected POSTGRES_PASSWORD secret)
# take precedence over .env, and seeding a role with the .env value while the
# app connects with the secret would fail the build. POSTGRES_DB_TEST is not a
# Settings field — pytest's conftest reads it straight from the environment —
# so it is resolved the same way here (env only, default app_test).
log "Resolving effective database configuration"
mapfile -t PGV < <(cd "$REPO_ROOT/backend" && uv run python - <<'PY'
import os
from app.core.config import settings
db_test = os.environ.get("TEST_POSTGRES_DB") or os.environ.get("POSTGRES_DB_TEST") or "app_test"
for value in (
    settings.POSTGRES_SERVER,
    settings.POSTGRES_USER,
    settings.POSTGRES_PASSWORD,
    settings.POSTGRES_DB,
    db_test,
):
    print(value)
PY
)
PG_SERVER="${PGV[0]}"; PG_USER="${PGV[1]}"; PG_PASS="${PGV[2]}"
PG_DB="${PGV[3]}"; PG_DB_TEST="${PGV[4]}"

# --- Provision the local cluster, when the app targets one ----------------
# If POSTGRES_SERVER points at an external database, that database is managed
# elsewhere: do not start or seed a local cluster, just migrate against it.
case "$PG_SERVER" in
  localhost | 127.0.0.1 | ::1 | "")
    log "Starting local PostgreSQL 18 cluster"
    sudo pg_ctlcluster 18 main start 2>/dev/null || true
    for _ in $(seq 1 30); do
      sudo -u postgres pg_isready -q && break || sleep 1
    done

    log "Seeding Postgres role and databases (${PG_DB}, ${PG_DB_TEST})"
    # -v quoting (:'var') escapes the password safely, whatever it contains.
    sudo -u postgres psql -v ON_ERROR_STOP=1 \
      -v role="$PG_USER" -v pass="$PG_PASS" -v db="$PG_DB" -v dbtest="$PG_DB_TEST" <<'SQL'
ALTER USER :"role" WITH PASSWORD :'pass';
SELECT format('CREATE DATABASE %I', :'db')
  WHERE NOT EXISTS (SELECT FROM pg_database WHERE datname = :'db')\gexec
SELECT format('CREATE DATABASE %I', :'dbtest')
  WHERE NOT EXISTS (SELECT FROM pg_database WHERE datname = :'dbtest')\gexec
SQL
    ;;
  *)
    log "POSTGRES_SERVER=${PG_SERVER} is external; skipping local cluster provisioning"
    ;;
esac

# --- Migrations (dev + test DBs) -----------------------------------------
# No suppression: a migration that fails must fail the build, not boot the app
# against a stale schema (mirrors backend/scripts/prestart.sh).
log "Applying migrations to ${PG_DB}"
( cd "$REPO_ROOT/backend" && uv run alembic upgrade head )
log "Applying migrations to ${PG_DB_TEST}"
( cd "$REPO_ROOT/backend" && POSTGRES_DB="${PG_DB_TEST}" uv run alembic upgrade head )

log "install.sh complete"
