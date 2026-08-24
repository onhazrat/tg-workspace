"""Removing a Channel is unfollowing it (ticket 05).

Before this, `DELETE /data/channels/{id}` removed the Channel row and every
Post under it, for everybody, with no ownership check. That was defensible
while one operator owned the whole database and is not once a Channel is a
shared corpus with a Follow per account: the second follower of a handle would
lose a scrape they had nothing to do with, silently, because the first follower
tidied their own list.

## Watched to fail

Per `CLAUDE.md`, each assertion here was mutation-tested:

* delete the Channel alongside the follow → the channel-survives test fails
* keep the bulk `DELETE FROM tg_posts` in the removal path → both post-survival
  tests fail, including the two-account one
* drop the follow lookup and unfollow whatever id is passed → the
  not-a-follower test fails with 200 instead of 404
* let `remove_follow` report success from `rowcount` instead of `RETURNING` →
  the not-a-follower test fails, because the wrapped result claims a row
* widen the delete to the whole channel rather than `(user_id, channel_id)` →
  the other-follower-survives test fails
"""

from __future__ import annotations

import uuid
from collections.abc import Iterator

import pytest
from fastapi import HTTPException
from sqlmodel import Session, col, delete, select

from app.core.db import engine
from app.models import User
from app.models_tg import Channel, ChannelFollow, Post
from app.services.channels import unfollow_channel
from app.services.follows import ensure_follow, follow_exists
from tests.utils.setting_groups import add_test_channel
from tests.utils.user import create_random_user


@pytest.fixture
def session() -> Iterator[Session]:
    with Session(engine) as s:
        yield s


@pytest.fixture
def alice(session: Session) -> Iterator[User]:
    created = create_random_user(session)
    yield created
    session.exec(delete(User).where(col(User.id) == created.id))
    session.commit()


@pytest.fixture
def bob(session: Session) -> Iterator[User]:
    created = create_random_user(session)
    yield created
    session.exec(delete(User).where(col(User.id) == created.id))
    session.commit()


def _add_posts(session: Session, channel: str, count: int) -> None:
    for i in range(count):
        session.add(
            Post(
                channel_name=channel,
                post_id=i,
                text=f"{channel}-{i}",
                timestamp=1000 + i,
            )
        )


def _post_ids(channel: str) -> set[int]:
    with Session(engine) as session:
        return {
            p.post_id
            for p in session.exec(
                select(Post).where(col(Post.channel_name) == channel)
            ).all()
        }


def test_removal_drops_the_follow_not_the_channel(
    session: Session, alice: User
) -> None:
    add_test_channel(session, "unfollow-me", name="unfollow-me", user_id=alice.id)
    ensure_follow(session, channel_id="unfollow-me", user_id=alice.id)
    session.commit()

    unfollow_channel(session, "unfollow-me", user_id=alice.id)

    assert follow_exists(session, user_id=alice.id, channel_id="unfollow-me") is False
    assert session.get(Channel, "unfollow-me") is not None


def test_removal_leaves_posts_alone(session: Session, alice: User) -> None:
    add_test_channel(session, "keep-posts", name="keep-posts", user_id=alice.id)
    ensure_follow(session, channel_id="keep-posts", user_id=alice.id)
    _add_posts(session, "keep-posts", 5)
    session.commit()

    unfollow_channel(session, "keep-posts", user_id=alice.id)

    assert _post_ids("keep-posts") == {0, 1, 2, 3, 4}


def test_second_accounts_posts_survive_the_first_accounts_removal(
    session: Session, alice: User, bob: User
) -> None:
    """The acceptance criterion of ticket 05, stated as its own test.

    Both accounts follow one handle, which is the whole point of a shared
    corpus. Alice tidying her list must be invisible to Bob — the Channel, its
    Posts, and Bob's own follow all still there afterwards.
    """
    add_test_channel(session, "shared-ch", name="shared-ch", user_id=alice.id)
    ensure_follow(session, channel_id="shared-ch", user_id=alice.id)
    ensure_follow(session, channel_id="shared-ch", user_id=bob.id)
    _add_posts(session, "shared-ch", 4)
    session.commit()

    unfollow_channel(session, "shared-ch", user_id=alice.id)

    assert _post_ids("shared-ch") == {0, 1, 2, 3}
    assert session.get(Channel, "shared-ch") is not None
    assert follow_exists(session, user_id=bob.id, channel_id="shared-ch") is True
    assert follow_exists(session, user_id=alice.id, channel_id="shared-ch") is False


def test_removing_an_unknown_channel_is_404(session: Session, alice: User) -> None:
    with pytest.raises(HTTPException) as excinfo:
        unfollow_channel(session, "never-existed", user_id=alice.id)
    assert excinfo.value.status_code == 404
    assert excinfo.value.detail == "Channel not found"


def test_removing_a_channel_you_do_not_follow_is_404(
    session: Session, alice: User, bob: User
) -> None:
    """A foreign row answers 404, not 403.

    403 confirms the row exists, which is the enumeration oracle the seam's
    `assert_owner` is built to avoid. The detail still names the resource, so
    the oracle does not simply move into the body.
    """
    add_test_channel(session, "bobs-ch", name="bobs-ch", user_id=bob.id)
    ensure_follow(session, channel_id="bobs-ch", user_id=bob.id)
    session.commit()

    with pytest.raises(HTTPException) as excinfo:
        unfollow_channel(session, "bobs-ch", user_id=alice.id)
    assert excinfo.value.status_code == 404
    assert excinfo.value.detail == "Channel not found"
    assert follow_exists(session, user_id=bob.id, channel_id="bobs-ch") is True


def test_removal_is_scoped_to_one_follower(
    session: Session, alice: User, bob: User
) -> None:
    """The DELETE keys on `(user_id, channel_id)`, not on the channel alone."""
    add_test_channel(session, "two-followers", name="two-followers", user_id=alice.id)
    ensure_follow(session, channel_id="two-followers", user_id=alice.id)
    ensure_follow(session, channel_id="two-followers", user_id=bob.id)
    session.commit()

    unfollow_channel(session, "two-followers", user_id=alice.id)

    remaining = session.exec(
        select(ChannelFollow).where(col(ChannelFollow.channel_id) == "two-followers")
    ).all()
    assert [row.user_id for row in remaining] == [bob.id]


def test_removal_for_an_account_that_does_not_exist_is_404(
    session: Session, alice: User
) -> None:
    """No follow can exist for a fabricated id, so there is nothing to drop."""
    add_test_channel(session, "ghost-ch", name="ghost-ch", user_id=alice.id)
    ensure_follow(session, channel_id="ghost-ch", user_id=alice.id)
    session.commit()

    with pytest.raises(HTTPException) as excinfo:
        unfollow_channel(session, "ghost-ch", user_id=uuid.uuid4())
    assert excinfo.value.status_code == 404
    assert follow_exists(session, user_id=alice.id, channel_id="ghost-ch") is True
