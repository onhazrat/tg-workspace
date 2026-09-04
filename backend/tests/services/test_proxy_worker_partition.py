"""One worker per proxy, and the binding that makes it mean anything.

Ticket 13, `docs/one-worker-per-proxy-plan.md`. Four checkboxes, and the first
three are behavioural rather than structural — a guard that only asserted the
partition *exists* would pass against a partition nobody dispatches through.

The fourth (the worker-count guard) lives in
`tests/deployment/test_worker_count.py`, with the other reasons the sync tier
is pinned to one replica.

**Every guard here was mutation-tested.** Ticket 12 shipped two concurrency
guards that could not fail — one asserted every account was *eventually*
served, which is true even with a broken window; one had nothing competing for
the permit, so the waiter re-acquired instantly. Both were concurrency guards,
which is all of this file. The mutation each guard was watched failing against
is named in its docstring.
"""

from __future__ import annotations

import asyncio
from collections.abc import Iterator
from typing import Any

import pytest
from sqlmodel import Session

from app.core.db import engine
from app.jobs import sync_queue
from app.services import pgmq, proxy_pool
from app.services.network_settings import DIRECT_EGRESS_KEY
from app.services.proxy_pool import (
    ProxyWorkerPool,
    bound_proxy_url,
    bound_to,
    build_workers,
)
from app.services.sync_lanes import MANUAL_SINGLE_NORMAL_LANE
from tests.utils.partition import direct_partition

PROXY_A = "http://a.example:8080"
PROXY_B = "http://b.example:8080"
PROXY_C = "http://c.example:8080"


@pytest.fixture(autouse=True)
def _clean_pool() -> Iterator[None]:
    proxy_pool.reset_worker_partition_for_tests()
    yield
    proxy_pool.reset_worker_partition_for_tests()


def _lanes(*specs: tuple[str, int]) -> list[proxy_pool.ProxyLane]:
    """Lanes without the httpx clients — nothing here makes a request."""
    return [
        proxy_pool.ProxyLane(
            url=url,
            max_parallel=slots,
            sem=asyncio.Semaphore(slots),
            client=None,  # type: ignore[arg-type]
        )
        for url, slots in specs
    ]


# --- checkbox 1: worker count derives from proxy count -------------------


def test_one_worker_per_proxy_when_every_proxy_has_one_slot() -> None:
    workers = build_workers(_lanes((PROXY_A, 1), (PROXY_B, 1), (PROXY_C, 1)))

    assert [w.proxy_url for w in workers] == [PROXY_A, PROXY_B, PROXY_C], (
        "the partition is not one worker per proxy, so capacity no longer "
        "reflects the proxies available"
    )


def test_a_proxy_with_more_slots_gets_more_workers() -> None:
    workers = build_workers(_lanes((PROXY_A, 3), (PROXY_B, 1)))

    counts = dict.fromkeys((PROXY_A, PROXY_B), 0)
    for worker in workers:
        assert worker.proxy_url is not None
        counts[worker.proxy_url] += 1

    assert counts == {PROXY_A: 3, PROXY_B: 1}
    assert len(workers) == 4, "the worker count stopped deriving from the slots"


def test_the_first_workers_dealt_land_on_distinct_proxies() -> None:
    """The dealing order still matters, and ADR-012's plan said it would not.

    D2 reasoned that round-robin existed only to spread a *truncated* list, so
    removing `syncConcurrency` made it dead. It does more than that.
    `ProxyWorkerPool._take_free` hands out the first idle worker in list order,
    so with lane-by-lane dealing the first three concurrent walks on a fleet of
    four-slot proxies all go down proxy A while B and C sit idle — the
    concentration this partition exists to remove, reintroduced by the ordering
    of a loop.

    **The mutation:** deal lane by lane (`for lane: for _ in range(slots)`),
    which is the obvious implementation. Watched failing.

    At the default of one slot per proxy the two orderings are identical, which
    is exactly why deleting it would have looked safe and shown up only on the
    deployments that had tuned their slots up.
    """
    workers = build_workers(_lanes((PROXY_A, 4), (PROXY_B, 4), (PROXY_C, 4)))

    assert len(workers) == 12, "the worker count stopped deriving from the slots"
    assert {w.proxy_url for w in workers[:3]} == {PROXY_A, PROXY_B, PROXY_C}, (
        f"the first three workers are {[w.proxy_url for w in workers[:3]]} — "
        "dealt lane by lane, so the first concurrent walks stack on one proxy"
    )


def test_nothing_truncates_the_partition_any_more() -> None:
    """`syncConcurrency` is gone and the width is the fleet's capacity.

    The removal is monotonic — `min(3, sum)` becomes `sum` — so one proxy stays
    one and ten proxies go from three to ten. Telegram meters the
    unauthenticated web view by IP, which is why cooldown and pacing are keyed
    per proxy, so a hand-set ceiling of three over ten proxies was throwing
    away most of the fleet.
    """
    import inspect

    assert "max_workers" not in inspect.signature(build_workers).parameters, (
        "`build_workers` takes a cap again; the operator has a second number "
        "that can only disagree with the fleet it is capping"
    )
    lanes = _lanes((PROXY_A, 4), (PROXY_B, 4), (PROXY_C, 2))
    assert len(build_workers(lanes)) == 10


def test_no_proxies_means_one_direct_partition() -> None:
    """A proxy-less deployment is partitioned like any other since ADR-012.

    It used to be the exception: `build_workers([])` returned `syncConcurrency`
    workers with `lane=None`, which fetched through a fresh client each time.
    It gets the synthetic direct Lane now, so **every** Slot has a Lane and the
    seam has no population it does not cover.
    """
    partition = direct_partition(4)

    assert len(partition.workers) == 4
    assert all(w.proxy_url == DIRECT_EGRESS_KEY for w in partition.workers)
    assert build_workers([]) == [], (
        "a lane list with nothing in it produced workers; a Slot without a "
        "Lane is a request that leaves outside the seam"
    )


# --- checkbox 2: a parked worker waits for its proxy to recover ----------


def _pool(*specs: tuple[str, int], cooling: set[str] | None = None) -> ProxyWorkerPool:
    down = cooling if cooling is not None else set()
    return ProxyWorkerPool(
        build_workers(_lanes(*specs)), in_cooldown=lambda url: url in down
    )


def test_a_worker_on_a_cooling_proxy_is_not_handed_out() -> None:
    """**The mutation:** drop the `is_parked` check from `_take_free`, so the
    partition hands out the first idle worker whatever its proxy's state. The
    dispatcher then sends new work down a proxy Telegram has just refused, and
    the cooldown means nothing. Watched failing."""
    pool = _pool((PROXY_A, 1), (PROXY_B, 1), cooling={PROXY_A})

    async def run() -> list[str | None]:
        taken = []
        for _ in range(2):
            worker = await pool.acquire(timeout=0.2)
            taken.append(worker.proxy_url if worker else None)
        return taken

    taken = asyncio.run(run())

    assert taken[0] == PROXY_B, "a worker on a proxy in cooldown took new work"
    assert taken[1] is None, (
        "a second worker was handed out although the only remaining proxy is "
        "in cooldown"
    )


def test_a_parked_worker_is_handed_out_again_once_its_proxy_recovers() -> None:
    """Parking is a wait, not a removal — the other half of the checkbox.

    **The mutation:** evaluate cooldown once when the partition is built rather
    than on every acquire. Everything above still passes; the proxy simply
    never comes back, and capacity silently halves for the lifetime of the
    process. Watched failing.
    """
    cooling = {PROXY_A}
    pool = ProxyWorkerPool(
        build_workers(_lanes((PROXY_A, 1))), in_cooldown=lambda url: url in cooling
    )

    async def run() -> tuple[str | None, str | None]:
        while_cooling = await pool.acquire(timeout=0.2)
        cooling.clear()
        recovered = await pool.acquire(timeout=0.5)
        return (
            while_cooling.proxy_url if while_cooling else None,
            recovered.proxy_url if recovered else None,
        )

    while_cooling, recovered = asyncio.run(run())

    assert while_cooling is None, "the parked worker took work while cooling"
    assert recovered == PROXY_A, (
        "the worker never came back after its proxy recovered — parking became "
        "a permanent loss of capacity"
    )


def test_a_release_wakes_a_waiter_without_waiting_out_the_poll() -> None:
    """A freed worker is taken at once, not at the next poll.

    **The mutation:** drop the `self._wake.set()` from `release()`, leaving the
    poll as the only way a waiter notices. Nothing fails and nothing is lost —
    every dispatch just waits up to `WORKER_WAKE_POLL_SECONDS` for a worker
    that is already free, which reads as the queue being slow rather than as a
    bug. Watched failing (0.25s against the 0.05s asserted here).

    An earlier version of this docstring claimed the *clear-then-check* order
    in `acquire` was what this caught. It is not: `_take_free` and
    `_wake.clear()` have no `await` between them, so on a single-threaded event
    loop no `release()` can interleave there and the order cannot be observed.
    The order is kept because it is the correct shape if that ever stops being
    true, but a guard cannot assert it and this one does not pretend to.
    """
    pool = _pool((PROXY_A, 1))

    async def run() -> float:
        first = await pool.acquire(timeout=0.2)
        assert first is not None

        async def release_soon() -> None:
            await asyncio.sleep(0.01)
            pool.release(first)

        asyncio.create_task(release_soon())
        started = asyncio.get_running_loop().time()
        second = await pool.acquire(timeout=2)
        assert second is not None
        return asyncio.get_running_loop().time() - started

    assert asyncio.run(run()) < 0.05, (
        "a released worker took a poll interval to be noticed; the wake event "
        "is being cleared after the check rather than before it"
    )


def test_a_drain_with_every_proxy_parked_returns_instead_of_blocking(
    monkeypatch: pytest.MonkeyPatch,
) -> None:
    """The other half of "a parked worker must not look like a hung one".

    **The mutation:** acquire without a timeout, which is what the drain did
    before this ticket (`await gate.acquire()` on a semaphore that always had
    a permit coming). With every worker parked no release is ever coming, so
    the drain blocks for the life of the process — and because the 30-second
    sweep is an APScheduler job with `max_instances=1`, every later tick is
    skipped too. Syncing stops, nothing is in error, and the worker looks
    busy. Watched failing (this test times out).

    The message must survive: a parked drain has to leave its work queued and
    visible, not consume it.
    """
    parked = ProxyWorkerPool(
        build_workers(_lanes((PROXY_A, 1), (PROXY_B, 1))),
        in_cooldown=lambda _url: True,
    )

    async def fake_partition() -> ProxyWorkerPool:
        return parked

    monkeypatch.setattr(sync_queue, "get_partition", fake_partition)

    with Session(engine) as session:
        pgmq.send(
            session, MANUAL_SINGLE_NORMAL_LANE, {"jobId": "parked", "channelId": "c"}
        )
        session.commit()

    async def run() -> dict[str, int]:
        return await asyncio.wait_for(sync_queue.drain_sync_lanes(), timeout=30)

    result = asyncio.run(run())

    assert result == {"processed": 0, "exhausted": 0}
    with Session(engine) as session:
        still_there = pgmq.read(
            session, MANUAL_SINGLE_NORMAL_LANE, vt_seconds=0, qty=10
        )
        assert len(still_there) == 1, (
            "a drain with every proxy parked consumed its message instead of "
            "leaving it queued for the next sweep"
        )
        for msg in still_there:
            pgmq.delete(session, MANUAL_SINGLE_NORMAL_LANE, msg.msg_id)
        session.commit()


def test_a_saturated_bound_lane_fails_rather_than_waiting_for_ever() -> None:
    """`hold()` is bounded, like the free-choice `acquire()` it stands in for.

    A bound message shares its lane with everything else pointed at that proxy
    — at the default of one slot, `_cache_thumbs_for_posts` alone queues ~20
    thumbnail fetches per page behind the next page fetch. **The mutation:**
    drop the `wait_for` and await the semaphore directly. A proxy that accepts
    connections and then stalls holds the permit for a minute at a time, and
    every queued bound fetch waits with nothing in the log and no error path —
    the message sits until its ~2.4-hour visibility timeout. Watched failing
    (the test hangs).
    """
    lane = _lanes((PROXY_A, 1))[0]
    pool = proxy_pool.ProxyPoolManager()

    async def run() -> str:
        await lane.sem.acquire()  # somebody else is holding the only slot
        try:
            async with pool.hold(lane):
                return "acquired"
        except proxy_pool.ProxyPoolExhausted as exc:
            return str(exc)

    monkey = proxy_pool.ACQUIRE_TIMEOUT_SECONDS
    proxy_pool.ACQUIRE_TIMEOUT_SECONDS = 0.1
    try:
        outcome = asyncio.run(asyncio.wait_for(run(), timeout=10))
    finally:
        proxy_pool.ACQUIRE_TIMEOUT_SECONDS = monkey

    assert PROXY_A in outcome and "Timed out" in outcome, (
        f"a saturated bound lane answered {outcome!r} instead of giving up; an "
        "unbounded wait there stalls the message toward its visibility timeout"
    )


def test_no_capacity_is_reported_as_busy_or_parked_and_not_guessed() -> None:
    """The diagnostic must not call a busy partition a parked one.

    **The mutation:** report every "no worker available" as "all N parked on
    proxies in cooldown", which is what the first cut did. `all_busy()` returns
    False whenever a worker is idle-but-parked, so a partition with one cooling
    proxy and the rest held by another drain reaches that branch and tells the
    operator nothing is scraping while two workers are mid-backfill. That is
    the parked-versus-hung confusion this ticket exists to end, restated one
    level up. Watched failing.

    A worker is **busy and parked at once** in the ordinary case, not a
    contrived one: the fetch that failed is what armed its proxy's cooldown, so
    the walk is still running through a proxy already marked bad. Counting it
    as parked reports zero workers scraping while one demonstrably is. An
    earlier version of this test parked only an *idle* worker and could not
    tell the two implementations apart at all.
    """
    cooling: set[str] = set()
    pool = ProxyWorkerPool(
        build_workers(_lanes((PROXY_A, 1), (PROXY_B, 1), (PROXY_C, 1))),
        in_cooldown=lambda url: url in cooling,
    )

    async def run() -> tuple[int, int, int]:
        working = await pool.acquire(timeout=0.2)
        assert working is not None and working.proxy_url == PROXY_A
        # Its own failing fetch cools proxy A while the walk carries on, and
        # proxy C was already down.
        cooling.update({PROXY_A, PROXY_C})
        return pool.capacity_report()

    busy, parked, total = asyncio.run(run())

    assert (busy, parked, total) == (1, 1, 3), (
        f"the partition reported {busy} busy / {parked} parked of {total}; a "
        "worker that is scraping must never be counted as parked"
    )


def test_the_parked_capacity_line_counts_workers_not_proxies(
    caplog: pytest.LogCaptureFixture,
) -> None:
    """The one line whose whole job is to make remaining capacity honest.

    **The mutation:** subtract `len(now_parked)` (a count of proxy *URLs*) from
    `len(self.workers)`. With two proxies of four slots each, parking one then
    reports "7 of 8" where the truth is 4 of 8. Watched failing.
    """
    cooling: set[str] = set()
    pool = ProxyWorkerPool(
        build_workers(_lanes((PROXY_A, 4), (PROXY_B, 4))),
        in_cooldown=lambda url: url in cooling,
    )

    async def run() -> None:
        await pool.acquire(timeout=0.2)
        cooling.add(PROXY_A)
        with caplog.at_level("WARNING"):
            await pool.acquire(timeout=0.2)

    asyncio.run(run())

    parked_lines = [
        r.getMessage() for r in caplog.records if "parked" in r.getMessage()
    ]
    assert parked_lines, "parking a proxy logged nothing"
    assert "capacity is now 4 of 8" in parked_lines[0], (
        f"the parked line said {parked_lines[0]!r}; it is counting proxies "
        "where it should count workers"
    )


def test_the_partition_reports_which_workers_are_parked() -> None:
    """A parked worker must be distinguishable from a dead one.

    711 job rows sat in `running` since June because nothing here said which.
    """
    pool = _pool((PROXY_A, 1), (PROXY_B, 1), cooling={PROXY_A})

    states = {entry["proxyUrl"]: entry["state"] for entry in pool.snapshot()}

    assert states == {PROXY_A: "parked", PROXY_B: "idle"}
    assert [w.proxy_url for w in pool.parked_workers()] == [PROXY_A]


# --- checkbox 3: partitioning replaces the shared gate -------------------


def test_a_bound_worker_fetches_through_its_own_proxy_and_no_other() -> None:
    """The binding is what turns a partition into a rate at each proxy.

    **The mutation:** delete the `bound_proxy_url()` branch in
    `network._proxy_acquire`, leaving the least-loaded round-robin choice. The
    fetch then goes out whichever proxy happens to be free, the partition
    becomes decoration, and nothing else in the suite notices. Watched failing.
    """
    from app.services import network

    pool = proxy_pool.ProxyPoolManager()
    pool.configure([PROXY_A, PROXY_B], 1, {})
    lane_b = pool.lane_by_url(PROXY_B)
    assert lane_b is not None

    async def _fake_ensure(*_a: Any, **_k: Any) -> proxy_pool.ProxyPoolManager:
        return pool

    async def run(binding: Any) -> str:
        with bound_to(binding):
            async with network._proxy_acquire(
                [PROXY_A, PROXY_B], set(), proxy_concurrency=(1, {})
            ) as lane:
                return str(lane.url)

    original = proxy_pool.ensure_pool_configured
    proxy_pool.ensure_pool_configured = _fake_ensure  # type: ignore[assignment]
    try:
        # Proxy A is entirely free and is what free choice would pick first.
        chosen = asyncio.run(run(_Binding(PROXY_B)))
    finally:
        proxy_pool.ensure_pool_configured = original  # type: ignore[assignment]

    assert chosen == PROXY_B, (
        f"a bound worker fetched through {chosen} instead of its own proxy"
    )


class _Binding:
    """The `ProxyBinding` shape, standing in for a `SyncSlot`."""

    def __init__(self, url: str | None) -> None:
        self._url = url

    @property
    def proxy_url(self) -> str | None:
        return self._url


def test_two_concurrent_messages_do_not_see_each_others_proxy() -> None:
    """The binding is per task, which is the whole reason it is a contextvar.

    **The mutation:** hold the bound proxy in a module-level global with
    save/restore around the block. That is the version a reader would write,
    and it passes every sequential test in this file.

    **The overlap is what separates them, and it has to be the right way
    round.** The first draft had the *second* task finish first, so its
    `finally` restored the first task's value before the first task read — and
    a global passed. The first task must read while the second is still inside
    its block: the global then answers with the second task's proxy, which is
    two workers sharing an egress, under concurrency only, exactly the failure
    that never reproduces in a single-worker test. Watched failing.
    """

    async def run() -> list[str | None]:
        seen: dict[str, str | None] = {}

        async def one(name: str, url: str, delay: float) -> None:
            with bound_to(_Binding(url)):
                await asyncio.sleep(delay)
                seen[name] = bound_proxy_url()

        await asyncio.gather(
            # `first` reads at 0.05 while `second` still holds its binding
            # until 0.20.
            one("first", PROXY_A, 0.05),
            one("second", PROXY_B, 0.20),
        )
        return [seen["first"], seen["second"]]

    assert asyncio.run(run()) == [PROXY_A, PROXY_B], (
        "one task's proxy binding leaked into another's — the binding is not "
        "per task, so two workers share an egress under concurrency only"
    )


def test_the_binding_follows_a_slot_that_swapped_workers(
    monkeypatch: pytest.MonkeyPatch,
) -> None:
    """A coalesced waiter puts its worker down and may take a different one.

    **The mutation:** bind `slot.worker` instead of `slot` in `_handle_one`.
    The walk then keeps fetching through the proxy it was given *before* the
    wait, which by then belongs to another message — two messages on one
    proxy, with the partition believing each has its own. Watched failing.

    Driven through `_handle_one` rather than by calling `bound_to` directly.
    The first draft did the latter and could not fail: it exercised the
    binding mechanism while asserting nothing about the call site the mutation
    changes, which is the only place the choice is actually made.
    """
    pool = _pool((PROXY_A, 1), (PROXY_B, 1))
    seen: dict[str, str | None] = {}

    async def fake_process(msg: Any, slot: sync_queue.SyncSlot) -> None:
        seen["before"] = bound_proxy_url()
        # Somebody else takes proxy A while this slot is put down, so the
        # re-acquire can only come back with proxy B — as it does for a
        # coalesced waiter that rode another runner's sync.
        async with slot.released():
            stolen = await pool.acquire(timeout=0.2)
            assert stolen is not None and stolen.proxy_url == PROXY_A
        seen["after"] = bound_proxy_url()

    monkeypatch.setattr(sync_queue, "_process_message", fake_process)
    monkeypatch.setattr(sync_queue, "_archive", lambda *_a, **_k: None)

    async def run() -> None:
        first = await pool.acquire(timeout=0.2)
        assert first is not None and first.proxy_url == PROXY_A
        slot = sync_queue.SyncSlot.holding(pool, first)
        await sync_queue._handle_one(
            "manual_single_normal",
            pgmq.PgmqMessage(msg_id=1, read_ct=1, message={"jobId": "j"}),
            slot,
        )

    asyncio.run(run())

    assert seen["before"] == PROXY_A
    assert seen["after"] == PROXY_B, (
        f"the binding still reports {seen['after']} after the slot swapped "
        "workers; a captured worker leaves two messages on one proxy"
    )


def test_a_bound_worker_does_not_hop_when_its_proxy_starts_failing() -> None:
    """No fallback, deliberately — see the plan's "a bound worker does not hop".

    Hopping moves a dead proxy's load onto the healthy ones at the moment
    Telegram is already pushing back, which is how one rate-limited egress
    becomes a rate-limited set. **The mutation:** make the bound branch fall
    through to `pool.acquire()` when the bound lane is in cooldown. Watched
    failing.
    """
    from app.services import network

    pool = proxy_pool.ProxyPoolManager()
    pool.configure([PROXY_A, PROXY_B], 1, {})

    async def _fake_ensure(*_a: Any, **_k: Any) -> proxy_pool.ProxyPoolManager:
        return pool

    original_ensure = proxy_pool.ensure_pool_configured
    proxy_pool.ensure_pool_configured = _fake_ensure  # type: ignore[assignment]
    # Proxy B is in cooldown; free choice would refuse it and pick A.
    original_cooldown = pool._proxy_in_cooldown
    pool._proxy_in_cooldown = lambda url: url == PROXY_B  # type: ignore[method-assign]

    async def run() -> str:
        with bound_to(_Binding(PROXY_B)):
            async with network._proxy_acquire(
                [PROXY_A, PROXY_B], set(), proxy_concurrency=(1, {})
            ) as lane:
                return str(lane.url)

    try:
        chosen = asyncio.run(run())
    finally:
        proxy_pool.ensure_pool_configured = original_ensure  # type: ignore[assignment]
        pool._proxy_in_cooldown = original_cooldown  # type: ignore[method-assign]

    assert chosen == PROXY_B, (
        f"a bound walk hopped to {chosen} when its own proxy started failing; "
        "the partition stops bounding the rate at either proxy the moment it "
        "is allowed to redistribute"
    )


def test_an_unbound_caller_still_chooses_freely() -> None:
    """The binding must not leak into publish, thumbnails or the probe sweep.

    Those have no worker and no partition — they are ordinary proxied traffic,
    and the lane semaphores are what bound them. A binding that applied to
    everything would serialise them behind whichever proxy was bound last.
    """
    from app.services import network

    pool = proxy_pool.ProxyPoolManager()
    pool.configure([PROXY_A], 1, {})

    async def _fake_ensure(*_a: Any, **_k: Any) -> proxy_pool.ProxyPoolManager:
        return pool

    original = proxy_pool.ensure_pool_configured
    proxy_pool.ensure_pool_configured = _fake_ensure  # type: ignore[assignment]

    async def run() -> str:
        async with network._proxy_acquire(
            [PROXY_A], set(), proxy_concurrency=(1, {})
        ) as lane:
            return str(lane.url)

    try:
        assert asyncio.run(run()) == PROXY_A
    finally:
        proxy_pool.ensure_pool_configured = original  # type: ignore[assignment]

    assert bound_proxy_url() is None, "a binding outlived the block that set it"


def test_a_bound_request_still_takes_its_lanes_permit() -> None:
    """The worker owns the lane; it does not get to ignore the lane's limit.

    A bound path that skipped the semaphore would let the partition's workers
    and the deployment's other proxied traffic exceed `maxParallel` together —
    the per-proxy rate limit gone, by the change that was supposed to make it
    predictable.
    """
    lane = _lanes((PROXY_A, 1))[0]
    pool = proxy_pool.ProxyPoolManager()

    async def run() -> tuple[int, bool]:
        async with pool.hold(lane):
            in_use = lane.in_use
            second_blocked = lane.sem.locked()
        return in_use, second_blocked

    in_use, second_blocked = asyncio.run(run())

    assert in_use == 1, "holding a lane did not count against its capacity"
    assert second_blocked, "a second request on a one-slot lane was not blocked"
    assert lane.in_use == 0, "the lane permit was not returned"
