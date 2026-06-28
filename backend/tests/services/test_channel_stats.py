"""Channel stats batch SQL and velocity helpers."""

from __future__ import annotations

from datetime import datetime
from unittest.mock import patch

from fastapi import HTTPException
from sqlmodel import Session

from app.core.db import engine
from app.models_tg import Channel, Post
from app.services.channels import (
    compute_channel_stats,
    compute_channel_stats_batch,
    get_channel_stats,
)


def _hourly_timestamps(count: int) -> list[int]:
    now_ms = int(datetime.utcnow().timestamp() * 1000)
    start = now_ms - count * 3_600_000
    return [start + i * 3_600_000 for i in range(count)]


def test_batch_stats_count_min_max() -> None:
    with Session(engine) as session:
        session.add(Channel(id="stats-a", name="stats-a"))
        session.add(Channel(id="stats-b", name="stats-b"))
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
        session.add(Channel(id="vel-ch", name="vel-ch"))
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
        with patch("app.services.channels.datetime") as mock_dt:
            mock_dt.utcnow.return_value = fixed_now
            batch = compute_channel_stats_batch(session, ["vel-ch"])["vel-ch"]
            single = compute_channel_stats(session, "vel-ch")

        assert single == batch
        assert batch["velocity"] > 0


def test_batch_stats_empty_channel() -> None:
    with Session(engine) as session:
        session.add(Channel(id="empty-ch", name="empty-ch"))
        session.add(Channel(id="has-posts", name="has-posts"))
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
        session.add(Channel(id="zero-ts-ch", name="zero-ts-ch"))
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
        session.add(Channel(id="delegate-ch", name="delegate-ch"))
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
        with patch("app.services.channels.datetime") as mock_dt:
            mock_dt.utcnow.return_value = fixed_now
            batch_entry = compute_channel_stats_batch(session, ["delegate-ch"])[
                "delegate-ch"
            ]
            stats = get_channel_stats(session, "delegate-ch")

        assert stats == batch_entry


def test_get_channel_stats_no_posts_raises() -> None:
    with Session(engine) as session:
        session.add(Channel(id="no-posts-ch", name="no-posts-ch"))
        session.commit()

        try:
            get_channel_stats(session, "no-posts-ch")
        except HTTPException as exc:
            assert exc.status_code == 404
            assert exc.detail == "No posts for channel"
        else:
            raise AssertionError("expected HTTPException")
