#!/usr/bin/env bash
# Writes the .env that `docker compose -f compose.yml` reads on a deploy runner.
#
# Both deploy workflows call this with their environment's secrets in the
# process environment. It is one file because the production workflow kept its
# own copy and drifted: by 2026-10-04 it wrote no .env at all and had never
# heard of TOKEN_ENCRYPTION_KEY, so its first run would have refused to boot.
set -euo pipefail

{
  echo "ENVIRONMENT=${ENVIRONMENT}"
  echo "DOMAIN=${DOMAIN}"
  echo "STACK_NAME=${STACK_NAME}"
  echo "PROJECT_NAME=${PROJECT_NAME}"
  echo "FRONTEND_HOST=https://${DOMAIN}"
  echo "BACKEND_CORS_ORIGINS=https://${DOMAIN},https://api.${DOMAIN}"
  echo "SECRET_KEY=${SECRET_KEY}"
  echo "FIRST_SUPERUSER=${FIRST_SUPERUSER}"
  echo "FIRST_SUPERUSER_PASSWORD=${FIRST_SUPERUSER_PASSWORD}"
  echo "USERS_OPEN_REGISTRATION=${USERS_OPEN_REGISTRATION}"
  # `:-false` is load-bearing. An unset secret expands to the empty
  # string, and `USERS_REQUIRE_APPROVAL=` is not a bool — pydantic
  # raises ValidationError and the backend fails to start. Writing
  # the default here keeps a deployment that never sets the secret
  # booting, which is every deployment until someone turns approval on.
  echo "USERS_REQUIRE_APPROVAL=${USERS_REQUIRE_APPROVAL:-false}"
  echo "API_KEY=${API_KEY}"
  echo "TOKEN_ENCRYPTION_KEY=${TOKEN_ENCRYPTION_KEY}"
  echo "SMTP_HOST=${SMTP_HOST}"
  echo "SMTP_USER=${SMTP_USER}"
  echo "SMTP_PASSWORD=${SMTP_PASSWORD}"
  echo "EMAILS_FROM_EMAIL=${EMAILS_FROM_EMAIL}"
  echo "POSTGRES_SERVER=db"
  echo "POSTGRES_PORT=${POSTGRES_PORT}"
  echo "POSTGRES_DB=${POSTGRES_DB}"
  echo "POSTGRES_USER=${POSTGRES_USER}"
  echo "POSTGRES_PASSWORD=${POSTGRES_PASSWORD}"
  echo "SENTRY_DSN=${SENTRY_DSN}"
  echo "GEMINI_API_KEY=${GEMINI_API_KEY}"
  echo "TOR_CONTROL_PASSWORD=${TOR_CONTROL_PASSWORD}"
  echo "TOR_CONTROL_PORT=9051"
  echo "TOR_SOCKS_PROXY=socks5h://127.0.0.1:9050"
  echo "DOCKER_IMAGE_BACKEND=${DOCKER_IMAGE_BACKEND}"
  echo "DOCKER_IMAGE_FRONTEND=${DOCKER_IMAGE_FRONTEND}"
  echo "VITE_API_KEY=${API_KEY}"
} > .env
