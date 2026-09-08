"""Which probe outcome writes a Directory entry's statistics (ticket 02, ADR-015).

The arithmetic is `test_directory_statistics.py`, which needs no database. What
is asserted here is the **seam**: the probe write path, which the spec names for
everything about what a Directory entry stores. Driven through
`record_probe_result` rather than through the columns, for the reason
`test_directory_samples.py` gives — the table this would otherwise pin has
already been renamed once.

A file of its own rather than more of `test_directory_samples.py`, because the
statistics and the samples are the two halves that ADR-015 exists to tell apart,
and the one test that matters most here is the one where they part company.

## Watched to fail

* drop the `row.status == "ok"` guard in `record_probe_result` → the unavailable
  test fails, because the synthesized empty sample list computes absent
  statistics over a row that must keep them
* compute before `replace_samples` rather than after → the replacement test
  fails, storing the previous probe's numbers
* leave the statistics alone in `requeue_probes` → the recheck test fails
* keep the counters on the sealing `unavailable` (skip `_apply_page_metadata`
  there too) → the same unavailable test fails on the mix, which is the half of
  the promise nothing else asserts
"""

from __future__ import annotations

import importlib
from typing import Any

import pytest
from sqlalchemy import text as sa_text
from sqlmodel import Session

from app.core.db import engine
from app.models_tg import DirectoryEntry
from app.services.channel_directory import record_probe_result, requeue_probes
from app.services.channel_directory_samples import samples_for
from app.services.directory_statistics import compute_sample_statistics

HANDLE = "stats_news"
_WEEK_MS = 7 * 24 * 60 * 60 * 1000
_ORIGIN = 1_756_720_800_000

#: What `jobs/discover_probe.py` synthesizes when Telegram reports no web view.
#: An empty sample list rather than an absent key, so a handle that just went
#: private stops advertising Posts nobody can reach.
GONE: dict[str, Any] = {
    "isTelegramPage": True,
    "isUnavailableOnWebView": True,
    "samples": [],
}


def _weekly(count: int, *, views: int | None = None) -> list[dict[str, Any]]:
    """`count` sample Posts one week apart, as `_parse_posts_from_html` builds them."""
    out: list[dict[str, Any]] = []
    for i in range(count):
        post: dict[str, Any] = {
            "id": 100 + i,
            "text": f"post {i}",
            "date": "2026-09-01T10:00:00+00:00",
            "timestamp": _ORIGIN + i * _WEEK_MS,
            "channelName": HANDLE,
        }
        if views is not None:
            post["media"] = {"kinds": [], "viewsCount": views + i}
        out.append(post)
    return out


def _page(*, samples: list[dict[str, Any]], **extra: Any) -> dict[str, Any]:
    return {
        "isTelegramPage": True,
        "isUnavailableOnWebView": False,
        "kind": "channel",
        "displayName": "Stats News",
        "subscribers": "12.3K",
        "samples": samples,
        **extra,
    }


def test_a_conclusive_probe_stores_the_statistics_of_the_samples_it_stored() -> None:
    with Session(engine) as session:
        after = record_probe_result(
            session, HANDLE, _page(samples=_weekly(5, views=1000))
        )

        assert after["sampleCount"] == 5
        # Five Posts a week apart span four weeks: one per week, not 1.25.
        assert after["postsPerWeek"] == 1.0
        assert after["medianViews"] == 1002
        assert after["forwardShare"] == 0.0
        assert after["lastPostAt"] is not None


def test_the_next_conclusive_probe_replaces_them() -> None:
    with Session(engine) as session:
        record_probe_result(session, HANDLE, _page(samples=_weekly(5, views=1000)))
        after = record_probe_result(session, HANDLE, _page(samples=_weekly(1)))

        assert after["sampleCount"] == 1
        # One Post is below the threshold: the rates go, the count stays, and
        # that is what lets a blank cadence explain itself on the row.
        assert after["postsPerWeek"] is None
        assert after["medianViews"] is None


def test_an_inconclusive_fetch_leaves_them_alone() -> None:
    """One proxy timeout must not blank a good entry, here as everywhere else
    on this path — the same rule the verdict itself follows."""
    with Session(engine) as session:
        record_probe_result(session, HANDLE, _page(samples=_weekly(5, views=1000)))
        after = record_probe_result(session, HANDLE, None, error="timeout")

        assert after["sampleCount"] == 5
        assert after["postsPerWeek"] == 1.0


def test_an_unavailable_entry_keeps_its_statistics_and_loses_its_mix() -> None:
    """The one place the statistics and the samples part company.

    An unavailable entry is never refreshed again, so it can never recompute
    these — and it is precisely the row where "posted weekly until fourteen
    months ago" is worth more than the bare verdict. Clearing them alongside the
    samples would delete the last picture of the only rows that cannot rebuild
    it.

    The mix and the density go, and that asymmetry is the point rather than an
    oversight. They derive from the four counters and the latest Post id, which
    are a snapshot of a page, and a stale snapshot is a lie — which is why the
    deployment already clears the subscriber count on this same path, and why
    the chat id is the single field that survives it. A sample-derived statistic
    is a claim about what the Channel *did*, and that stays true after Telegram
    stops serving it.

    Two unavailable answers, because the first one overturning an `ok` is
    provisional (ticket 03) and deliberately keeps the whole page. The second
    seals the verdict and takes the counters with it.
    """
    with Session(engine) as session:
        alive = record_probe_result(
            session,
            HANDLE,
            _page(samples=_weekly(5, views=1000), photos="300", latestId="900"),
        )
        assert alive["mediaMix"] == {"photos": 1.0}
        assert alive["mediaDensity"] == 300 / 900

        record_probe_result(session, HANDLE, GONE)
        after = record_probe_result(session, HANDLE, GONE)

        assert after["status"] == "unavailable"
        assert samples_for(session, HANDLE) == [], "the samples are still cleared"

        assert after["sampleCount"] == 5
        assert after["postsPerWeek"] == 1.0
        assert after["medianViews"] == 1002
        assert after["forwardShare"] == 0.0
        assert after["lastPostAt"] is not None

        # Gone with the page, exactly as the subscriber count already is.
        assert after["subscribers"] is None
        assert after["mediaMix"] is None
        assert after["mediaDensity"] is None


def test_a_recheck_discards_them_with_the_verdict() -> None:
    """The exception to the rule above, and the opposite case.

    A recheck resets the row to `unknown`, which means the deployment holds no
    answer rather than a negative one. A row claiming no answer must not still
    show a cadence, so these go with every other metadata field — unlike the
    samples, which a recheck deliberately keeps.
    """
    with Session(engine) as session:
        record_probe_result(session, HANDLE, _page(samples=_weekly(5, views=1000)))
        requeue_probes(session, [HANDLE])

        row = session.get(DirectoryEntry, HANDLE)
        assert row is not None
        assert row.sample_count is None
        assert row.posts_per_week is None
        assert row.median_views is None
        assert row.forward_share is None
        assert row.last_post_at is None
        assert row.script is None


def test_the_migration_backfill_agrees_with_the_transform() -> None:
    """The two implementations of one formula, pinned to each other.

    The backfill restates the arithmetic in SQL rather than importing the
    transform, because an applied revision has to keep meaning what it meant and
    an imported module is free to change underneath it. That duplication is
    deliberate, and this is what keeps it honest: seed samples, blank the
    columns, run the migration's own statement, and require the answer the pure
    transform gives.

    `script` is out of the comparison because the backfill does not compute it.
    See the migration's docstring for why a per-character tally is left to a
    refresh window that is a week away.
    """
    module = importlib.import_module(
        "app.alembic.versions.d1e2f3a4b5c6_directory_statistics"
    )
    with Session(engine) as session:
        record_probe_result(session, HANDLE, _page(samples=_weekly(9, views=500)))
        expected = compute_sample_statistics(samples_for(session, HANDLE))

        session.execute(
            sa_text(
                "UPDATE tg_channel_directory SET last_post_at = NULL, "
                "sample_count = NULL, posts_per_week = NULL, "
                "median_views = NULL, forward_share = NULL"
            )
        )
        session.execute(sa_text(module._BACKFILL))
        session.commit()

        row = session.get(DirectoryEntry, HANDLE)
        assert row is not None
        assert row.sample_count == expected.sample_count
        assert row.last_post_at == expected.last_post_at
        assert row.median_views == expected.median_views
        assert row.posts_per_week == pytest.approx(expected.posts_per_week)
        assert row.forward_share == pytest.approx(expected.forward_share)
