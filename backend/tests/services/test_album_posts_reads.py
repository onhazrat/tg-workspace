"""What the Posts reads make of an Album split into Posts (ALB-01, ADR-046).

An Album of four in Channel `a`: Post 10 holds the caption, the views and a
reply to Post 5; Posts 11-13 hold only their photos. Post 20 answers the
Album's third photo, 12.
"""

from __future__ import annotations

from collections.abc import Iterator
from typing import Any

import pytest
from sqlmodel import Session

from app.core.db import engine
from app.models_tg import Post
from app.services.channels import reach_by_channel
from app.services.embeddings import (
    count_posts_without_embeddings,
    get_embedding_status,
)
from app.services.post_filters import TreeAtom, TreeGroup, TypeCond
from app.services.posts_view import (
    PostsView,
    count_selected,
    count_shown,
    feed,
    resolve_posts_view,
)
from tests.utils.tenancy import ANY_READER, follow_channels

END = 10_000
HOUR = 3_600_000


@pytest.fixture
def session() -> Iterator[Session]:
    with Session(engine) as session:
        yield session


def _add(session: Session, channel: str, post_id: int, **kw: Any) -> None:
    follow_channels(session, channel, user_id=ANY_READER)
    session.add(
        Post(
            channel_name=channel,
            post_id=post_id,
            text=kw.pop("text", f"{channel}-{post_id}"),
            timestamp=kw.pop("timestamp", 1000 + post_id),
            **kw,
        )
    )


@pytest.fixture
def album(session: Session) -> Session:
    _add(session, "a", 5)
    _add(
        session,
        "a",
        10,
        album_id=10,
        views_count=100,
        reply_to_post_id=5,
        reply_to={"channel": "a"},
        timestamp=2000,
    )
    for later in (11, 12, 13):
        _add(session, "a", later, text="[photo]", album_id=10, timestamp=2000)
    _add(session, "a", 20, reply_to_post_id=12, reply_to={"channel": "a"})
    session.commit()
    return session


def _view(session: Session, **kw: Any) -> PostsView:
    return resolve_posts_view(session, user_id=ANY_READER, start=0, end=END, **kw)


def _of_type(session: Session, value: Any) -> set[int]:
    tree = TreeGroup("and", (TreeAtom(TypeCond(value)),))
    return {row["id"] for row in feed(session, _view(session, tree=tree))}


def test_every_post_of_an_album_counts(album: Session) -> None:
    """**Mutation:** count only the first Post of an Album and `a` holds 3."""
    assert count_shown(album, _view(album)) == ({"a": 6}, 0)
    assert count_selected(album, _view(album)) == {"a": 6}
    assert len(feed(album, _view(album, max_per_channel=3))) == 3
    assert count_shown(album, _view(album, max_per_channel=3)) == ({"a": 3}, 0)


def test_only_the_first_post_of_an_answering_album_is_a_reply(album: Session) -> None:
    assert _of_type(album, "is_reply") == {10, 20}


def test_the_answered_photo_is_the_post_that_has_a_reply(album: Session) -> None:
    assert _of_type(album, "has_reply") == {5, 12}


def test_later_album_posts_are_not_embedding_candidates(album: Session) -> None:
    """Pending and total alike, or progress reads them as embedded.

    **Mutation:** drop the Album predicate and the count is 6."""
    assert count_posts_without_embeddings(album, channel_names={"a"}) == 3
    assert get_embedding_status(album, channel_names={"a"})["total"] == 3


def test_later_album_posts_leave_reach_unchanged(session: Session) -> None:
    """Two Channels alike but for an Album's later Posts reach alike, though
    those Posts are the newest.

    **Mutation:** drop the Album predicate from the sample and the later Posts
    push three viewed Posts out of `with`'s newest 100.
    """
    for channel in ("with", "without"):
        for k in range(1, 100):
            _add(
                session,
                channel,
                k,
                views_count=k,
                timestamp=k * HOUR,
                views_observed_at=k * HOUR + 48 * HOUR,
            )
        _add(
            session,
            channel,
            100,
            album_id=100,
            views_count=1000,
            timestamp=200 * HOUR,
            views_observed_at=248 * HOUR,
        )
    for later in (101, 102, 103):
        _add(session, "with", later, album_id=100, timestamp=200 * HOUR)
    session.commit()

    reach = reach_by_channel(session, ["with", "without"])

    assert reach["with"].value is not None
    assert reach["with"] == reach["without"]
