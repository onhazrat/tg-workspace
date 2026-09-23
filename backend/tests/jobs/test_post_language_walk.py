"""The walk reads stored Posts (LANG-03, ADR-021).

Posts stored before LANG-01 carry no Language. The walk reads them from the
Sync worker, newest first, a bounded batch per tick, and relabels the Channels
whose Posts it read. Asserted through the job runner on database rows, with the
real bundled model and the clear-cut sentences of `test_channel_language.py`.

## Watched to fail

* order oldest first → the newest-first test reads the oldest Post
* drop the LIMIT → the bound test reads all three
* skip `relabel_channels` → the relabel test's Channel stays null
* drop `language IS NULL` from the UPDATE → the race test overwrites `en`
* write or move the etag on a caught-up tick → the no-op test
"""

from __future__ import annotations

import asyncio
from unittest.mock import patch

from sqlmodel import Session, col, select

from app.core.config import settings
from app.core.db import engine
from app.jobs.post_language import run_post_language_walk
from app.models_tg import Channel, Post, SyncMeta
from app.services import posts as posts_service
from tests.utils.tenancy import follow_channels

CHANNEL = "walkchan"

PERSIAN = "امروز باران شدیدی در تهران بارید و بسیاری از خیابان‌ها را آب گرفت"
ENGLISH = "Heavy rain flooded many streets in the capital this morning, officials said"


def _unread(session: Session, post_id: int, text: str) -> None:
    """A Post as LANG-01 found it: stored, never read."""
    session.add(
        Post(
            channel_name=CHANNEL,
            post_id=post_id,
            text=text,
            timestamp=1_790_000_000_000 + post_id,
            language=None,
        )
    )


def _languages() -> dict[int, str | None]:
    # A session of its own: a read left open on `db` holds the teardown
    # TRUNCATE forever.
    with Session(engine) as session:
        return dict(session.exec(select(Post.post_id, Post.language)).all())


def _etag() -> str | None:
    with Session(engine) as session:
        meta = session.get(SyncMeta, "channels")
        return meta.etag if meta else None


def _walk() -> dict[str, int]:
    return asyncio.run(run_post_language_walk())


def test_the_newest_posts_are_read_first_and_the_batch_is_bounded(
    db: Session,
) -> None:
    follow_channels(db, CHANNEL)
    for post_id in (1, 2, 3):
        _unread(db, post_id, PERSIAN)
    db.commit()

    with patch.object(settings, "POST_LANGUAGE_WALK_BATCH_SIZE", 2):
        assert _walk() == {"read": 2}

    assert _languages() == {1: None, 2: "fa", 3: "fa"}


def test_the_channels_whose_posts_were_read_are_relabelled(db: Session) -> None:
    follow_channels(db, CHANNEL)
    for post_id in (1, 2, 3):
        _unread(db, post_id, PERSIAN)
    db.commit()

    _walk()

    with Session(engine) as session:
        channel = session.get(Channel, CHANNEL)
        assert channel is not None
        assert channel.language == "fa"


def test_a_post_read_since_the_walk_loaded_it_keeps_its_answer(db: Session) -> None:
    """Sync reads an edited Post itself; the walk's stale answer must not win."""
    follow_channels(db, CHANNEL)
    _unread(db, 1, PERSIAN)
    db.commit()

    real_read = posts_service._unread_page

    def read_then_edit(session: Session, limit: int) -> list[Post]:
        page = real_read(session, limit)
        with Session(engine) as other:
            post = other.exec(select(Post).where(col(Post.post_id) == 1)).one()
            post.text, post.language = ENGLISH, "en"
            other.add(post)
            other.commit()
        return page

    with patch.object(posts_service, "_unread_page", read_then_edit):
        _walk()

    assert _languages() == {1: "en"}


def test_a_caught_up_tick_finds_nothing_and_writes_nothing(db: Session) -> None:
    follow_channels(db, CHANNEL)
    _unread(db, 1, PERSIAN)
    db.commit()
    _walk()
    before = _etag()

    assert _walk() == {"read": 0}

    assert _etag() == before
