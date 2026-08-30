"""Ticket 15: the channel list, bios, stats, and per-channel settings.

With `TENANCY_ENFORCED` on, `list_channels`/`list_channel_bios`/
`list_all_channel_stats`/`get_channel_stats` show only the Channels the caller
Follows — a thin wiring of the seam `test_follows.py` already proved works for
`Channel` and `Post`. What is new here is the other half of the ticket: tags,
startId, startTime, followedAt and discoveredVia are read off the caller's own
`ChannelFollow` row, not `Channel`, so two followers of the same handle can see
their own values — and the write paths that edit those fields
(`upsert_channel`, `bulk_update_channel_tags`) have to keep the actor's Follow
current or the list would show the value from before the edit.
"""

from __future__ import annotations

import pytest
from sqlmodel import Session, col, delete

from app.core.db import engine
from app.models import User
from app.models_tg import ChannelFollow
from app.services.channels import (
    bulk_update_channel_tags,
    get_channel_stats,
    list_all_channel_stats,
    list_channel_bios,
    list_channels,
    upsert_channel,
)
from app.services.follows import ensure_follow
from tests.utils.setting_groups import add_test_channel
from tests.utils.user import create_random_user


@pytest.fixture
def session() -> Session:
    with Session(engine) as s:
        yield s


@pytest.fixture
def user(session: Session) -> User:
    created = create_random_user(session)
    yield created
    session.exec(delete(User).where(col(User.id) == created.id))
    session.commit()


@pytest.fixture
def other_user(session: Session) -> User:
    created = create_random_user(session)
    yield created
    session.exec(delete(User).where(col(User.id) == created.id))
    session.commit()


@pytest.fixture
def enforced(monkeypatch: pytest.MonkeyPatch) -> None:
    """Turn the seam on for one test. See `test_tenancy_seam.py`."""
    from app.core import config

    monkeypatch.setattr(config.settings, "TENANCY_ENFORCED", True)


# --------------------------------------------------------------------------
# Visibility
# --------------------------------------------------------------------------


@pytest.mark.usefixtures("enforced")
def test_list_channels_hides_a_channel_you_do_not_follow(
    session: Session, user: User, other_user: User
) -> None:
    add_test_channel(session, "scope-mine", user_id=user.id)
    add_test_channel(session, "scope-theirs", user_id=other_user.id)

    assert [c["id"] for c in list_channels(session, user_id=user.id)] == ["scope-mine"]


def test_list_channels_is_unfiltered_while_the_flag_is_off(
    session: Session, user: User, other_user: User
) -> None:
    """The one thing this ticket promises not to change yet."""
    add_test_channel(session, "unenforced-mine", user_id=user.id)
    add_test_channel(session, "unenforced-theirs", user_id=other_user.id)

    ids = {c["id"] for c in list_channels(session, user_id=user.id)}

    assert {"unenforced-mine", "unenforced-theirs"} <= ids


@pytest.mark.usefixtures("enforced")
def test_list_channel_bios_hides_a_channel_you_do_not_follow(
    session: Session, user: User, other_user: User
) -> None:
    add_test_channel(session, "scope-bio-mine", user_id=user.id, bio="mine")
    add_test_channel(session, "scope-bio-theirs", user_id=other_user.id, bio="theirs")

    bios = list_channel_bios(session, user_id=user.id)

    assert bios == {"scope-bio-mine": "mine"}


@pytest.mark.usefixtures("enforced")
def test_list_all_channel_stats_hides_a_channel_you_do_not_follow(
    session: Session, user: User, other_user: User
) -> None:
    add_test_channel(session, "scope-stats-mine", user_id=user.id)
    add_test_channel(session, "scope-stats-theirs", user_id=other_user.id)

    stats = list_all_channel_stats(session, user_id=user.id)

    assert "scope-stats-theirs" not in stats


@pytest.mark.usefixtures("enforced")
def test_get_channel_stats_404s_for_a_channel_you_do_not_follow(
    session: Session, user: User, other_user: User
) -> None:
    from fastapi import HTTPException

    add_test_channel(session, "scope-single-theirs", user_id=other_user.id)

    with pytest.raises(HTTPException) as exc_info:
        get_channel_stats(session, "scope-single-theirs", user_id=user.id)

    assert exc_info.value.status_code == 404
    assert exc_info.value.detail == "Channel not found"


@pytest.mark.usefixtures("enforced")
def test_get_channel_stats_is_visible_for_a_followed_channel(
    session: Session, user: User
) -> None:
    from app.models_tg import Post

    add_test_channel(session, "scope-single-mine", user_id=user.id)
    session.add(
        Post(channel_name="scope-single-mine", post_id=1, text="p", timestamp=1)
    )
    session.commit()

    stats = get_channel_stats(session, "scope-single-mine", user_id=user.id)

    assert stats["count"] == 1


# --------------------------------------------------------------------------
# Per-channel settings come from the caller's own Follow
# --------------------------------------------------------------------------


def test_channel_list_reads_tags_from_the_callers_own_follow(
    session: Session, user: User, other_user: User
) -> None:
    """Two followers of the same handle see their own tags, not the Channel's."""
    add_test_channel(session, "shared-handle", user_id=user.id, tags=["from-channel"])
    ensure_follow(
        session, channel_id="shared-handle", user_id=other_user.id, tags=["theirs"]
    )
    session.commit()

    mine = next(
        c for c in list_channels(session, user_id=user.id) if c["id"] == "shared-handle"
    )
    theirs = next(
        c
        for c in list_channels(session, user_id=other_user.id)
        if c["id"] == "shared-handle"
    )

    assert [t["name"] for t in mine["tags"]] == ["from-channel"]
    assert [t["name"] for t in theirs["tags"]] == ["theirs"]


def test_channel_list_falls_back_to_the_channel_when_no_follow_exists(
    session: Session, user: User
) -> None:
    """A channel nobody has a Follow row for yet (pre-backfill) still shows its
    own values rather than turning up empty."""
    add_test_channel(session, "no-follow-yet", user_id=user.id, tags=["channel-tag"])
    session.exec(
        delete(ChannelFollow).where(col(ChannelFollow.channel_id) == "no-follow-yet")
    )
    session.commit()

    row = next(
        c for c in list_channels(session, user_id=user.id) if c["id"] == "no-follow-yet"
    )

    assert [t["name"] for t in row["tags"]] == ["channel-tag"]


def test_upsert_channel_mirrors_an_edit_into_the_actors_follow(
    session: Session, user: User
) -> None:
    add_test_channel(session, "edit-me", user_id=user.id, tags=["old"])

    upsert_channel(session, "edit-me", {"tags": ["new"]}, user_id=user.id)

    follow = session.get(ChannelFollow, (user.id, "edit-me"))
    assert follow is not None
    assert [t["name"] for t in follow.tags] == ["new"]

    row = next(
        c for c in list_channels(session, user_id=user.id) if c["id"] == "edit-me"
    )
    assert [t["name"] for t in row["tags"]] == ["new"]


def test_upsert_channel_does_not_reset_next_sync_at_on_an_edit(
    session: Session, user: User
) -> None:
    """An unrelated tag edit must not clobber a follower's own sync schedule."""
    add_test_channel(session, "keep-schedule", user_id=user.id)
    follow = session.get(ChannelFollow, (user.id, "keep-schedule"))
    assert follow is not None
    follow.next_sync_at = 123
    session.add(follow)
    session.commit()

    upsert_channel(session, "keep-schedule", {"tags": ["whatever"]}, user_id=user.id)

    session.refresh(follow)
    assert follow.next_sync_at == 123


def test_bulk_update_channel_tags_mirrors_into_the_operators_follow(
    session: Session,
) -> None:
    from app.services.follows import get_operator_user_id

    operator_id = get_operator_user_id(session)
    assert operator_id is not None
    # Seeded as the operator explicitly: since ticket 21 an omitted owner means
    # `ANY_READER`, and the Follow this test is about is the operator's.
    add_test_channel(session, "bulk-tag-me", user_id=operator_id, tags=["old"])

    bulk_update_channel_tags(
        session,
        updates=[{"channel_id": "bulk-tag-me", "tags": ["fresh"]}],
        operator_id=operator_id,
    )

    follow = session.get(ChannelFollow, (operator_id, "bulk-tag-me"))
    assert follow is not None
    assert [t["name"] for t in follow.tags] == ["fresh"]


# --------------------------------------------------------------------------
# Mirroring only the touched fields (code-review round)
# --------------------------------------------------------------------------


def test_upsert_channel_editing_bio_does_not_clobber_a_diverged_follows_tags(
    session: Session, user: User
) -> None:
    """The first cut of `sync_follow_settings` mirrored every field on every
    call, so an edit to a field that is not even mirrored (bio) still
    overwrote the actor's Follow tags with whatever the Channel currently
    held — clobbering a legitimate divergence between the two."""
    add_test_channel(session, "bio-only-edit", user_id=user.id, tags=["channel-tag"])
    follow = session.get(ChannelFollow, (user.id, "bio-only-edit"))
    assert follow is not None
    follow.tags = [{"name": "mine-alone", "source": "manual", "assignedAt": 0}]
    session.add(follow)
    session.commit()

    upsert_channel(session, "bio-only-edit", {"bio": "new bio"}, user_id=user.id)

    session.refresh(follow)
    assert [t["name"] for t in follow.tags] == ["mine-alone"]


def test_bulk_update_channel_tags_does_not_touch_the_follows_start_time(
    session: Session,
) -> None:
    """Bulk tag update only ever changes tags — it must not also force-sync
    start_id/start_time/followed_at/discovered_via onto the operator's Follow,
    reverting a divergence that path never touched."""
    from app.services.follows import get_operator_user_id

    operator_id = get_operator_user_id(session)
    assert operator_id is not None
    add_test_channel(session, "bulk-start-time", user_id=operator_id, start_time=111)
    follow = session.get(ChannelFollow, (operator_id, "bulk-start-time"))
    assert follow is not None
    follow.start_time = 999
    session.add(follow)
    session.commit()

    bulk_update_channel_tags(
        session,
        updates=[{"channel_id": "bulk-start-time", "tags": ["fresh"]}],
        operator_id=operator_id,
    )

    session.refresh(follow)
    assert follow.start_time == 999


def test_import_channels_mirrors_an_edit_into_an_existing_follow(
    session: Session, user: User
) -> None:
    """The third write path that edits these fields on an existing Channel —
    same class of bug `upsert_channel` and `bulk_update_channel_tags` were
    fixed for."""
    from app.services.data_import_export import _import_channels

    add_test_channel(session, "reimported", user_id=user.id, tags=["before"])

    _import_channels(
        session,
        [{"id": "reimported", "name": "reimported", "tags": ["after"]}],
        user_id=user.id,
    )
    session.commit()

    follow = session.get(ChannelFollow, (user.id, "reimported"))
    assert follow is not None
    assert [t["name"] for t in follow.tags] == ["after"]
