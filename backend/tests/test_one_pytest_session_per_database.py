"""One pytest session per test database.

Every test truncates `tg_*` and the seeded accounts afterwards, so a second
session on the same database empties the tables under the first. The symptom
reads as a broad regression: walls of `ForeignKeyViolation`, a deadlock, or a
primary-key error in files nobody touched. Written rules did not stop it (four
collisions between 2026-08-01 and 2026-11-02), so `conftest.py` takes a
session-level advisory lock on the database at session start, and a second
session stops before it touches anything.

This module's own session holds the lock, so a second pytest started from here
must be refused.

## Watched to fail

Each mutation was applied alone with `scripts/mutate.py` and this module went
red; the commit body lists them.
"""

from __future__ import annotations

import subprocess
import sys
from pathlib import Path

BACKEND = Path(__file__).resolve().parents[1]


def test_a_second_session_on_the_same_database_stops_at_once() -> None:
    # Collecting is enough: the lock is taken before collection starts.
    second = subprocess.run(
        [sys.executable, "-m", "pytest", "--collect-only", "-q", __file__],
        cwd=BACKEND,
        capture_output=True,
        text=True,
        timeout=120,
    )
    assert second.returncode == 75, second.stdout + second.stderr
    assert "Another pytest session is using" in second.stdout + second.stderr
