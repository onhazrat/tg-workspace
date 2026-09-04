"""The Discover probe queue: the sweep that enqueues, and the probe that runs.

These cover the properties that made moving orchestration off the client worth
doing (IDEA-011 D9): the sweep decides its own work from the queue, one batch
cannot overlap another, and a single bad handle cannot take the rest down.

**Ticket 36 split the sweep in two** (ADR-012 D9). It used to fetch the batch
itself, behind an `asyncio.Semaphore(2)` chosen to stay below `bulk_follow`'s.
The reasoning was right and the mechanism was wrong twice: two concurrent
fetches outside the scraping Partition are a second budget nothing counts, and
a fetch holding no Slot binds to no proxy, so each probe picked whichever lane
was least loaded — the walk-hopping the Partition exists to remove, in the one
job that runs unprompted.

So the tick only *enqueues* now, onto `discover_probe_background`, which
`LaneScheduler` serves strictly after every sync lane. The fetching is
`probe_one_handle`, called by the lane consumer on a Slot. The tests below are
split the same way, and the properties are unchanged — each one just asks the
half that now answers for it.
"""

from __future__ import annotations

import asyncio
from collections.abc import Iterator
from typing import Any
from unittest.mock import AsyncMock, patch

import pytest
from sqlalchemy import text as sa_text
from sqlmodel import Session, select

from app.core.db import engine
from app.jobs.discover_probe import (
    is_sweep_running,
    probe_one_handle,
    run_discover_probe_sweep,
)
from app.models_tg import DiscoverHandleProbe
from app.services.discover_probes import (
    dequeue_handles,
    enqueue_handles,
    probe_map,
    queue_counts,
)
from app.services.sync_lanes import DISCOVER_PROBE_LANE
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


@pytest.fixture(autouse=True)
def _empty_probe_lane() -> Iterator[None]:
    """PGMQ queues are not `tg_*` tables, so the autouse TRUNCATE does not
    reach them and an aborted run leaves messages behind for the next one
    (`MEMORY.md`, pgmq-lanes-survive-test-cleanup)."""
    _purge()
    yield
    _purge()


def _purge() -> None:
    with Session(engine) as session:
        session.execute(sa_text(f"SELECT pgmq.purge_queue('{DISCOVER_PROBE_LANE}')"))
        session.commit()


def _lane_handles() -> list[str]:
    """What is sitting on the probe lane, without claiming it."""
    with Session(engine) as session:
        rows = session.execute(
            sa_text(
                f"SELECT message->>'handle' FROM pgmq.\"q_{DISCOVER_PROBE_LANE}\" "
                "ORDER BY msg_id"
            )
        ).all()
        return [str(row[0]) for row in rows]


# --- the sweep: it decides the work and queues it ------------------------


def test_an_empty_queue_is_not_an_error() -> None:
    """This fires on a timer, so most ticks have nothing to do."""
    assert asyncio.run(run_discover_probe_sweep()) == {
        "skipped": True,
        "reason": "queue empty",
    }


def test_the_sweep_finds_its_own_work_and_queues_it() -> None:
    """The point of the redesign: nobody hands it a handle list.

    It reports what it *enqueued* now rather than what it found, because it is
    finished long before the verdicts are.
    """
    _queue(["alpha_news", "beta_daily"])

    result = asyncio.run(run_discover_probe_sweep())

    assert result["enqueued"] == 2
    assert sorted(_lane_handles()) == ["alpha_news", "beta_daily"]
    # `remaining` is "handles still without a verdict", and enqueueing is not a
    # verdict. It used to drop to zero here because the tick fetched them too.
    assert result["remaining"] == 2


def test_a_tick_enqueues_nothing_while_the_lane_still_holds_work() -> None:
    """The gate that replaced the dequeue lease.

    Selecting work and doing it are separate steps now, so a handle keeps
    `status="unknown"` for as long as it sits on the lane. A tick that topped
    the lane up would re-select exactly those handles. Emptiness is what makes
    that impossible.
    """
    _queue([f"h{i:02d}" for i in range(10)])

    async def _run() -> list[dict[str, Any]]:
        with patch("app.jobs.discover_probe.settings.DISCOVER_PROBE_BATCH_SIZE", 4):
            return [await run_discover_probe_sweep() for _ in range(3)]

    first, second, third = asyncio.run(_run())

    assert first["enqueued"] == 4
    assert second == {"skipped": True, "reason": "lane still draining"}
    assert third == {"skipped": True, "reason": "lane still draining"}
    assert sorted(_lane_handles()) == [f"h{i:02d}" for i in range(4)], (
        "a tick queued more while the lane was still full, so the same handle "
        "is on it twice and will be fetched twice"
    )


def test_the_batch_is_bounded_and_the_rest_is_left_queued() -> None:
    """A report wider than one batch drains over several ticks, losing nothing.

    This is the bug that could not be fixed while the client chained the
    batches: it stopped chaining the moment the tab closed. It still holds, and
    the thing that advances between ticks is the *lane emptying* rather than a
    lease expiring.
    """
    _queue([f"h{i:02d}" for i in range(10)])
    seen: list[int] = []

    async def _run() -> None:
        with (
            patch("app.jobs.discover_probe.settings.DISCOVER_PROBE_BATCH_SIZE", 4),
            _patch_fetch(side_effect=lambda handle, **_: _channel_page(handle)),
        ):
            for _ in range(4):
                result = await run_discover_probe_sweep()
                seen.append(int(result.get("enqueued", 0)))
                # The consumer's half, run inline: drain what this tick queued
                # so the next one sees an empty lane.
                for handle in _lane_handles():
                    await probe_one_handle(handle)
                _purge()

    asyncio.run(_run())

    assert seen == [4, 4, 2, 0], f"ticks enqueued {seen}"
    with Session(engine) as session:
        assert queue_counts(session)["queued"] == 0
        assert dequeue_handles(session, limit=10) == [], (
            "handles were left without a verdict; the batches lost some"
        )


def test_a_drained_lane_lets_the_next_tick_refill_it() -> None:
    """The other direction. Gating on emptiness must not mean gating for ever —
    a sweep that never resumes is worse than one that duplicates."""
    _queue(["first_batch", "second_batch"])

    async def _run() -> tuple[dict[str, Any], dict[str, Any]]:
        with (
            patch("app.jobs.discover_probe.settings.DISCOVER_PROBE_BATCH_SIZE", 1),
            _patch_fetch(side_effect=lambda handle, **_: _channel_page(handle)),
        ):
            one = await run_discover_probe_sweep()
            for handle in _lane_handles():
                await probe_one_handle(handle)
            _purge()
            two = await run_discover_probe_sweep()
            return one, two

    one, two = asyncio.run(_run())
    assert one["enqueued"] == 1
    assert two["enqueued"] == 1, "the sweep never resumed after the lane drained"


def test_the_top_ranked_handles_go_first() -> None:
    """So the rows the operator is reading resolve before the long tail.

    Asserted on the lane's contents rather than on fetch order: the ranking is
    `dequeue_handles`', and once the messages are queued the consumer takes
    them in the order they were sent.
    """
    _queue(["first", "second", "third"])

    async def _run() -> None:
        with patch("app.jobs.discover_probe.settings.DISCOVER_PROBE_BATCH_SIZE", 2):
            await run_discover_probe_sweep()

    asyncio.run(_run())
    assert _lane_handles() == ["first", "second"]


def test_only_one_sweep_runs_at_a_time() -> None:
    """The invariant that replaces the racy in-memory latch.

    The old code checked "is a sweep running" and then awaited before recording
    that it had started one, so two callers could both pass the check. The
    loser became a sweep nothing could see or stop. It matters far less now
    that a tick's work is one `send_batch`, and it is still the invariant.
    """
    _queue(["slow_one", "slow_two"])

    async def _run() -> dict[str, Any]:
        started = asyncio.Event()
        release = asyncio.Event()

        async def _blocking(handles: list[str]) -> int:
            started.set()
            await release.wait()
            return len(handles)

        with patch(
            "app.jobs.sync_queue.enqueue_discover_probes", side_effect=_blocking
        ):
            first = asyncio.create_task(run_discover_probe_sweep())
            await started.wait()
            assert is_sweep_running() is True

            overlapping = await run_discover_probe_sweep()

            release.set()
            assert (await first)["enqueued"] == 2
            return overlapping

    assert asyncio.run(_run()) == {
        "skipped": True,
        "reason": "sweep already running",
    }
    assert is_sweep_running() is False


# --- the probe: one handle, one verdict ----------------------------------


def test_the_sweep_finds_a_handle_and_the_probe_resolves_it() -> None:
    """The two halves end to end, without the consumer in between."""
    _queue(["alpha_news", "beta_daily"])
    asyncio.run(run_discover_probe_sweep())

    async def _run() -> None:
        with _patch_fetch(side_effect=lambda handle, **_: _channel_page(handle)):
            for handle in _lane_handles():
                await probe_one_handle(handle)

    asyncio.run(_run())

    with Session(engine) as session:
        probes = probe_map(session, {"alpha_news", "beta_daily"})
        assert probes["alpha_news"]["status"] == "ok"
        assert probes["beta_daily"]["displayName"] == "Beta_Daily"


def test_a_handle_telegram_refuses_becomes_a_verdict() -> None:
    _queue(["helper_bot"])

    async def _run() -> str:
        with _patch_fetch(side_effect=TelegramWebViewUnavailable("no web view")):
            return await probe_one_handle("helper_bot")

    assert asyncio.run(_run()) == "unavailable"
    with Session(engine) as session:
        probe = probe_map(session, {"helper_bot"})["helper_bot"]
        assert probe["status"] == "unavailable"


def test_a_failed_fetch_leaves_the_handle_queued_without_a_verdict() -> None:
    _queue(["flaky"])

    async def _run() -> str:
        with _patch_fetch(side_effect=RuntimeError("connection reset")):
            return await probe_one_handle("flaky")

    assert asyncio.run(_run()) == "unknown"
    with Session(engine) as session:
        assert probe_map(session, {"flaky"})["flaky"]["status"] == "unknown"
        # Still pending, but now behind its backoff rather than due immediately.
        assert queue_counts(session)["retrying"] == 1
        assert dequeue_handles(session, limit=10) == []


def test_one_bad_handle_does_not_take_its_neighbours_with_it() -> None:
    """It was "does not abort the batch" while a batch was one `gather`. The
    handles are separate messages now, so the property is that a probe which
    raises resolves to `unknown` instead of escaping — a message that escaped
    would be redelivered up to `SYNC_QUEUE_MAX_READ_COUNT` times, retrying in
    the queue where the backlog table is supposed to hold the retry."""
    _queue(["good_one", "explodes", "good_two"])
    asyncio.run(run_discover_probe_sweep())

    async def _selective(handle: str, **_: Any) -> dict[str, Any]:
        if handle == "explodes":
            raise RuntimeError("boom")
        return _channel_page(handle)

    async def _run() -> list[str]:
        with _patch_fetch(side_effect=_selective):
            return [await probe_one_handle(h) for h in _lane_handles()]

    statuses = asyncio.run(_run())

    assert sorted(statuses) == ["ok", "ok", "unknown"]
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
            await probe_one_handle("alpha_news")
            return await run_discover_probe_sweep()

    assert asyncio.run(_run())["skipped"] is True
    assert fetch.await_count == 1


def test_dequeue_is_a_pure_read_again() -> None:
    """It briefly wrote a `retry_after` lease, and that column now means one
    thing again: the failure backoff, set only by `record_probe_result`.

    Asserted on the rows rather than on the source, because the failure this
    prevents is a *write* sneaking back in — a lease, a claim flag, an
    `attempts` bump — not any particular spelling of one.
    """
    _queue(["pure_read_one", "pure_read_two"])

    def _rows() -> dict[str, dict[str, Any]]:
        """Every column, straight off the model.

        Not `probe_map`, which is a projection for the API and does not carry
        `attempts` — the first version of this compared `None` to `None` and
        stayed green when `dequeue_handles` was mutated to bump it. Snapshotting
        the columns means *any* write fails this, which is the claim.
        """
        with Session(engine) as session:
            return {
                row.handle: {
                    c.name: getattr(row, c.name)
                    for c in DiscoverHandleProbe.__table__.columns  # type: ignore[attr-defined]
                }
                for row in session.exec(select(DiscoverHandleProbe)).all()
            }

    before = _rows()
    with Session(engine) as session:
        first = dequeue_handles(session, limit=10)
        second = dequeue_handles(session, limit=10)
    after = _rows()

    assert first == second, (
        "a second read returned something different, so the first one wrote"
    )
    assert before == after, "dequeue mutated the rows. Changed: " + str(
        {
            h: {k: (v, after[h][k]) for k, v in cols.items() if after[h][k] != v}
            for h, cols in before.items()
            if after.get(h) != cols
        }
    )


def test_a_starved_lane_never_grows_a_duplicate() -> None:
    """The defect this replaced the lease to fix, driven end to end.

    A probe waiting behind sync work outlasted its 60-minute lease, became due
    again, and the next tick queued a second copy. Time is not simulated here
    and does not need to be: the gate makes the *lane* the answer, so a tick
    cannot queue a duplicate however long the first copy has been sitting
    there. Fifty ticks stand in for a long starvation.
    """
    _queue([f"starve{i:02d}" for i in range(3)])

    async def _run() -> None:
        with patch("app.jobs.discover_probe.settings.DISCOVER_PROBE_BATCH_SIZE", 3):
            for _ in range(50):
                await run_discover_probe_sweep()

    asyncio.run(_run())

    handles = _lane_handles()
    assert sorted(handles) == ["starve00", "starve01", "starve02"], handles
    assert len(handles) == len(set(handles)), (
        f"the lane holds duplicates after a starvation: {handles}"
    )
