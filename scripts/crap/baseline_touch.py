"""Remind a commit that touches a file holding a CRAP baseline entry.

    python3 scripts/crap/baseline_touch.py <changed paths...>

The ratchet fails CI when a baseline function's score moves by more than its
tolerance in either direction, and only CI's coverage scores it, so a change
that simplified the function fails `coverage-report` a push later. This names
the entries in the files a commit touches. It always exits 0: most edits to
such a file leave the function's score where it was.
"""

from __future__ import annotations

import json
import sys
from pathlib import Path

BASELINE = Path(__file__).with_name("baseline.json")


def touched(changed: list[str]) -> list[str]:
    """The baseline entries whose file is among `changed`."""
    return [
        key
        for key in json.loads(BASELINE.read_text(encoding="utf-8"))
        if key.split("::", 1)[0] in changed
    ]


def main(changed: list[str]) -> int:
    for key in touched(changed):
        print(
            f"{key} has a CRAP baseline entry. If this change moves its score, "
            "update scripts/crap/baseline.json (bash scripts/crap/run.sh "
            "--update-baseline, or the score CI's coverage-report prints)."
        )
    return 0


if __name__ == "__main__":
    sys.exit(main(sys.argv[1:]))
