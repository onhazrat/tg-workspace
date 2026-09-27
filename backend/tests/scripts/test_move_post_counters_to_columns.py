"""The backfill moves each Post's counters out of media into columns (REACH-01).

Watched to fail:
  * leave `reactionsCount` in media -> the both-counters assertion fails
  * set `views_observed_at` only where media held a counter -> the
    neither-counter Post keeps a NULL observation time
  * stop the keyset walk after one batch -> the third Post is never moved
  * drop `retrieved_at IS NOT NULL` from the pending predicate -> the second
    run still reports a row
"""

from __future__ import annotations

import sys
from pathlib import Path

from sqlmodel import Session, col, select

from app.core.db import engine
from app.models_tg import DirectoryEntry, DirectorySample, Post

_SCRIPTS_DIR = Path(__file__).resolve().parents[2] / "scripts"
if str(_SCRIPTS_DIR) not in sys.path:
    sys.path.insert(0, str(_SCRIPTS_DIR))

from move_post_counters_to_columns import move  # noqa: E402

CHIPS = [{"emoji": "🔥", "count": 25}, {"count": 4, "isPaid": True}]
RETRIEVED = 1_700_000_000_000


def _seed() -> None:
    with Session(engine) as session:
        media = [
            {
                "kinds": ["photo"],
                "viewsCount": 3_860,
                "reactionCounts": CHIPS,
                "reactionsCount": 29,
            },
            {"kinds": [], "viewsCount": 120},
            {"kinds": ["video"]},
        ]
        for post_id, blob in enumerate(media, start=1):
            session.add(
                Post(
                    channel_name="move-me",
                    post_id=post_id,
                    retrieved_at=RETRIEVED + post_id,
                    media=blob,
                )
            )
        # A never-retrieved legacy row has nothing to move and must not be
        # counted as pending forever.
        session.add(Post(channel_name="move-me", post_id=4, media=None))
        session.add(DirectoryEntry(handle="move-me"))
        session.flush()
        session.add(
            DirectorySample(
                handle="move-me",
                post_id=1,
                text="",
                date="2026-09-27T00:00:00+00:00",
                timestamp=1,
                media=media[0],
            )
        )
        session.commit()


def _rows() -> dict[int, tuple[object, ...]]:
    with Session(engine) as session:
        return {
            p.post_id: (p.views_count, p.reaction_counts, p.views_observed_at, p.media)
            for p in session.exec(
                select(Post).where(col(Post.channel_name) == "move-me")
            )
        }


def test_counters_move_to_columns_and_a_second_run_changes_nothing() -> None:
    _seed()

    assert move(dry_run=True, batch_size=2) == 3
    assert move(dry_run=False, batch_size=2) == 3

    rows = _rows()
    assert rows[1] == (3_860, CHIPS, RETRIEVED + 1, {"kinds": ["photo"]})
    assert rows[2] == (120, None, RETRIEVED + 2, {"kinds": []})
    assert rows[3] == (None, None, RETRIEVED + 3, {"kinds": ["video"]})
    assert rows[4] == (None, None, None, None)

    with Session(engine) as session:
        sample = session.exec(select(DirectorySample)).one()
        assert sample.media is not None
        assert sample.media["viewsCount"] == 3_860

    assert move(dry_run=True, batch_size=2) == 0
    assert move(dry_run=False, batch_size=2) == 0
    assert _rows() == rows


def test_a_column_already_written_is_kept() -> None:
    """The write path only sets a column from a newer observation."""
    with Session(engine) as session:
        session.add(
            Post(
                channel_name="move-me",
                post_id=1,
                retrieved_at=RETRIEVED,
                views_count=9_000,
                views_observed_at=RETRIEVED + 60_000,
                media={"kinds": [], "viewsCount": 100},
            )
        )
        session.commit()

    move(dry_run=False, batch_size=10)

    assert _rows()[1] == (9_000, None, RETRIEVED + 60_000, {"kinds": []})
