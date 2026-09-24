"""The cleanup leaves stored media holding numbers only (ADR-023).

Watched to fail:
  * strip `viewsCount` too -> the kept-number assertion fails
  * stop the keyset walk after one batch -> the second Post keeps its string
"""

from __future__ import annotations

import sys
from pathlib import Path

from sqlmodel import Session, col, delete, select

from app.core.db import engine
from app.models_tg import DirectoryEntry, DirectorySample, Post

_SCRIPTS_DIR = Path(__file__).resolve().parents[2] / "scripts"
if str(_SCRIPTS_DIR) not in sys.path:
    sys.path.insert(0, str(_SCRIPTS_DIR))

from strip_media_display_counters import strip  # noqa: E402

_LEGACY_MEDIA = {
    "kinds": ["photo"],
    "views": "3.86K",
    "viewsCount": 3860,
    "reactions": "🔥 25",
    "reactionCounts": [{"emoji": "🔥", "count": 25}],
}


def test_display_strings_go_and_the_numbers_stay() -> None:
    with Session(engine) as session:
        for post_id in (1, 2, 3):
            session.add(
                Post(channel_name="strip-me", post_id=post_id, media=_LEGACY_MEDIA)
            )
        session.add(DirectoryEntry(handle="strip-me"))
        session.flush()
        session.add(
            DirectorySample(
                handle="strip-me",
                post_id=1,
                text="",
                date="2026-09-24T00:00:00+00:00",
                timestamp=1,
                media=_LEGACY_MEDIA,
            )
        )
        session.commit()

    try:
        dry = strip(dry_run=True, batch_size=2)
        assert dry["tg_posts"] == 3
        assert dry["tg_channel_directory_samples"] == 1

        done = strip(dry_run=False, batch_size=2)
        assert done["tg_posts"] == 3

        with Session(engine) as session:
            medias = [
                *session.exec(
                    select(Post.media).where(col(Post.channel_name) == "strip-me")
                ),
                *session.exec(select(DirectorySample.media)),
            ]
        assert len(medias) == 4
        for media in medias:
            assert media == {
                "kinds": ["photo"],
                "viewsCount": 3860,
                "reactionCounts": [{"emoji": "🔥", "count": 25}],
            }
        assert strip(dry_run=True, batch_size=2)["tg_posts"] == 0
    finally:
        with Session(engine) as session:
            session.exec(delete(Post).where(col(Post.channel_name) == "strip-me"))
            session.exec(delete(DirectorySample))
            session.exec(delete(DirectoryEntry))
            session.commit()
