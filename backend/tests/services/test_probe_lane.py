"""Discover probes go through the Partition, at the lowest priority.

They used to run on an `asyncio.Semaphore(2)` inside the scheduled sweep, and
the number was chosen to stay below `bulk_follow`'s on the reasoning that a
sweep finishing a minute later matters far less than a sync stalling behind it.
That reasoning was right and the mechanism was wrong twice over (ADR-012 D9):

- Two concurrent fetches outside the Partition are a second scraping budget
  nothing counts — the same defect as `run_sync_job`'s semaphore, reached from
  another direction.
- A fetch holding no Slot binds to no proxy, so every probe picked whichever
  lane was least loaded at that instant. That is the hopping the Partition
  exists to remove, live in the one job that runs unprompted.

So probes are messages on a seventh lane, drained by the same consumer, and the
priority is an *ordering* rather than a number: `LaneScheduler` is already
strict between tiers, and the probe lane comes after the last of them.

**The stated limit, because it is a real one.** Queue priority orders when work
*starts*, not what happens to work already running. A probe in flight when a
sync arrives keeps its Slot. A probe is a single `t.me/<handle>` fetch, so that
window is one request long — which is why the priority-aware semaphore first
proposed was not worth building.
"""

from __future__ import annotations

import ast
import inspect
import pathlib

import pytest
from sqlalchemy import text as sa_text

from app.jobs import discover_probe, sync_queue
from app.services.sync_lanes import (
    DISCOVER_PROBE_LANE,
    DRAIN_ORDER,
    NON_SYNC_LANES,
    TIER_BEST_EFFORT,
    TIER_NORMAL,
    LaneScheduler,
    is_sync_lane,
    lanes_in_tier,
)


def test_the_probe_lane_is_drained_and_is_not_a_sync_lane() -> None:
    assert DISCOVER_PROBE_LANE in DRAIN_ORDER
    assert not is_sync_lane(DISCOVER_PROBE_LANE)
    assert is_sync_lane(lanes_in_tier(TIER_NORMAL)[0])


@pytest.mark.parametrize("tier", [TIER_NORMAL, TIER_BEST_EFFORT])
def test_no_sync_lane_ever_yields_to_a_probe(tier: str) -> None:
    """Every sync lane in every tier, not just the one an example picks."""
    for lane in lanes_in_tier(tier):
        scheduler = LaneScheduler()
        assert scheduler.next_lane({lane, DISCOVER_PROBE_LANE}) == lane


def test_a_probe_is_served_once_the_sync_lanes_are_empty() -> None:
    """The other direction: strictly-after must not mean never."""
    scheduler = LaneScheduler()

    assert scheduler.next_lane({DISCOVER_PROBE_LANE}) == DISCOVER_PROBE_LANE


def test_a_long_run_of_probes_does_not_bank_credit() -> None:
    """The unweighted pass must not feed `LaneScheduler`'s credit ledger.

    `_weighted_pick` reads `BUDGET_WEIGHTS[lane_budget(lane)]`, which raises for
    a lane with no Budget. Routing the probe lane through it would take the
    drain down the first time nothing else had work — an exception in the one
    path that only runs when the deployment is idle.
    """
    scheduler = LaneScheduler()
    for _ in range(20):
        assert scheduler.next_lane({DISCOVER_PROBE_LANE}) == DISCOVER_PROBE_LANE

    # And the sync lanes are still weighted as they were.
    single, bulk, auto = lanes_in_tier(TIER_NORMAL)
    picks = [scheduler.next_lane({single, bulk, auto}) for _ in range(6)]
    assert picks.count(single) == 3
    assert picks.count(bulk) == 2
    assert picks.count(auto) == 1


def test_the_sweep_no_longer_fetches_anything_itself() -> None:
    """From the AST: a semaphore added back beside the enqueue would leave
    every ordering test above green while re-creating the second budget."""
    tree = ast.parse(pathlib.Path(inspect.getfile(discover_probe)).read_text())
    sweep = next(
        node
        for node in ast.walk(tree)
        if isinstance(node, ast.AsyncFunctionDef)
        and node.name == "run_discover_probe_sweep"
    )
    called = {
        node.func.attr
        for node in ast.walk(sweep)
        if isinstance(node, ast.Call) and isinstance(node.func, ast.Attribute)
    } | {
        node.func.id
        for node in ast.walk(sweep)
        if isinstance(node, ast.Call) and isinstance(node.func, ast.Name)
    }

    assert "Semaphore" not in called, (
        "the sweep gates its own concurrency again; that is a scraping budget "
        "the Partition does not know about"
    )
    assert "_probe_one" not in called, "the sweep fetches inline again"
    assert "enqueue_discover_probes" in called


def test_a_probe_is_charged_to_nobody() -> None:
    """Ticket 23 left probes uncharged because `DiscoverHandleProbe` is
    corpus-scoped: billing one account for deployment-wide work is exactly what
    the three Budgets exist to prevent. Putting them on a lane must not have
    quietly opened a meter around them."""
    source = inspect.getsource(sync_queue._process_probe_message)

    assert "metered" not in source and "charge_sync_job" not in source, (
        "a probe now charges somebody's ledger for work nobody asked for"
    )


def test_the_probe_lane_carries_no_budget_and_says_why() -> None:
    reason = NON_SYNC_LANES[DISCOVER_PROBE_LANE]

    assert "charged to nobody" in reason
    assert "no sync lane has work" in reason


def test_the_consumer_dispatches_on_the_lane_and_not_on_a_payload_field() -> None:
    """D12. A `kind` field in the message would be a second source of truth
    that can disagree with the lane it arrived on — silently, since both
    answers name a real handler."""
    source = inspect.getsource(sync_queue._handle_one_inner)

    assert "is_sync_lane(lane)" in source
    assert '"kind"' not in source


# --- the drain, not the scheduler ----------------------------------------


def test_a_probe_drains_through_the_real_loop(monkeypatch: pytest.MonkeyPatch) -> None:
    """**The test that was missing**, and the reason the lane shipped dead.

    Everything above drives `LaneScheduler.next_lane` with a hand-built
    `available` set, so it asserts the ordering *policy* while saying nothing
    about whether the lane is ever offered. It was not: `_LaneBuffers` walked
    `lanes_in_tier(tier)`, the probe lane belongs to no tier, and so the sweep
    enqueued a batch every tick that nothing ever read — the queue growing
    without bound while no handle got a verdict and every dequeue lease lapsed
    into a duplicate.

    Caught in review. This goes through `drain_sync_lanes`.
    """
    import asyncio

    from sqlmodel import Session

    from app.core.db import engine
    from app.jobs import sync_queue
    from app.services import pgmq
    from app.services.proxy_pool import ProxyWorkerPool
    from tests.utils.partition import direct_partition

    probed: list[str] = []

    async def fake_probe(handle: str) -> str:
        probed.append(handle)
        return "ok"

    monkeypatch.setattr(
        "app.jobs.discover_probe.probe_one_handle", fake_probe, raising=True
    )
    partition = direct_partition(2)

    async def fake_partition() -> ProxyWorkerPool:
        return partition

    monkeypatch.setattr(sync_queue, "get_partition", fake_partition)

    with Session(engine) as session:
        pgmq.send(session, DISCOVER_PROBE_LANE, {"handle": "drained_me"})
        session.commit()

    asyncio.run(asyncio.wait_for(sync_queue.drain_sync_lanes(), timeout=30))

    assert probed == ["drained_me"], (
        "the probe lane was never read; it is enqueued onto and drained by "
        "nothing, so handles pile up and no verdict is ever recorded"
    )

    with Session(engine) as session:
        left = session.execute(
            sa_text(f'SELECT count(*) FROM pgmq."q_{DISCOVER_PROBE_LANE}"')
        ).scalar_one()
    assert left == 0, "the probe message was read but never archived"


def test_a_sync_message_is_drained_before_a_probe(
    monkeypatch: pytest.MonkeyPatch,
) -> None:
    """The ordering, through the drain rather than the scheduler alone.

    One Slot, so the two messages cannot run concurrently and the order is
    observable. The sync lane must go first even though the probe was enqueued
    first.
    """
    import asyncio

    from sqlmodel import Session

    from app.core.db import engine
    from app.jobs import sync_queue
    from app.services import pgmq
    from app.services.proxy_pool import ProxyWorkerPool
    from app.services.sync_lanes import MANUAL_SINGLE_NORMAL_LANE
    from tests.utils.partition import direct_partition

    order: list[str] = []

    async def fake_probe(handle: str) -> str:
        order.append("probe")
        return "ok"

    async def fake_process(msg: pgmq.PgmqMessage, _slot: object) -> None:
        order.append("sync")

    monkeypatch.setattr(
        "app.jobs.discover_probe.probe_one_handle", fake_probe, raising=True
    )
    monkeypatch.setattr(sync_queue, "_process_message", fake_process)
    partition = direct_partition(1)

    async def fake_partition() -> ProxyWorkerPool:
        return partition

    monkeypatch.setattr(sync_queue, "get_partition", fake_partition)

    with Session(engine) as session:
        pgmq.send(session, DISCOVER_PROBE_LANE, {"handle": "second"})
        pgmq.send(
            session, MANUAL_SINGLE_NORMAL_LANE, {"jobId": "j1", "channelId": "c1"}
        )
        session.commit()

    asyncio.run(asyncio.wait_for(sync_queue.drain_sync_lanes(), timeout=30))

    assert order == ["sync", "probe"], (
        f"drained {order}; a probe went before sync work that was queued after it"
    )
