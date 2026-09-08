#!/usr/bin/env bash

set -e
set -x

# Optional: restrict the suite (CI matrix). Default runs everything.
# shellcheck disable=SC2086
coverage run -m pytest ${PYTEST_PATHS:-tests/} --durations=30
coverage report
# HTML is optional locally and on main CI only (see test-backend.yml).
# Skip the write when CI asks for report-only (PRs).
if [ "${COVERAGE_HTML:-1}" != "0" ]; then
  coverage html --title "${@-coverage}"
fi
