"""Tests for compute_scrape_cutoff_ms."""

from __future__ import annotations

import time

from app.jobs.settings import compute_scrape_cutoff_ms

DAY_MS = 24 * 60 * 60 * 1000


def test_scrape_cutoff_uses_max_of_retention_and_global_start() -> None:
    now = 2_000_000_000_000
    sync_settings = {"globalStartTimeMode": "relative", "globalStartTimeValue": 30}
    retention_settings = {"postRetentionDays": 7}

    cutoff = compute_scrape_cutoff_ms(
        sync_settings, retention_settings, now_ms=now
    )
    retention_cutoff = now - 7 * DAY_MS
    global_start = now - 30 * DAY_MS
    assert cutoff == max(retention_cutoff, global_start)


def test_scrape_cutoff_retention_zero_uses_global_start() -> None:
    now = 2_000_000_000_000
    sync_settings = {"globalStartTimeMode": "relative", "globalStartTimeValue": 14}
    retention_settings = {"postRetentionDays": 0}

    cutoff = compute_scrape_cutoff_ms(
        sync_settings, retention_settings, now_ms=now
    )
    assert cutoff == now - 14 * DAY_MS


def test_scrape_cutoff_zero_when_both_unbounded() -> None:
    now = int(time.time() * 1000)
    sync_settings = {"globalStartTimeMode": "retention"}
    retention_settings = {"postRetentionDays": 0}

    assert compute_scrape_cutoff_ms(sync_settings, retention_settings, now_ms=now) == 0
