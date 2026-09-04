"""`run_sync_job` walks Channels on Slots out of the one Partition.

The path here is `auto_summary._sync_channels_for_summary`, the one sync that
never enqueues: it needs the walk finished before it can summarise, so putting
it on a lane would invert its control flow. Ticket 10 declined to build the
message shape that would take, and it has been outside the Partition ever
since — which cost two different things (ADR-012).

**It was a second budget.** `run_sync_job` opened an `asyncio.Semaphore` sized
to `syncConcurrency`, and the lane drain held a gate of the same size, so the
worker could run `2N` walks against Telegram while both halves believed they
were enforcing N.

**And its walks hopped proxies.** The semaphore bounded *how many* walks ran
and said nothing about which proxy each used, so `fetch_with_retry` picked the
least-loaded lane per page. One Channel's backward walk spread itself across
the fleet — the exact behaviour `test_proxy_worker_partition.py` asserts is
gone for lane work, live here the whole time because this path never took a
Slot to bind to.
"""

from __future__ import annotations

import ast
import asyncio
import inspect
import pathlib
import uuid
from typing import Any

import pytest

from app.services import proxy_pool, sync_orchestrator
from app.services.proxy_pool import ProxyLane, ProxyWorkerPool, build_workers
from app.services.scraper_jobs import ChannelSyncState, SyncJobState

PROXY_A = "http://a.example:8080"
PROXY_B = "http://b.example:8080"


def _lanes(*specs: tuple[str, int]) -> list[ProxyLane]:
    return [
        ProxyLane(
            url=url,
            max_parallel=slots,
            sem=asyncio.Semaphore(slots),
            client=None,  # type: ignore[arg-type]
        )
        for url, slots in specs
    ]


def _job(channels: int) -> SyncJobState:
    return SyncJobState(
        job_id=f"slots-{uuid.uuid4().hex[:8]}",
        source="test",
        user_id=None,
        sync_mode="auto",  # type: ignore[arg-type]
        channels={
            f"c{i}": ChannelSyncState(channel_id=f"c{i}", channel_name=f"c{i}")
            for i in range(channels)
        },
    )


@pytest.fixture
def _quiet(monkeypatch: pytest.MonkeyPatch) -> None:
    async def noop(*_a: object, **_k: object) -> None:
        return None

    monkeypatch.setattr(sync_orchestrator, "touch_job", noop)
    monkeypatch.setattr(sync_orchestrator, "persist_job", noop)
    monkeypatch.setattr(sync_orchestrator, "deactivate_job", lambda _id: None)
    monkeypatch.setattr(sync_orchestrator, "run_db", lambda *_a, **_k: _noop_sync())


async def _noop_sync() -> None:
    return None


def _run_with_partition(
    monkeypatch: pytest.MonkeyPatch,
    partition: ProxyWorkerPool,
    job: SyncJobState,
    on_channel: Any,
) -> None:
    async def fake_partition() -> ProxyWorkerPool:
        return partition

    monkeypatch.setattr(sync_orchestrator, "get_partition", fake_partition)
    monkeypatch.setattr(sync_orchestrator, "sync_single_channel", on_channel)
    asyncio.run(sync_orchestrator.run_sync_job(job, None))


def test_every_channel_walks_on_a_slot(
    monkeypatch: pytest.MonkeyPatch, _quiet: None
) -> None:
    """A walk with no Slot has no binding, so every page picks a lane afresh."""
    partition = ProxyWorkerPool(build_workers(_lanes((PROXY_A, 1), (PROXY_B, 1))))
    bound: list[str | None] = []

    async def on_channel(
        job: SyncJobState, ch: ChannelSyncState, **_kw: object
    ) -> None:
        bound.append(proxy_pool.bound_proxy_url())
        ch.status = "success"

    _run_with_partition(monkeypatch, partition, _job(4), on_channel)

    assert len(bound) == 4
    assert all(url in (PROXY_A, PROXY_B) for url in bound), (
        f"a Channel walked with no proxy bound ({bound}); every page of it "
        "picks the least-loaded lane afresh, which is the hopping the "
        "partition exists to remove"
    )


def test_the_partition_is_the_only_budget(
    monkeypatch: pytest.MonkeyPatch, _quiet: None
) -> None:
    """Two Slots means two walks at a time, whatever `syncConcurrency` says.

    The `2N` over-count, asserted from the side that can see it: this job's
    own limit is now the Partition's width and not a number of its own.
    """
    partition = ProxyWorkerPool(build_workers(_lanes((PROXY_A, 1), (PROXY_B, 1))))
    peak = 0
    live = 0

    async def on_channel(
        job: SyncJobState, ch: ChannelSyncState, **_kw: object
    ) -> None:
        nonlocal peak, live
        live += 1
        peak = max(peak, live)
        await asyncio.sleep(0.02)
        live -= 1
        ch.status = "success"

    _run_with_partition(monkeypatch, partition, _job(6), on_channel)

    assert peak == 2, (
        f"{peak} walks ran at once against a two-slot partition; the job is "
        "sizing its own budget again"
    )


def test_a_slot_is_given_back_when_a_channel_raises(
    monkeypatch: pytest.MonkeyPatch, _quiet: None
) -> None:
    """A leaked Slot is invisible: capacity drops by one, nothing errors, and
    the deployment is slower for the life of the process."""
    partition = ProxyWorkerPool(build_workers(_lanes((PROXY_A, 2))))

    async def on_channel(
        job: SyncJobState, ch: ChannelSyncState, **_kw: object
    ) -> None:
        raise RuntimeError("channel exploded")

    with pytest.raises(RuntimeError):
        _run_with_partition(monkeypatch, partition, _job(2), on_channel)

    assert not any(w.busy for w in partition.workers), (
        "a Channel that raised kept its Slot; the partition is permanently "
        "narrower and nothing says so"
    )


def test_the_job_never_sizes_a_semaphore_of_its_own() -> None:
    """From the AST, because the failure this prevents is *additive*: a
    semaphore added beside the Slot acquire would leave every test above green
    while re-creating the double count."""
    tree = ast.parse(pathlib.Path(inspect.getfile(sync_orchestrator)).read_text())
    fn = next(
        node
        for node in ast.walk(tree)
        if isinstance(node, ast.AsyncFunctionDef) and node.name == "run_sync_job"
    )
    names = {
        node.func.attr
        for node in ast.walk(fn)
        if isinstance(node, ast.Call) and isinstance(node.func, ast.Attribute)
    }

    assert "Semaphore" not in names, (
        "`run_sync_job` opens a concurrency gate of its own beside the "
        "partition; two answers to how many Channels may run at once diverge "
        "the moment a caller consults the wrong one"
    )


def test_the_legacy_whole_job_path_is_gone() -> None:
    """`_run_whole_job` ran a job-shaped message under one binding while
    `run_sync_job` opened a full second budget inside it. The staging check in
    `docs/proxy-binding-seam-plan.md` D4 is what cleared it for deletion."""
    from app.jobs import sync_queue

    assert not hasattr(sync_queue, "_run_whole_job")

    tree = ast.parse(pathlib.Path(inspect.getfile(sync_queue)).read_text())
    called = {
        node.func.id
        for node in ast.walk(tree)
        if isinstance(node, ast.Call) and isinstance(node.func, ast.Name)
    }
    assert "run_sync_job" not in called, (
        "the queue consumer calls `run_sync_job` again, so a message can run a "
        "whole job inside one Slot while that call opens a budget of its own"
    )
