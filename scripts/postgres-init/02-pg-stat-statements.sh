#!/bin/bash
set -e

# Created on first Postgres volume init (docker compose). Safe to re-run.
#
# The library itself is preloaded via the `command:` on the db service in
# compose.yml; this only registers the extension's views. An already-running
# deployment does not re-run this file — see deployment.md for the one-liner.
psql -v ON_ERROR_STOP=1 --username "$POSTGRES_USER" --dbname "$POSTGRES_DB" <<-EOSQL
    CREATE EXTENSION IF NOT EXISTS pg_stat_statements;
EOSQL
