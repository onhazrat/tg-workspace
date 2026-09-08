#!/usr/bin/env bash
# Idempotent bootstrap for the TG Summarizer dev environment (Cloud Agent).
#
# Installs the toolchains the repo pins but the base image lacks (uv for the
# Python 3.14 backend workspace, bun for the React frontend, PostgreSQL 18 for
# the API/worker), then syncs dependencies and applies migrations to both the
# dev (`app`) and test (`app_test`) databases. Runs from the repo root.
#
# Everything here is durable, source-derived setup that a build snapshot can
# capture once; per-boot service startup lives in `.cursor/start.sh`.
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

# The API talks to Postgres over TCP as the `postgres` role. Start the cluster
# so we can seed roles/databases and migrate; `.cursor/start.sh` re-starts it
# on every boot.
sudo pg_ctlcluster 18 main start 2>/dev/null || true
for _ in $(seq 1 30); do
  sudo -u postgres pg_isready -q && break || sleep 1
done

# --- .env (authoritative for both halves; see CLAUDE.md) ------------------
if [ ! -f "$REPO_ROOT/.env" ]; then
  log "Creating .env from .env.example"
  cp "$REPO_ROOT/.env.example" "$REPO_ROOT/.env"
fi

# Read the DB settings the app will actually use from .env.
get_env() { grep -E "^$1=" "$REPO_ROOT/.env" | tail -1 | cut -d= -f2- | tr -d '"'; }
PG_USER="$(get_env POSTGRES_USER)"; PG_USER="${PG_USER:-postgres}"
PG_PASS="$(get_env POSTGRES_PASSWORD)"; PG_PASS="${PG_PASS:-changethis}"
PG_DB="$(get_env POSTGRES_DB)"; PG_DB="${PG_DB:-app}"
PG_DB_TEST="$(get_env POSTGRES_DB_TEST)"; PG_DB_TEST="${PG_DB_TEST:-app_test}"

log "Seeding Postgres role and databases"
sudo -u postgres psql -v ON_ERROR_STOP=1 <<SQL
ALTER USER ${PG_USER} WITH PASSWORD '${PG_PASS}';
SELECT 'CREATE DATABASE ${PG_DB}' WHERE NOT EXISTS (SELECT FROM pg_database WHERE datname='${PG_DB}')\gexec
SELECT 'CREATE DATABASE ${PG_DB_TEST}' WHERE NOT EXISTS (SELECT FROM pg_database WHERE datname='${PG_DB_TEST}')\gexec
SQL

# --- Dependencies ---------------------------------------------------------
log "uv sync (backend, Python 3.14 workspace)"
uv sync

log "bun install (frontend)"
bun install

# --- Migrations (dev + test DBs) -----------------------------------------
log "Applying migrations to ${PG_DB}"
( cd "$REPO_ROOT/backend" && uv run alembic upgrade head )
log "Applying migrations to ${PG_DB_TEST}"
( cd "$REPO_ROOT/backend" && POSTGRES_DB="${PG_DB_TEST}" uv run alembic upgrade head )

log "install.sh complete"
