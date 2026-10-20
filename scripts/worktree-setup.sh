#!/usr/bin/env bash
# Prepare a git worktree of this repo for its test suites, or tear that down.
#
#   bash scripts/worktree-setup.sh             link the main checkout's .env, bun install,
#                                               create and migrate app_test_<worktree>, and
#                                               record it in .env.worktree for pytest
#   bash scripts/worktree-setup.sh --teardown  drop that database, remove .env.worktree
#
# Idempotent: a second run changes nothing. Run it from anywhere in the worktree.
# The database name and the drop guard live in backend/scripts/worktree_db.py.
set -euo pipefail

mode=${1:-setup}
case "$mode" in
  setup | --teardown) ;;
  *)
    sed -n '2,9p' "$0" >&2
    exit 2
    ;;
esac

root=$(git rev-parse --show-toplevel)
main=$(dirname "$(git rev-parse --path-format=absolute --git-common-dir)")
if [ "$root" = "$main" ]; then
  echo "This is the main checkout, which tests against app_test. Run this in a worktree." >&2
  exit 1
fi

cd "$root/backend"
db=$(uv run --quiet python -W ignore::UserWarning -m scripts.worktree_db name "$root")

if [ "$mode" = "--teardown" ]; then
  uv run --quiet python -W ignore::UserWarning -m scripts.worktree_db drop "$db"
  rm -f "$root/.env.worktree"
  exit 0
fi

if [ ! -e "$root/.env" ]; then
  if [ ! -f "$main/.env" ]; then
    echo "No .env in the main checkout ($main) to link." >&2
    exit 1
  fi
  ln -s "$main/.env" "$root/.env"
fi

(cd "$root" && bun install --silent)
uv run --quiet python -W ignore::UserWarning -m scripts.worktree_db create "$db"
POSTGRES_DB="$db" uv run --quiet alembic upgrade head
printf 'TEST_POSTGRES_DB=%s\n' "$db" >"$root/.env.worktree"
echo "Ready: pytest in this worktree uses $db (from .env.worktree)."
