#!/usr/bin/env bash
# Prepare a git worktree of this repo for its test suites, or tear that down.
#
#   bash scripts/worktree-setup.sh             link the main checkout's .env, bun install,
#                                               create and migrate app_test_<worktree>, and
#                                               record it and the worktree's own ports in
#                                               .env.worktree; add a "worktree-api" entry
#                                               to .claude/launch.json
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
read -r dev_port api_port < <(uv run --quiet python -W ignore::UserWarning -m scripts.worktree_db ports "$root")
printf 'TEST_POSTGRES_DB=%s\nPLAYWRIGHT_DEV_PORT=%s\nWORKTREE_API_PORT=%s\n' \
  "$db" "$dev_port" "$api_port" >"$root/.env.worktree"

# The worktree's own API, for preview_start, on a port no other worktree uses.
python3 - "$root" "$api_port" <<'PY'
import json, sys
from pathlib import Path

root, port = sys.argv[1], int(sys.argv[2])
path = Path(root) / ".claude" / "launch.json"
config = json.loads(path.read_text()) if path.exists() else {"version": "0.0.1"}
entries = [c for c in config.get("configurations", []) if c.get("name") != "worktree-api"]
entries.append({
    "name": "worktree-api",
    "runtimeExecutable": "bash",
    "runtimeArgs": ["-c", f"cd {root}/backend && uv run fastapi run app/main.py --port {port}"],
    "port": port,
})
config["configurations"] = entries
path.parent.mkdir(exist_ok=True)
path.write_text(json.dumps(config, indent=2) + "\n")
PY

echo "Ready: pytest uses $db; Playwright serves on :$dev_port; preview_start worktree-api serves :$api_port."
