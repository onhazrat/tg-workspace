"""Channel stats batch SQL and velocity helpers."""

from __future__ import annotations

import uuid
from datetime import datetime
from unittest.mock import patch

from fastapi import HTTPException
from sqlmodel import Session

from app.core.db import engine
from app.models_tg import Post, utc_now
from app.services.channels import (
    _fetch_recent_timestamps_by_channel,
    compute_channel_stats,
    compute_channel_stats_batch,
    get_channel_stats,
)
from tests.utils.setting_groups import add_test_channel

# `get_channel_stats` requires a real `user_id` to scope against, but scoping
# is a no-op while `TENANCY_ENFORCED` is off (the default here) — these tests
# are about the stats math, not the seam, so any UUID does.
_SOME_USER = uuid.uuid4()


def _hourly_timestamps(count: int) -> list[int]:
    now_ms = int(utc_now().timestamp() * 1000)
    start = now_ms - count * 3_600_000
    return [start + i * 3_600_000 for i in range(count)]


def test_batch_stats_count_min_max() -> None:
    with Session(engine) as session:
        add_test_channel(session, "stats-a")
        add_test_channel(session, "stats-b")
        session.add(
            Post(
                channel_name="stats-a",
                post_id=10,
                text="a1",
                timestamp=1_000,
            )
        )
        session.add(
            Post(
                channel_name="stats-a",
                post_id=20,
                text="a2",
                timestamp=2_000,
            )
        )
        session.add(
            Post(
                channel_name="stats-b",
                post_id=5,
                text="b1",
                timestamp=500,
            )
        )
        session.commit()

        result = compute_channel_stats_batch(session, ["stats-a", "stats-b"])

        assert result["stats-a"]["count"] == 2
        assert result["stats-a"]["minId"] == 10
        assert result["stats-a"]["maxId"] == 20
        assert result["stats-a"]["velocity"] >= 0.0
        assert result["stats-b"]["count"] == 1
        assert result["stats-b"]["minId"] == 5
        assert result["stats-b"]["maxId"] == 5
        assert result["stats-b"]["velocity"] == 0.0


def test_batch_stats_velocity() -> None:
    timestamps = _hourly_timestamps(5)
    with Session(engine) as session:
        add_test_channel(session, "vel-ch")
        for idx, ts in enumerate(timestamps, start=1):
            session.add(
                Post(
                    channel_name="vel-ch",
                    post_id=idx,
                    text=f"p{idx}",
                    timestamp=ts,
                )
            )
        session.commit()

        fixed_now = datetime(2026, 6, 28, 12, 0, 0)
        with patch("app.services.channels.utc_now", return_value=fixed_now):
            batch = compute_channel_stats_batch(session, ["vel-ch"])["vel-ch"]
            single = compute_channel_stats(session, "vel-ch")

        assert single == batch
        assert batch["velocity"] > 0


def test_batch_stats_empty_channel() -> None:
    with Session(engine) as session:
        add_test_channel(session, "empty-ch")
        add_test_channel(session, "has-posts")
        session.add(
            Post(
                channel_name="has-posts",
                post_id=1,
                text="only",
                timestamp=1_000,
            )
        )
        session.commit()

        result = compute_channel_stats_batch(session, ["empty-ch", "has-posts"])

        assert "empty-ch" not in result
        assert "has-posts" in result


def test_batch_stats_timestamp_zero_excluded() -> None:
    timestamps = _hourly_timestamps(3)
    with Session(engine) as session:
        add_test_channel(session, "zero-ts-ch")
        session.add(
            Post(
                channel_name="zero-ts-ch",
                post_id=1,
                text="zero",
                timestamp=0,
            )
        )
        for idx, ts in enumerate(timestamps, start=2):
            session.add(
                Post(
                    channel_name="zero-ts-ch",
                    post_id=idx,
                    text=f"p{idx}",
                    timestamp=ts,
                )
            )
        session.commit()

        result = compute_channel_stats_batch(session, ["zero-ts-ch"])["zero-ts-ch"]

        assert result["count"] == 4
        assert result["velocity"] > 0


def test_single_channel_stats_delegates_to_batch() -> None:
    timestamps = _hourly_timestamps(4)
    with Session(engine) as session:
        add_test_channel(session, "delegate-ch")
        for idx, ts in enumerate(timestamps, start=1):
            session.add(
                Post(
                    channel_name="delegate-ch",
                    post_id=idx,
                    text=f"p{idx}",
                    timestamp=ts,
                )
            )
        session.commit()

        fixed_now = datetime(2026, 6, 28, 12, 0, 0)
        with patch("app.services.channels.utc_now", return_value=fixed_now):
            batch_entry = compute_channel_stats_batch(session, ["delegate-ch"])[
                "delegate-ch"
            ]
            stats = get_channel_stats(session, "delegate-ch", user_id=_SOME_USER)

        assert stats == batch_entry


def test_get_channel_stats_no_posts_raises() -> None:
    with Session(engine) as session:
        add_test_channel(session, "no-posts-ch")
        session.commit()

        try:
            get_channel_stats(session, "no-posts-ch", user_id=_SOME_USER)
        except HTTPException as exc:
            assert exc.status_code == 404
            assert exc.detail == "No posts for channel"
        else:
            raise AssertionError("expected HTTPException")


def test_recent_timestamps_cap_is_per_channel_not_global() -> None:
    """The `limit` is top-N *per channel*.

    The window function this replaced enforced it with
    `row_number() OVER (PARTITION BY channel_name) <= limit`; the LATERAL
    enforces it with a per-iteration `LIMIT`. A single global `LIMIT` would
    pass every other stats test in this file — count, min/max and velocity all
    survive one channel starving another — so it is asserted here directly.
    """
    stamps = _hourly_timestamps(5)
    with Session(engine) as session:
        for channel in ("cap-a", "cap-b"):
            add_test_channel(session, channel)
            for idx, ts in enumerate(stamps, start=1):
                session.add(
                    Post(
                        channel_name=channel,
                        post_id=idx,
                        text=f"{channel}-{idx}",
                        timestamp=ts,
                    )
                )
        session.commit()

        recent = _fetch_recent_timestamps_by_channel(
            session, ["cap-a", "cap-b"], limit=3
        )

    # Each channel keeps its own newest three, ascending — not three between them.
    assert recent == {"cap-a": stamps[-3:], "cap-b": stamps[-3:]}


def test_recent_timestamps_keeps_the_newest_not_the_first_found() -> None:
    """Insertion order must not decide which timestamps survive the cap."""
    stamps = _hourly_timestamps(6)
    scrambled = [stamps[0], stamps[5], stamps[2], stamps[4], stamps[1], stamps[3]]
    with Session(engine) as session:
        add_test_channel(session, "order-ch")
        for idx, ts in enumerate(scrambled, start=1):
            session.add(
                Post(
                    channel_name="order-ch",
                    post_id=idx,
                    text=f"p{idx}",
                    timestamp=ts,
                )
            )
        session.commit()

        recent = _fetch_recent_timestamps_by_channel(session, ["order-ch"], limit=2)

    assert recent == {"order-ch": stamps[-2:]}


def test_recent_timestamps_tolerates_a_repeated_channel_name() -> None:
    """A VALUES join would multiply rows where `IN (...)` collapsed them."""
    stamps = _hourly_timestamps(3)
    with Session(engine) as session:
        add_test_channel(session, "dup-ch")
        for idx, ts in enumerate(stamps, start=1):
            session.add(
                Post(channel_name="dup-ch", post_id=idx, text=f"p{idx}", timestamp=ts)
            )
        session.commit()

        recent = _fetch_recent_timestamps_by_channel(
            session, ["dup-ch", "dup-ch"], limit=100
        )

    assert recent == {"dup-ch": stamps}


def test_recent_timestamps_with_no_channels_asks_the_database_nothing() -> None:
    with Session(engine) as session:
        assert _fetch_recent_timestamps_by_channel(session, [], limit=100) == {}
