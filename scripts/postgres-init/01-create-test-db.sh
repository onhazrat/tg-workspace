#!/bin/bash
set -e

# Created on first Postgres volume init (docker compose). Safe to re-run manually.
psql -v ON_ERROR_STOP=1 --username "$POSTGRES_USER" --dbname "$POSTGRES_DB" <<-EOSQL
    SELECT 'CREATE DATABASE app_test'
    WHERE NOT EXISTS (SELECT FROM pg_database WHERE datname = 'app_test')\gexec
EOSQL
