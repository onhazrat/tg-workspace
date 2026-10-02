"""What Reach a probe stores on a Directory entry (REACH-04, ADR-024).

Driven through `record_probe_result`, the seam the spec names, with sample Posts
dated back from the real clock: the probe measures each sample's age as the
probe time minus its publication time, so the ages here sit well clear of the
settling age and the floor for a test that takes a second to run.

## Watched to fail

* age the samples from the newest sample instead of the probe time -> the
  measured case reads the young Posts as Settled and the median moves
* store `compute_sample_statistics` alone and leave Reach unset -> every case
* read the default settings instead of the stored ones -> the settling-age case
  keeps its estimate on the second probe
"""

from __future__ import annotations

import time
from typing import Any

from sqlmodel import Session

from app.core.db import engine
from app.services.channel_directory import record_probe_result
from app.services.settings_registry import REACH_KEY
from app.services.settings_store import put_global_setting

HANDLE = "reach_news"
HOUR_MS = 3_600_000


def _samples(rows: list[tuple[int, float]]) -> list[dict[str, Any]]:
    """`(views, hours before now)` per sample Post, as the parser builds them."""
    now = int(time.time() * 1000)
    return [
        {
            "id": 100 + i,
            "text": "words",
            "date": "2026-09-27T00:00:00+00:00",
            "timestamp": now - round(hours * HOUR_MS),
            "channelName": HANDLE,
            "media": {"kinds": [], "viewsCount": views},
        }
        for i, (views, hours) in enumerate(rows)
    ]


def _probe(rows: list[tuple[int, float]]) -> dict[str, Any]:
    page = {
        "isTelegramPage": True,
        "isUnavailableOnWebView": False,
        "kind": "channel",
        "samples": _samples(rows),
    }
    with Session(engine) as session:
        return record_probe_result(session, HANDLE, page)


def test_five_settled_samples_store_a_measured_reach() -> None:
    """Young samples stay out of a measured median, however many there are."""
    after = _probe(
        [(100, 48), (101, 30), (102, 72), (103, 26), (104, 100)] + [(5, 10)] * 6
    )

    assert (after["reach"], after["reachEstimated"]) == (102, False)


def test_fewer_settled_samples_store_an_estimate() -> None:
    """Two Settled, three between the floor and the settling age, two below the
    floor. A 13-hour count holds 0.816 of its Settled value on the seed
    curve, so 860 corrects to 1054; the one-hour counts are left out."""
    after = _probe([(1000, 48), (1000, 30)] + [(860, 13)] * 3 + [(1, 1)] * 2)

    assert (after["reach"], after["reachEstimated"]) == (1054, True)


def test_too_few_samples_past_the_floor_store_nothing() -> None:
    after = _probe([(1000, 48), (1000, 30), (860, 13), (860, 13)] + [(1, 1)] * 10)

    assert (after["reach"], after["reachEstimated"]) == (None, False)


def test_a_settling_age_change_reaches_the_entry_at_its_next_probe() -> None:
    """No sweep: the next probe reads the settings in force then."""
    rows = [(860, 13)] * 5
    before = _probe(rows)
    with Session(engine) as session:
        put_global_setting(session, REACH_KEY, {"settlingAgeHours": 12})
    after = _probe(rows)

    assert (before["reach"], before["reachEstimated"]) == (1054, True)
    assert (after["reach"], after["reachEstimated"]) == (860, False)
