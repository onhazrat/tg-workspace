"""Unit tests for bulk channel helpers."""

from __future__ import annotations

from app.models_tg import Channel
from app.services.bulk_channels import is_auto_followed_channel


def test_is_auto_followed_channel() -> None:
    manual = Channel(id="a", name="a", discovered_via=None)
    auto = Channel(
        id="b",
        name="b",
        discovered_via={"channelName": "source", "postId": 1, "timestamp": 1},
    )
    assert not is_auto_followed_channel(manual)
    assert is_auto_followed_channel(auto)
