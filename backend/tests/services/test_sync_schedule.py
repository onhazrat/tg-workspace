"""Pure sync schedule helper tests."""

from __future__ import annotations

from dataclasses import dataclass

from app.services.sync_schedule import (
    apply_failure_backoff,
    compute_next_dynamic_sync_at,
    compute_next_dynamic_sync_at_from_last_updated,
    compute_next_regular_sync_at,
    compute_next_regular_sync_at_from_last_updated,
    due_reason,
    is_channel_due,
)


@dataclass
class _ScheduleStub:
    regular_sync_enabled: bool = True
    dynamic_sync_enabled: bool = False
    auto_sync_interval_minutes: int = 60
    dynamic_sync_expected_posts: int = 15
    next_regular_sync_at: int | None = None
    next_dynamic_sync_at: int | None = None
    has_posts: bool = False
    velocity: float = 0.0
    is_frozen: bool = False


def test_compute_next_regular_sync_at() -> None:
    assert compute_next_regular_sync_at(1_000, 60) == 3_601_000
    assert compute_next_regular_sync_at(1_000, 5) == 301_000


def test_compute_next_regular_sync_at_from_last_updated() -> None:
    assert (
        compute_next_regular_sync_at_from_last_updated(5_000, 60, 9_000)
        == 5_000 + 60 * 60_000
    )
    assert (
        compute_next_regular_sync_at_from_last_updated(None, 30, 2_000)
        == 2_000 + 30 * 60_000
    )


def test_compute_next_dynamic_sync_at() -> None:
    next_at = compute_next_dynamic_sync_at(10_000, expected_posts=15, velocity=3.0)
    assert next_at == 18_010_000
    # 15 expected posts / 7.5 posts/hour = 2 hours
    assert compute_next_dynamic_sync_at(2_000, 15, 7.5) == 7_202_000


def test_compute_next_dynamic_sync_at_from_last_updated() -> None:
    assert (
        compute_next_dynamic_sync_at_from_last_updated(5_000, 15, 3.0, 9_000)
        == 5_000 + 5 * 3_600_000
    )
    assert (
        compute_next_dynamic_sync_at_from_last_updated(None, 15, 3.0, 2_000)
        == 2_000 + 5 * 3_600_000
    )


def test_compute_next_dynamic_sync_at_zero_velocity_returns_none() -> None:
    assert compute_next_dynamic_sync_at(10_000, expected_posts=15, velocity=0.0) is None
    assert compute_next_dynamic_sync_at(0, 15, 0.0) is None
    assert compute_next_dynamic_sync_at_from_last_updated(5_000, 15, 0.0, 9_000) is None


def test_is_channel_due_regular_or_dynamic() -> None:
    now = 10_000
    regular_due = _ScheduleStub(
        regular_sync_enabled=True,
        next_regular_sync_at=9_000,
        dynamic_sync_enabled=False,
    )
    assert is_channel_due(regular_due, now) is True
    assert due_reason(regular_due, now) == "regular"

    dynamic_due = _ScheduleStub(
        regular_sync_enabled=False,
        dynamic_sync_enabled=True,
        has_posts=True,
        velocity=2.5,
        next_dynamic_sync_at=9_000,
    )
    assert is_channel_due(dynamic_due, now) is True
    assert due_reason(dynamic_due, now) == "dynamic"


def test_due_reason_both() -> None:
    now = 10_000
    channel = _ScheduleStub(
        regular_sync_enabled=True,
        next_regular_sync_at=9_000,
        dynamic_sync_enabled=True,
        has_posts=True,
        velocity=3.0,
        next_dynamic_sync_at=9_500,
    )
    assert is_channel_due(channel, now) is True
    assert due_reason(channel, now) == "both"


def test_dynamic_disabled_for_no_posts_or_zero_velocity() -> None:
    now = 10_000
    no_posts = _ScheduleStub(
        regular_sync_enabled=False,
        dynamic_sync_enabled=True,
        has_posts=False,
        velocity=10.0,
        next_dynamic_sync_at=0,
    )
    assert is_channel_due(no_posts, now) is False
    assert due_reason(no_posts, now) is None

    zero_velocity = _ScheduleStub(
        regular_sync_enabled=False,
        dynamic_sync_enabled=True,
        has_posts=True,
        velocity=0.0,
        next_dynamic_sync_at=0,
    )
    assert is_channel_due(zero_velocity, now) is False
    assert due_reason(zero_velocity, now) is None


def test_apply_failure_backoff_due_only() -> None:
    now = 100_000
    channel = _ScheduleStub(
        regular_sync_enabled=True,
        dynamic_sync_enabled=True,
        next_regular_sync_at=1_000,
        next_dynamic_sync_at=2_000,
    )
    apply_failure_backoff(channel, now, "regular", 5)
    assert channel.next_regular_sync_at == now + 300_000
    assert channel.next_dynamic_sync_at == 2_000

    apply_failure_backoff(channel, now, "both", 5)
    assert channel.next_regular_sync_at == now + 300_000
    assert channel.next_dynamic_sync_at == now + 300_000


def test_apply_failure_backoff_dynamic_only() -> None:
    now_ms = 1000
    channel = _ScheduleStub(
        regular_sync_enabled=True,
        dynamic_sync_enabled=True,
        next_regular_sync_at=900,
        next_dynamic_sync_at=900,
        has_posts=True,
        velocity=1.0,
    )
    apply_failure_backoff(channel, now_ms, "dynamic", 5)
    assert channel.next_regular_sync_at == 900
    assert channel.next_dynamic_sync_at == now_ms + 5 * 60_000
