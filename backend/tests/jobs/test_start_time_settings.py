"""Tests for effective global start time computation."""

from __future__ import annotations

from datetime import datetime

from app.jobs.settings import (
    channel_resolve_target_ms,
    compute_effective_global_start_time_ms,
    needs_start_id_resolve,
)

NOW = 1_700_000_000_000
DAY_MS = 24 * 60 * 60 * 1000


def test_relative_mode_uses_configured_days() -> None:
    for days in (7, 14):
        result = compute_effective_global_start_time_ms(
            {"globalStartTimeMode": "relative", "globalStartTimeValue": days},
            {"postRetentionDays": 0},
            now_ms=NOW,
        )
        assert result == NOW - days * DAY_MS
    assert compute_effective_global_start_time_ms(
        {"globalStartTimeMode": "relative", "globalStartTimeValue": 7},
        {"postRetentionDays": 0},
        now_ms=NOW,
    ) != compute_effective_global_start_time_ms(
        {"globalStartTimeMode": "relative", "globalStartTimeValue": 14},
        {"postRetentionDays": 0},
        now_ms=NOW,
    )


def test_relative_mode_without_value_falls_back_to_retention() -> None:
    result = compute_effective_global_start_time_ms(
        {"globalStartTimeMode": "relative"},
        {"postRetentionDays": 30},
        now_ms=NOW,
    )
    assert result == NOW - 30 * DAY_MS


def test_relative_mode_without_value_and_zero_retention_returns_zero() -> None:
    result = compute_effective_global_start_time_ms(
        {"globalStartTimeMode": "relative"},
        {"postRetentionDays": 0},
        now_ms=NOW,
    )
    assert result == 0


def test_retention_mode_with_zero_days_returns_zero() -> None:
    result = compute_effective_global_start_time_ms(
        {"globalStartTimeMode": "retention"},
        {"postRetentionDays": 0},
        now_ms=NOW,
    )
    assert result == 0


def test_absolute_mode_parses_iso_string() -> None:
    target = "2024-01-15T12:00:00.000Z"
    expected = int(
        datetime.fromisoformat(target.replace("Z", "+00:00")).timestamp() * 1000
    )
    result = compute_effective_global_start_time_ms(
        {"globalStartTimeMode": "absolute", "globalStartTimeValue": target},
        {"postRetentionDays": 0},
        now_ms=NOW,
    )
    assert result == expected


def test_retention_clamps_absolute_start_time() -> None:
    result = compute_effective_global_start_time_ms(
        {
            "globalStartTimeMode": "absolute",
            "globalStartTimeValue": "2020-01-01T00:00:00.000Z",
        },
        {"postRetentionDays": 30},
        now_ms=NOW,
    )
    assert result == NOW - 30 * DAY_MS


def test_channel_resolve_target_uses_effective_when_channel_start_zero() -> None:
    assert channel_resolve_target_ms(0, NOW - 7 * DAY_MS) == NOW - 7 * DAY_MS
    assert channel_resolve_target_ms(None, NOW - 7 * DAY_MS) == NOW - 7 * DAY_MS


def test_channel_resolve_target_clamps_to_retention() -> None:
    channel_start = NOW - 30 * DAY_MS
    effective = NOW - 7 * DAY_MS
    assert channel_resolve_target_ms(channel_start, effective) == effective


def test_needs_start_id_resolve_for_legacy_zero_start_time() -> None:
    assert needs_start_id_resolve(
        start_id=2,
        channel_start_time_ms=0,
        effective_start_time_ms=NOW - 7 * DAY_MS,
    )
    assert not needs_start_id_resolve(
        start_id=42,
        channel_start_time_ms=NOW - 7 * DAY_MS,
        effective_start_time_ms=NOW - 7 * DAY_MS,
    )
