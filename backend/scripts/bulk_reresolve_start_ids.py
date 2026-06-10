#!/usr/bin/env python3
"""DEPRECATED — use bulk_reset_sync / Settings → Bulk Re-sync instead.

Start IDs no longer drive sync; backward pagination uses scrape cutoff instead.
"""

from __future__ import annotations

import sys

print(
    "bulk_reresolve_start_ids.py is deprecated.\n"
    "Use the API POST /api/v1/data/channels/bulk-reset-sync with confirm=true,\n"
    "or Settings → Bulk Re-sync in the UI.",
    file=sys.stderr,
)
sys.exit(1)
