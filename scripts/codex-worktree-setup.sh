#!/usr/bin/env bash
set -euo pipefail

cd "$(git rev-parse --show-toplevel)/backend"
exec uv run --frozen --quiet python -m scripts.codex_worktree "$@"
