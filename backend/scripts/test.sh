#!/usr/bin/env bash

set -e
set -x

coverage run -m pytest tests/ --durations=30
coverage report
# HTML is optional locally and on main CI only (see test-backend.yml).
# Skip the write when CI asks for report-only (PRs).
if [ "${COVERAGE_HTML:-1}" != "0" ]; then
  coverage html --title "${@-coverage}"
fi
