"""The scheduled drain of the Discover probe queue (IDEA-011 D9).

These cover the properties that made moving orchestration off the client worth
doing: the sweep decides its own work from the queue, one batch cannot overlap
another, and a single bad handle cannot take the batch down with it.
"""

from __future__ import annotations

import asyncio
from typing import Any
from unittest.mock import AsyncMock, patch

from sqlmodel import Session

from app.core.db import engine
from app.jobs.discover_probe import is_sweep_running, run_discover_probe_sweep
from app.services.discover_probes import (
    dequeue_handles,
    enqueue_handles,
    probe_map,
    queue_counts,
)
from app.services.telegram_web import TelegramWebViewUnavailable


def _channel_page(handle: str) -> dict[str, Any]:
    return {
        "isTelegramPage": True,
        "isUnavailableOnWebView": False,
        "kind": "channel",
        "displayName": handle.title(),
        "subscribers": "1.2K",
        "latestId": 7,
    }


def _patch_fetch(**kwargs: Any) -> Any:
    return patch(
        "app.jobs.discover_probe.get_channel_info", new_callable=AsyncMock, **kwargs
    )


def _queue(handles: list[str]) -> None:
    with Session(engine) as session:
        enqueue_handles(session, handles)


def test_an_empty_queue_is_not_an_error() -> None:
    """This fires on a timer, so most ticks have nothing to do."""
    assert asyncio.run(run_discover_probe_sweep()) == {
        "skipped": True,
        "reason": "queue empty",
    }


def test_the_sweep_finds_its_own_work() -> None:
    """The point of the redesign: nobody hands it a handle list."""
    _queue(["alpha_news", "beta_daily"])

    async def _run() -> dict[str, Any]:
        with _patch_fetch(side_effect=lambda handle, **_: _channel_page(handle)):
            return await run_discover_probe_sweep()

    result = asyncio.run(_run())
    assert result["probed"] == 2
    assert result["resolved"] == 2
    assert result["remaining"] == 0

    with Session(engine) as session:
        probes = probe_map(session, {"alpha_news", "beta_daily"})
        assert probes["alpha_news"]["status"] == "ok"
        assert probes["beta_daily"]["displayName"] == "Beta_Daily"


def test_the_batch_is_bounded_and_the_rest_is_left_queued() -> None:
    """A report wider than one batch drains over several ticks, losing nothing.

    This is the bug that could not be fixed while the client chained the batches:
    it stopped chaining the moment the tab closed.
    """
    _queue([f"h{i:02d}" for i in range(10)])

    async def _run() -> list[dict[str, Any]]:
        with (
            patch("app.jobs.discover_probe.settings.DISCOVER_PROBE_BATCH_SIZE", 4),
            _patch_fetch(side_effect=lambda handle, **_: _channel_page(handle)),
        ):
            return [await run_discover_probe_sweep() for _ in range(4)]

    first, second, third, fourth = asyncio.run(_run())
    assert (first["probed"], first["remaining"]) == (4, 6)
    assert (second["probed"], second["remaining"]) == (4, 2)
    assert (third["probed"], third["remaining"]) == (2, 0)
    assert fourth["skipped"] is True


def test_the_top_ranked_handles_go_first() -> None:
    """So the rows the operator is reading resolve before the long tail."""
    _queue(["first", "second", "third"])
    seen: list[str] = []

    async def _record(handle: str, **_: Any) -> dict[str, Any]:
        seen.append(handle)
        return _channel_page(handle)

    async def _run() -> None:
        with (
            patch("app.jobs.discover_probe.settings.DISCOVER_PROBE_BATCH_SIZE", 2),
            patch("app.jobs.discover_probe.PROBE_SCRAPE_CONCURRENCY", 1),
            _patch_fetch(side_effect=_record),
        ):
            await run_discover_probe_sweep()

    asyncio.run(_run())
    assert seen == ["first", "second"]


def test_only_one_sweep_runs_at_a_time() -> None:
    """The invariant that replaces the racy in-memory latch.

    The old code checked "is a sweep running" and then awaited before recording
    that it had started one, so two callers could both pass the check. The loser
    became a sweep nothing could see or stop.
    """
    _queue(["slow_one", "slow_two"])

    async def _run() -> dict[str, Any]:
        started = asyncio.Event()
        release = asyncio.Event()

        async def _blocking(handle: str, **_: Any) -> dict[str, Any]:
            started.set()
            await release.wait()
            return _channel_page(handle)

        with _patch_fetch(side_effect=_blocking):
            first = asyncio.create_task(run_discover_probe_sweep())
            await started.wait()
            assert is_sweep_running() is True

            overlapping = await run_discover_probe_sweep()

            release.set()
            assert (await first)["probed"] == 2
            return overlapping

    assert asyncio.run(_run()) == {
        "skipped": True,
        "reason": "sweep already running",
    }
    assert is_sweep_running() is False


def test_a_handle_telegram_refuses_becomes_a_verdict() -> None:
    _queue(["helper_bot"])

    async def _run() -> dict[str, Any]:
        with _patch_fetch(side_effect=TelegramWebViewUnavailable("no web view")):
            return await run_discover_probe_sweep()

    assert asyncio.run(_run())["unavailable"] == 1
    with Session(engine) as session:
        probe = probe_map(session, {"helper_bot"})["helper_bot"]
        assert probe["status"] == "unavailable"


def test_a_failed_fetch_leaves_the_handle_queued_without_a_verdict() -> None:
    _queue(["flaky"])

    async def _run() -> dict[str, Any]:
        with _patch_fetch(side_effect=RuntimeError("connection reset")):
            return await run_discover_probe_sweep()

    assert asyncio.run(_run())["failed"] == 1
    with Session(engine) as session:
        assert probe_map(session, {"flaky"})["flaky"]["status"] == "unknown"
        # Still pending, but now behind its backoff rather than due immediately.
        assert queue_counts(session)["retrying"] == 1
        assert dequeue_handles(session, limit=10) == []


def test_one_bad_handle_does_not_abort_the_batch() -> None:
    _queue(["good_one", "explodes", "good_two"])

    async def _selective(handle: str, **_: Any) -> dict[str, Any]:
        if handle == "explodes":
            raise RuntimeError("boom")
        return _channel_page(handle)

    async def _run() -> dict[str, Any]:
        with _patch_fetch(side_effect=_selective):
            return await run_discover_probe_sweep()

    result = asyncio.run(_run())
    assert result["probed"] == 3
    assert result["resolved"] == 2
    assert result["failed"] == 1
    with Session(engine) as session:
        probes = probe_map(session, {"good_one", "good_two"})
        assert probes["good_one"]["status"] == "ok"
        assert probes["good_two"]["status"] == "ok"


def test_resolved_handles_are_never_swept_again() -> None:
    """The cache is what makes an automatic sweep affordable."""
    _queue(["alpha_news"])
    fetch = AsyncMock(side_effect=lambda handle, **_: _channel_page(handle))

    async def _run() -> dict[str, Any]:
        with patch("app.jobs.discover_probe.get_channel_info", fetch):
            await run_discover_probe_sweep()
            return await run_discover_probe_sweep()

    assert asyncio.run(_run())["skipped"] is True
    assert fetch.await_count == 1
