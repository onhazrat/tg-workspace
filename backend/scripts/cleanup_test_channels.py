#!/usr/bin/env python3
"""One-off: remove TG rows left by pytest against the dev database."""

from __future__ import annotations

import subprocess
import sys
from pathlib import Path

from dotenv import load_dotenv

_REPO_ROOT = Path(__file__).resolve().parents[2]
_SCRIPTS_DIR = Path(__file__).resolve().parent
if str(_SCRIPTS_DIR) not in sys.path:
    sys.path.insert(0, str(_SCRIPTS_DIR))

load_dotenv(_REPO_ROOT / ".env")

from sqlmodel import Session

from app.core.db import engine
from tg_test_pollution import count_test_pollution, delete_test_pollution


def main() -> None:
    dry_run = "--dry-run" in sys.argv
    run_backfill = "--backfill" in sys.argv or (
        "--no-backfill" not in sys.argv and not dry_run
    )

    with Session(engine) as session:
        counts = count_test_pollution(session)
        total = sum(counts.values())
        print("Test pollution counts:")
        for table, n in sorted(counts.items()):
            print(f"  {table}: {n}")
        print(f"  total rows: {total}")

        if dry_run:
            print("\n[dry-run] No rows deleted.")
            return

        if total == 0:
            print("\nNothing to delete.")
        else:
            deleted = delete_test_pollution(session, dry_run=False)
            print("\nDeleted:")
            for table, n in sorted(deleted.items()):
                if n:
                    print(f"  {table}: {n}")

    if run_backfill:
        print("\nRunning backfill_user_id --reassign-all ...")
        script = _REPO_ROOT / "backend" / "scripts" / "backfill_user_id.py"
        subprocess.run(
            [sys.executable, str(script), "--reassign-all"],
            check=True,
            cwd=_REPO_ROOT / "backend",
        )


if __name__ == "__main__":
    main()
