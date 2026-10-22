#!/usr/bin/env bash
# The tests that inventory every mounted route, in ~1 minute instead of the
# full suite's ~10. A new or renamed route fails here first: add its probe,
# exemption or allowlist entry in the file that names it.
set -euo pipefail
cd "$(dirname "$0")/.."
exec uv run pytest -q \
  tests/api/test_route_inventory.py \
  tests/api/test_route_module_hygiene.py \
  tests/api/test_account_isolation.py \
  tests/api/test_public_route_exemptions.py \
  tests/api/test_approval_gate.py \
  tests/api/test_admin_route_gating.py \
  tests/api/test_view_as.py \
  tests/api/test_view_as_spend.py \
  "$@"
