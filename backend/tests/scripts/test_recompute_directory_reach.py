"""The post-deploy script recomputes stored Directory Reach (REACH-04).

Watched to fail:
  * age the samples from the script's run instead of their capture -> the
    estimated entry reads as measured, because a year has passed since
  * keep the old value on an `unavailable` entry -> its median survives
  * stop the keyset walk after one batch -> the third entry keeps its median
  * write on `--dry-run` -> the second run reports nothing to change
"""

from __future__ import annotations

import sys
from datetime import datetime
from pathlib import Path

from sqlmodel import Session, select

from app.core.db import engine
from app.models_tg import DirectoryEntry, DirectorySample

_SCRIPTS_DIR = Path(__file__).resolve().parents[2] / "scripts"
if str(_SCRIPTS_DIR) not in sys.path:
    sys.path.insert(0, str(_SCRIPTS_DIR))

from recompute_directory_reach import recompute  # noqa: E402

CAPTURED = datetime(2025, 9, 1, 12, 0)
CAPTURED_MS = 1_756_728_000_000
HOUR_MS = 3_600_000


def _entry(handle: str, status: str, samples: list[tuple[int, int]]) -> None:
    """An entry holding an old median of 7, with `(views, hours old)` samples."""
    with Session(engine) as session:
        session.add(DirectoryEntry(handle=handle, status=status, reach=7))
        session.flush()
        for i, (views, hours) in enumerate(samples):
            session.add(
                DirectorySample(
                    handle=handle,
                    post_id=i,
                    text="",
                    timestamp=CAPTURED_MS - hours * HOUR_MS,
                    media={"kinds": [], "viewsCount": views},
                    captured_at=CAPTURED,
                )
            )
        session.commit()


def _reach() -> dict[str, tuple[int | None, bool]]:
    with Session(engine) as session:
        return {
            e.handle: (e.reach, e.reach_estimated)
            for e in session.exec(select(DirectoryEntry)).all()
        }


def test_every_entry_is_recomputed_and_a_second_run_changes_nothing() -> None:
    _entry("a_settled", "ok", [(100, 48)] * 5)
    _entry("b_young", "ok", [(860, 13)] * 5)
    _entry("c_gone", "unavailable", [])
    _entry("d_same", "ok", [])
    with Session(engine) as session:
        entry = session.get(DirectoryEntry, "d_same")
        assert entry is not None
        entry.reach = None
        session.add(entry)
        session.commit()

    assert recompute(dry_run=True, batch_size=2) == 3
    assert recompute(dry_run=False, batch_size=2) == 3

    assert _reach() == {
        "a_settled": (100, False),
        "b_young": (1054, True),
        "c_gone": (None, False),
        "d_same": (None, False),
    }
    assert recompute(dry_run=True, batch_size=2) == 0
