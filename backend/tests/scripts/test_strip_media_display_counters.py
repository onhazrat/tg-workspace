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
from app.models import User
from app.models_tg import DirectoryEntry, DirectorySample, Post, SummaryPayload
from tests.utils.user import create_random_user

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


def test_cited_posts_are_stripped_in_both_shapes_they_are_stored_in() -> None:
    """`cited_posts` is a map of "handle-id" to Post on every staging row, and
    the model still allows a list. The first version handled only the list
    and matched nothing on staging."""
    with Session(engine) as session:
        user_id = create_random_user(session).id
    cited = {"strip-me-1": {"id": 1, "media": dict(_LEGACY_MEDIA)}}
    with Session(engine) as session:
        session.add(
            SummaryPayload(summary_id="s-map", user_id=user_id, cited_posts=cited)
        )
        session.add(
            SummaryPayload(
                summary_id="s-list",
                user_id=user_id,
                cited_posts=list(cited.values()),
            )
        )
        session.commit()
    try:
        assert strip(dry_run=True, batch_size=2)["tg_summary_payloads"] == 2
        assert strip(dry_run=False, batch_size=2)["tg_summary_payloads"] == 2

        with Session(engine) as session:
            by_id = {
                row.summary_id: row.cited_posts
                for row in session.exec(select(SummaryPayload))
            }
        kept = {
            "kinds": ["photo"],
            "viewsCount": 3860,
            "reactionCounts": [{"emoji": "🔥", "count": 25}],
        }
        assert by_id["s-map"] == {"strip-me-1": {"id": 1, "media": kept}}
        assert by_id["s-list"] == [{"id": 1, "media": kept}]
    finally:
        with Session(engine) as session:
            session.exec(delete(SummaryPayload))
            session.exec(delete(User).where(col(User.id) == user_id))
            session.commit()
