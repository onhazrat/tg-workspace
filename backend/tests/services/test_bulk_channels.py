"""Unit tests for bulk channel helpers."""

from __future__ import annotations

import uuid

from app.models_tg import Channel, ChannelFollow
from app.services.bulk_channels import is_auto_followed_channel


def test_is_auto_followed_channel() -> None:
    """`discovered_via` is read off the follow since ticket 22.

    How *you* came to follow a handle is yours: on the Channel it reported a
    channel as auto-followed for every follower because one account happened to
    reach it that way. The pair is passed rather than the bare follow so
    `bulk_channels` never names `ChannelFollow` — see its docstring.
    """
    manual = (
        Channel(id="a", name="a"),
        ChannelFollow(user_id=uuid.uuid4(), channel_id="a", discovered_via=None),
    )
    auto = (
        Channel(id="b", name="b"),
        ChannelFollow(
            user_id=uuid.uuid4(),
            channel_id="b",
            discovered_via={"channelName": "source", "postId": 1, "timestamp": 1},
        ),
    )
    assert not is_auto_followed_channel(manual)
    assert is_auto_followed_channel(auto)
