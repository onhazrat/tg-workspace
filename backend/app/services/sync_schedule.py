"""Pure scheduling helpers for regular + dynamic channel sync deadlines."""

from __future__ import annotations

from typing import Any


def _read(channel: Any, key: str, default: Any = None) -> Any:
    if isinstance(channel, dict):
        return channel.get(key, default)
    return getattr(channel, key, default)


def _is_regular_due(channel: Any, now_ms: int) -> bool:
    if not bool(_read(channel, "regular_sync_enabled", True)):
        return False
    deadline = _read(channel, "next_regular_sync_at")
    return deadline is None or now_ms >= int(deadline)


def _is_dynamic_eligible(channel: Any) -> bool:
    if not bool(_read(channel, "dynamic_sync_enabled", False)):
        return False
    has_posts = bool(_read(channel, "has_posts", False))
    velocity = float(_read(channel, "velocity", 0.0) or 0.0)
    return has_posts and velocity > 0.0


def _is_dynamic_due(channel: Any, now_ms: int) -> bool:
    if not _is_dynamic_eligible(channel):
        return False
    deadline = _read(channel, "next_dynamic_sync_at")
    return deadline is None or now_ms >= int(deadline)


def compute_next_regular_sync_at_from_last_updated(
    last_updated_ms: int | None,
    interval_minutes: int,
    now_ms: int,
) -> int:
    anchor = int(now_ms) if last_updated_ms is None else int(last_updated_ms)
    safe_interval = max(1, int(interval_minutes))
    return anchor + safe_interval * 60_000


def compute_next_regular_sync_at(now_ms: int, interval_minutes: int) -> int:
    """Compute next regular sync anchored at ``now`` (no prior last_updated)."""
    return compute_next_regular_sync_at_from_last_updated(
        None, interval_minutes, now_ms
    )


def compute_next_dynamic_sync_at_from_last_updated(
    last_updated_ms: int | None,
    expected_posts: int,
    velocity: float,
    now_ms: int,
) -> int | None:
    safe_velocity = float(velocity or 0.0)
    if safe_velocity <= 0.0:
        return None
    safe_expected_posts = max(1, int(expected_posts))
    anchor = int(now_ms) if last_updated_ms is None else int(last_updated_ms)
    hours = safe_expected_posts / safe_velocity
    return int(anchor + hours * 3_600_000)


def compute_next_dynamic_sync_at(
    now_ms: int,
    expected_posts: int,
    velocity: float,
) -> int | None:
    """Compute next dynamic sync anchored at ``now`` (no prior last_updated)."""
    return compute_next_dynamic_sync_at_from_last_updated(
        None, expected_posts, velocity, now_ms
    )


def due_reason(channel: Any, now_ms: int) -> str | None:
    regular_due = _is_regular_due(channel, now_ms)
    dynamic_due = _is_dynamic_due(channel, now_ms)
    if regular_due and dynamic_due:
        return "both"
    if regular_due:
        return "regular"
    if dynamic_due:
        return "dynamic"
    return None


def is_channel_due(channel: Any, now_ms: int) -> bool:
    if bool(_read(channel, "is_frozen", False)):
        return False
    if not bool(_read(channel, "regular_sync_enabled", True)) and not bool(
        _read(channel, "dynamic_sync_enabled", False)
    ):
        return False
    return due_reason(channel, now_ms) is not None


def apply_failure_backoff(
    channel: Any,
    now_ms: int,
    due_schedule_reason: str | None,
    backoff_minutes: int,
) -> None:
    if due_schedule_reason is None:
        return
    backoff_deadline = compute_next_regular_sync_at(now_ms, backoff_minutes)
    if due_schedule_reason in ("regular", "both"):
        setattr(channel, "next_regular_sync_at", backoff_deadline)
    if due_schedule_reason in ("dynamic", "both"):
        setattr(channel, "next_dynamic_sync_at", backoff_deadline)
