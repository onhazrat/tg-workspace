#!/usr/bin/env bash
# Prepare a git worktree of this repo for its test suites, or tear that down.
#
#   bash scripts/worktree-setup.sh             link the main checkout's .env, bun install,
#                                               create and migrate app_test_<worktree> for
#                                               pytest and app_test_e2e_<worktree> (seeded)
#                                               for Playwright, record them and the
#                                               worktree's own ports in .env.worktree; add a
#                                               "worktree-api" entry to .claude/launch.json
#   bash scripts/worktree-setup.sh --teardown  drop both databases, remove .env.worktree
#   bash scripts/worktree-setup.sh --reset-e2e rebuild the e2e database empty and seeded:
#                                               the suite's channels pile up run after run
#                                               until unrelated specs fail. Run the suite once
#                                               to warm it, then judge the second run.
#
# Idempotent: a second run changes nothing. Run it from anywhere in the worktree.
# The database name and the drop guard live in backend/scripts/worktree_db.py.
set -euo pipefail

mode=${1:-setup}
case "$mode" in
  setup | --teardown | --reset-e2e) ;;
  *)
    sed -n '2,14p' "$0" >&2
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
e2e_db=$(uv run --quiet python -W ignore::UserWarning -m scripts.worktree_db e2e-name "$root")

if [ "$mode" = "--teardown" ]; then
  uv run --quiet python -W ignore::UserWarning -m scripts.worktree_db drop "$db"
  uv run --quiet python -W ignore::UserWarning -m scripts.worktree_db drop "$e2e_db"
  rm -f "$root/.env.worktree"
  exit 0
fi

seed_e2e() {
  uv run --quiet python -W ignore::UserWarning -m scripts.worktree_db create "$e2e_db"
  POSTGRES_DB="$e2e_db" uv run --quiet alembic upgrade head
  POSTGRES_DB="$e2e_db" uv run --quiet python app/initial_data.py
}

if [ "$mode" = "--reset-e2e" ]; then
  uv run --quiet python -W ignore::UserWarning -m scripts.worktree_db drop "$e2e_db"
  seed_e2e
  echo "Reset $e2e_db. Run the suite once to warm it, then judge the second run."
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
# The dev `app` may sit at another worktree's migration head, so Playwright's
# API gets a database of its own, with the superuser auth.setup.ts logs in as.
seed_e2e
read -r dev_port api_port < <(uv run --quiet python -W ignore::UserWarning -m scripts.worktree_db ports "$root")
# playwright.config.ts reads this file over .env, so `bunx playwright test`
# serves on the worktree's port and proxies to its own API.
printf 'TEST_POSTGRES_DB=%s\nPLAYWRIGHT_DEV_PORT=%s\nWORKTREE_API_PORT=%s\nPLAYWRIGHT_API_URL=http://localhost:%s\n' \
  "$db" "$dev_port" "$api_port" "$api_port" >"$root/.env.worktree"

# The worktree's own API, for preview_start, on a port no other worktree uses.
python3 - "$root" "$api_port" "$e2e_db" <<'PY'
import json, sys
from pathlib import Path

root, port, db = sys.argv[1], int(sys.argv[2]), sys.argv[3]
path = Path(root) / ".claude" / "launch.json"
config = json.loads(path.read_text()) if path.exists() else {"version": "0.0.1"}
entries = [c for c in config.get("configurations", []) if c.get("name") != "worktree-api"]
entries.append({
    "name": "worktree-api",
    "runtimeExecutable": "bash",
    "runtimeArgs": ["-c", f"cd {root}/backend && POSTGRES_DB={db} uv run fastapi run app/main.py --port {port}"],
    "port": port,
})
config["configurations"] = entries
path.parent.mkdir(exist_ok=True)
path.write_text(json.dumps(config, indent=2) + "\n")
PY

echo "Ready: pytest uses $db; Playwright serves on :$dev_port against preview_start worktree-api on :$api_port ($e2e_db)."
