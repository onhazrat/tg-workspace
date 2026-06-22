#! /usr/bin/env bash

set -e
set -x

cd backend
# Production mode excludes legacy /api/* from OpenAPI; use throwaway secrets for export only.
# Override with ENVIRONMENT=local when generating a client for Playwright/private routes.
: "${ENVIRONMENT:=production}"
ENVIRONMENT="${ENVIRONMENT}" \
SECRET_KEY=openapi-export-secret \
POSTGRES_PASSWORD=openapi-export-password \
FIRST_SUPERUSER_PASSWORD=openapi-export-password \
TOKEN_ENCRYPTION_KEY=openapi-export-token-key \
API_KEY=openapi-export-api-key \
uv run python -c "import app.main; import json; print(json.dumps(app.main.app.openapi()))" > ../openapi.json
cd ..
mv openapi.json frontend/
bun run --filter tg-summarizer-frontend generate-client
bun run lint
