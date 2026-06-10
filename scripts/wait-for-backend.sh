#!/usr/bin/env bash
# Wait for the FastAPI backend before starting Vite (used by VS Code tasks).
for _ in $(seq 1 30); do
  if curl -sf --max-time 2 http://127.0.0.1:8000/api/v1/utils/health-check/ >/dev/null; then
    exit 0
  fi
  sleep 1
done
echo "Backend not ready on :8000 — Vite will start anyway; proxy errors until the API is up"
exit 0
