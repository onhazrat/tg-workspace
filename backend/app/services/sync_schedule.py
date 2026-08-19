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
    return _dynamic_deadline_reached(channel, now_ms)


def _dynamic_deadline_reached(channel: Any, now_ms: int) -> bool:
    deadline = _read(channel, "next_dynamic_sync_at")
    return deadline is None or now_ms >= int(deadline)


def needs_dynamic_stats(channel: Any, now_ms: int) -> bool:
    """Whether `has_posts`/`velocity` can change this channel's due-ness.

    `_is_dynamic_eligible` is the *only* reader of those two fields, and it is
    only reached from `_is_dynamic_due`. So no stats value can change any answer
    this module gives unless the stats-independent conditions around that call
    already hold: dynamic sync is on for the channel, and its dynamic deadline
    has passed (or was never set).

    This exists because the caller was paying to find out. `jobs/auto_sync.py`
    computed `count(*)`, `min(post_id)` and `max(post_id)` across 4.54M posts for
    all 2,077 channels every 60 seconds — 69 minutes of database time per 10
    hours — to answer this for six of them. It lives here rather than in the
    scheduler job so that it and the rule it mirrors are read together; split
    across two files, the next condition added to `_is_dynamic_due` silently
    stops being reflected in what the caller bothers to fetch.

    **Not** short-circuited on `is_frozen`, though every frozen channel is
    filtered out one step later by `is_channel_due`. Adding it would make the
    predicate sound only for callers that consult `due_reason` *after*
    `is_channel_due` — true of the one caller today, and an unmarked trap for the
    next one. Without it the guarantee is unconditional: wherever this returns
    `False`, every function in this module answers identically for every stats
    value. It costs nothing to give up, because a frozen group disables both sync
    modes anyway, so `dynamic_sync_enabled` already excludes those channels.

    Deliberately conservative in the other direction: it may say `True` for a
    channel that turns out not to be due, which only costs a stats row. Saying
    `False` where the stats mattered would silently stop syncing a channel, which
    is why `test_sync_schedule_stats_narrowing.py` checks the implication over
    the whole input space rather than at sampled points.
    """
    if not bool(_read(channel, "dynamic_sync_enabled", False)):
        return False
    return _dynamic_deadline_reached(channel, now_ms)


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
        channel.next_regular_sync_at = backoff_deadline
    if due_schedule_reason in ("dynamic", "both"):
        channel.next_dynamic_sync_at = backoff_deadline
