"""Per-proxy asyncio lane pool for gated HTTP concurrency, and the partition
of scraping workers built on top of it (ticket 13).

Two things live here and they answer different questions.

A **lane** is a proxy: one long-lived `httpx.AsyncClient`, and a semaphore
bounding how many requests may be in flight through that proxy *from anything*
— a channel walk, a bot publish, a thumbnail, a Discover probe. That is a rate
limit at the egress and it applies to every caller.

A **worker** is one scraping slot bound to one lane for the whole of one queued
message (`docs/one-worker-per-proxy-plan.md`). Before ticket 13 the queue
consumer held a single `asyncio.Semaphore` sized `min(syncConcurrency, total
lane slots)` and every HTTP attempt underneath picked whichever lane was least
loaded at that instant — so one Channel's backward walk hopped proxies page by
page and a burst of syncs piled onto whichever lane happened to be free. The
worker list replaces that gate with a partition: as many workers as there are
lane slots, dealt round-robin across lanes, each pinned to its lane.

**The worker owns the lane; it does not hold the lane's permit.** Pinning is
what makes the rate at one proxy predictable, but holding that proxy's
semaphore for a whole backward walk would park every *other* kind of proxied
traffic behind it — a five-minute backfill would make thumbnails and bot
publishes wait, and `acquire()` starts raising `ProxyPoolExhausted` after two
minutes. So the permit is still taken per request, on the bound lane instead of
a chosen one. What the worker holds for the whole message is the lane's client,
which is the connection reuse the ticket asks for.
"""

from __future__ import annotations

import asyncio
import contextlib
import contextvars
import logging
import time
from collections.abc import AsyncIterator, Callable, Iterator
from contextlib import asynccontextmanager, contextmanager
from dataclasses import dataclass, field
from typing import Any, Protocol

import httpx
from sqlmodel import Session

from app.core.config import settings
from app.core.db import engine
from app.services.network_settings import (
    DIRECT_EGRESS_KEY,
    clamp_proxy_concurrency,
    load_network_settings,
    normalize_proxy_url,
    resolve_proxies,
    resolve_proxy_concurrency,
)

logger = logging.getLogger(__name__)

PROXY_SLOTS_MIN = 1
PROXY_SLOTS_MAX = 20
ACQUIRE_TIMEOUT_SECONDS = 120.0

#: How long `ProxyWorkerPool.acquire` sleeps before re-checking whether a
#: parked worker's proxy has recovered. A release wakes it immediately; this
#: only bounds how long a *cooldown lapsing* takes to notice, which nothing
#: signals.
WORKER_WAKE_POLL_SECONDS = 0.25


class ProxyPoolExhausted(Exception):
    """Raised when no proxy lane slot is available within the wait timeout."""


def clamp_proxy_slots(value: int) -> int:
    return clamp_proxy_concurrency(value)


def build_lane_client(proxy_url: str, max_parallel: int) -> httpx.AsyncClient:
    """One long-lived httpx client per lane (connection reuse).

    `DIRECT_EGRESS_KEY` is not a proxy URL and gets a client with no proxy set.
    That Lane is otherwise an ordinary one, which is the point of synthesising
    it: a proxy-less deployment reuses connections and obeys a width the same
    way a proxied one does, instead of building a fresh client per attempt.
    """
    slots = clamp_proxy_slots(max_parallel)
    return httpx.AsyncClient(
        proxy=None
        if proxy_url == DIRECT_EGRESS_KEY
        else normalize_proxy_url(proxy_url),
        timeout=settings.NETWORK_FETCH_TIMEOUT_SECONDS,
        follow_redirects=True,
        limits=httpx.Limits(
            max_connections=slots,
            max_keepalive_connections=slots,
        ),
    )


@dataclass
class ProxyLane:
    url: str
    max_parallel: int
    sem: asyncio.Semaphore
    client: httpx.AsyncClient
    in_use: int = 0


class ProxyPoolManager:
    def __init__(self) -> None:
        self._lanes: dict[str, ProxyLane] = {}
        self._direct: ProxyLane | None = None
        self._rr_counter = 0
        self._configured_default = 1
        self._configured_overrides: dict[str, int] = {}
        self._pending_closes: list[httpx.AsyncClient] = []

    def _queue_client_close(self, client: httpx.AsyncClient) -> None:
        self._pending_closes.append(client)

    async def flush_pending_closes(self) -> None:
        pending = self._pending_closes
        self._pending_closes = []
        for client in pending:
            await client.aclose()

    def configure(
        self,
        proxies: list[str],
        default_slots: int,
        overrides: dict[str, int],
    ) -> None:
        default_slots = clamp_proxy_slots(default_slots)
        norm_overrides = {
            normalize_proxy_url(k): clamp_proxy_slots(v) for k, v in overrides.items()
        }
        normalized = [normalize_proxy_url(p) for p in proxies]

        if (
            tuple(self._lanes.keys()) == tuple(normalized)
            and self._configured_default == default_slots
            and self._configured_overrides == norm_overrides
        ):
            return

        previous = self._lanes
        new_lanes: dict[str, ProxyLane] = {}
        for url in normalized:
            slots = norm_overrides.get(url, default_slots)
            existing = previous.get(url)
            if existing and existing.max_parallel == slots:
                new_lanes[url] = existing
            else:
                if existing is not None:
                    self._queue_client_close(existing.client)
                new_lanes[url] = ProxyLane(
                    url=url,
                    max_parallel=slots,
                    sem=asyncio.Semaphore(slots),
                    client=build_lane_client(url, slots),
                )

        for url, lane in previous.items():
            if url not in new_lanes:
                self._queue_client_close(lane.client)

        self._lanes = new_lanes
        self._configured_default = default_slots
        self._configured_overrides = norm_overrides

    def _proxy_in_cooldown(self, url: str) -> bool:
        from app.services.network import proxy_in_cooldown

        return proxy_in_cooldown(url)

    def _rank_lanes(self, exclude: set[str]) -> list[ProxyLane]:
        ranked: list[tuple[int, int, ProxyLane]] = []
        for idx, lane in enumerate(self._lanes.values()):
            if lane.url in exclude or self._proxy_in_cooldown(lane.url):
                continue
            free = lane.max_parallel - lane.in_use
            ranked.append((-free, idx, lane))
        ranked.sort()
        return [lane for _, _, lane in ranked]

    @asynccontextmanager
    async def acquire(
        self, exclude: set[str] | None = None
    ) -> AsyncIterator[ProxyLane]:
        excluded = exclude or set()
        deadline = time.monotonic() + ACQUIRE_TIMEOUT_SECONDS

        while True:
            ranked = self._rank_lanes(excluded)
            if not ranked:
                healthy_any = any(
                    not self._proxy_in_cooldown(lane.url)
                    for lane in self._lanes.values()
                )
                if not healthy_any:
                    raise ProxyPoolExhausted("No healthy proxy lanes available")
                if time.monotonic() >= deadline:
                    raise ProxyPoolExhausted("Timed out waiting for proxy lane slot")
                await asyncio.sleep(0.1)
                continue

            lane = ranked[self._rr_counter % len(ranked)]
            self._rr_counter += 1
            remaining = deadline - time.monotonic()
            if remaining <= 0:
                raise ProxyPoolExhausted("Timed out waiting for proxy lane slot")
            try:
                await asyncio.wait_for(lane.sem.acquire(), timeout=remaining)
            except TimeoutError:
                continue

            lane.in_use += 1
            try:
                yield lane
            finally:
                lane.in_use -= 1
                lane.sem.release()
            return

    def peek_lane_url(self, exclude: set[str] | None = None) -> str | None:
        """Which lane `acquire()` would pick right now, without taking a permit.

        Exists so the adaptive wait can be served *before* the permit rather
        than while holding it (ticket 14). The pace needs to know which egress
        it is pacing, and `acquire()` only reveals that after it has already
        taken the slot — so without this the sleep had to happen inside the
        hold, where it parks every other kind of traffic pointed at that proxy
        and can push a queued thumbnail past `ACQUIRE_TIMEOUT_SECONDS`.

        Advisory, not a reservation. Between this and `acquire()` the ranking
        can change and a different lane can be chosen, in which case the wait
        was served against a neighbouring lane's cursor. That costs one
        mistimed request and nothing else — the alternative, holding the permit
        to make it exact, is the starvation this call exists to remove.
        """
        ranked = self._rank_lanes(exclude or set())
        if not ranked:
            return None
        return ranked[self._rr_counter % len(ranked)].url

    def lane_client(self, proxy_url: str) -> httpx.AsyncClient | None:
        lane = self._lanes.get(normalize_proxy_url(proxy_url))
        return lane.client if lane else None

    def lane_by_url(self, proxy_url: str) -> ProxyLane | None:
        """The live lane for a URL, or None if it is no longer configured.

        A bound worker resolves its lane through this on every request rather
        than holding the object, because `configure()` replaces lanes when an
        operator changes the slot count and the old lane's client is closed on
        the next flush. Holding the object would keep a worker fetching through
        a closed client until its message finished.
        """
        if proxy_url == DIRECT_EGRESS_KEY:
            return self.direct_lane()
        return self._lanes.get(normalize_proxy_url(proxy_url))

    @asynccontextmanager
    async def hold(self, lane: ProxyLane) -> AsyncIterator[ProxyLane]:
        """Take one permit on *this* lane, with no choice about which.

        `acquire()` picks a lane; this is handed one. It is what a bound worker
        uses, so that the per-proxy limit still applies to its requests while
        the dispatch decision has already been made.

        Deliberately **not** cooldown-aware. Cooldown decides where new work is
        *sent* — a walk already in progress stays on its proxy, because moving
        it is the hopping the partition exists to remove.

        **Bounded by the same `ACQUIRE_TIMEOUT_SECONDS` as `acquire()`**, and
        that is not symmetry for its own sake. A bound message shares its lane
        with everything else pointed at that proxy: at the default of one slot,
        `_cache_thumbs_for_posts` alone queues ~20 thumbnail fetches per page
        behind the next page fetch, and a bot publish or an avatar can hold the
        permit first. A proxy that accepts connections and then stalls holds it
        for `NETWORK_FETCH_TIMEOUT_SECONDS` at a time. Unbounded, every one of
        those waits for ever with nothing in the log and no error path — the
        message sits until its ~2.4-hour visibility timeout and is redelivered.
        Bounded, it fails like any other network fault and the retry loop and
        the sync log both get to say so.
        """
        try:
            await asyncio.wait_for(lane.sem.acquire(), ACQUIRE_TIMEOUT_SECONDS)
        except TimeoutError as exc:
            raise ProxyPoolExhausted(
                f"Timed out waiting for a slot on the bound proxy {lane.url}"
            ) from exc
        lane.in_use += 1
        try:
            yield lane
        finally:
            lane.in_use -= 1
            lane.sem.release()

    def direct_lane(self) -> ProxyLane:
        """The Lane for egress that goes out this deployment's own address.

        **A deployment with no proxies still fetches through a Lane**
        (ADR-012). Exempting direct egress would enforce the seam only on the
        deployments that already had egress control, which is the population
        that needs it least; and it left a proxy-less deployment building a
        fresh `httpx.AsyncClient` per attempt, with no connection reuse and no
        bound on how many requests it put through its single address — the
        deployment most likely to be rate limited.

        **Built once and never reconfigured**, which is the whole reason it is
        a field rather than an entry in `_lanes`. `configure()` replaces lanes
        and closes the clients it drops. If the direct Lane lived in `_lanes`,
        one caller resolving "no proxies" and the next resolving the fleet
        would thrash the pool between two shapes, closing each other's live
        clients on every call. Its width is its own setting, because "how hard
        may I lean on my own address" is a different question from "how hard
        may I lean on somebody else's proxy".
        """
        if self._direct is None:
            slots = clamp_proxy_slots(settings.DIRECT_LANE_CONCURRENCY_DEFAULT)
            self._direct = ProxyLane(
                url=DIRECT_EGRESS_KEY,
                max_parallel=slots,
                sem=asyncio.Semaphore(slots),
                client=build_lane_client(DIRECT_EGRESS_KEY, slots),
            )
        return self._direct

    def lanes(self) -> list[ProxyLane]:
        """Every Lane work may be dealt to — the direct one when there are no
        proxies, so `build_workers` sizes the Partition from it either way."""
        return list(self._lanes.values()) or [self.direct_lane()]

    def total_capacity(self) -> int:
        return sum(lane.max_parallel for lane in self.lanes())

    def _pace_ms(self, url: str) -> int:
        from app.services.network import proxy_pace_ms

        return proxy_pace_ms(url)

    def snapshot(self) -> list[dict[str, Any]]:
        """Per-lane state for the operator panel and `/jobs/runtime-config`.

        `paceMs` sits beside `inCooldown` rather than in a telemetry block of
        its own (ticket 14). They are two rungs of one ladder — a widening wait
        and, at the top of it, a parked lane — and an operator reading
        "capacity is 7 of 8" needs both in the same place to tell a deployment
        that is deliberately slow from one that is broken.
        """
        return [
            {
                "proxyUrl": lane.url,
                "maxParallel": lane.max_parallel,
                "inUse": lane.in_use,
                "inCooldown": self._proxy_in_cooldown(lane.url),
                "paceMs": self._pace_ms(lane.url),
            }
            for lane in self._lanes.values()
        ]


_pool = ProxyPoolManager()
_pool_lock = asyncio.Lock()


def get_proxy_pool() -> ProxyPoolManager:
    return _pool


async def ensure_pool_configured(
    proxies: list[str],
    default_slots: int,
    overrides: dict[str, int],
) -> ProxyPoolManager:
    pool = get_proxy_pool()
    async with _pool_lock:
        pool.configure(proxies, default_slots, overrides)
        await pool.flush_pending_closes()
    return pool


def configure_proxy_pool(
    proxies: list[str],
    default_slots: int,
    overrides: dict[str, int],
) -> ProxyPoolManager:
    """Synchronous configure for diagnostics (runtime-config snapshots)."""
    pool = get_proxy_pool()
    pool.configure(proxies, default_slots, overrides)
    return pool


# --------------------------------------------------------------------------
# The worker partition (ticket 13)
# --------------------------------------------------------------------------


@dataclass
class ProxyWorker:
    """One scraping slot, bound to one lane for the whole of one message.

    **`lane` is never None.** It used to be, for the direct-egress case: a
    deployment with no proxies had nothing to partition, so the partition
    degenerated to `syncConcurrency` workers that fetched through a fresh
    client each time. ADR-012 gives that deployment a synthetic direct Lane
    instead, so "a Slot always has a Lane" is now true by construction rather
    than almost-always true with one exception that every reader had to hold.
    """

    index: int
    lane: ProxyLane
    busy: bool = False

    @property
    def proxy_url(self) -> str:
        return self.lane.url


def build_workers(lanes: list[ProxyLane]) -> list[ProxyWorker]:
    """One worker per lane slot, dealt **round-robin across lanes**.

    `max_workers` is gone with `syncConcurrency` (ADR-012 D2). Nothing
    truncates the list any more: the Partition is as wide as the fleet.

    **The round-robin dealing stays, and the plan was wrong to call it dead.**
    D2 reasoned that it existed only to spread a *truncated* list across
    distinct proxies. It does more than that. `ProxyWorkerPool._take_free`
    hands out the first idle worker in list order, so on a deployment whose
    proxies have more than one slot each, filling lane by lane would send the
    first two concurrent walks down proxy A while B sat idle. At the default of
    one slot per proxy the two orderings are identical, which is exactly why
    deleting it would have looked safe and shown up only on the deployments
    that had tuned their slots up.
    """
    workers: list[ProxyWorker] = []
    remaining = {lane.url: lane.max_parallel for lane in lanes}
    while any(count > 0 for count in remaining.values()):
        for lane in lanes:
            if remaining[lane.url] <= 0:
                continue
            remaining[lane.url] -= 1
            workers.append(ProxyWorker(index=len(workers), lane=lane))
    return workers


def _default_in_cooldown(url: str) -> bool:
    from app.services.network import proxy_in_cooldown

    return proxy_in_cooldown(url)


@dataclass
class ProxyWorkerPool:
    """The partition that replaced the queue consumer's one shared semaphore.

    A semaphore of size N answers "may anything start?". This answers "which
    proxy does the thing that starts use?", which is the question the old gate
    could not ask — and it is why the count is not a setting on its own any
    more: it *derives* from the lanes.

    **A parked worker is not a missing one.** Its proxy is in cooldown, so it
    takes no new message until that lapses; the worker stays in the list,
    reports itself as parked, and says so in the log on both transitions. This
    repo has shipped the other version — 711 job rows sat in `running` since
    June because nothing distinguished waiting from dead — and "throughput
    halved and nothing is in error" is precisely the shape that is impossible
    to diagnose after the fact.
    """

    workers: list[ProxyWorker]
    in_cooldown: Callable[[str], bool] = _default_in_cooldown
    _wake: asyncio.Event = field(default_factory=asyncio.Event)
    _parked_urls: set[str] = field(default_factory=set)

    def __len__(self) -> int:
        return len(self.workers)

    def is_parked(self, worker: ProxyWorker) -> bool:
        url = worker.proxy_url
        return url is not None and self.in_cooldown(url)

    def all_busy(self) -> bool:
        """Every worker is running a message right now.

        `drain_sync_lanes` reads this the way it used to read `gate.locked()`:
        a sweep that finds the whole partition busy returns instead of queueing
        behind a drain that will keep going until its lanes are empty.
        """
        return bool(self.workers) and all(worker.busy for worker in self.workers)

    def parked_workers(self) -> list[ProxyWorker]:
        return [w for w in self.workers if self.is_parked(w)]

    def capacity_report(self) -> tuple[int, int, int]:
        """`(busy, parked, total)` right now — the honest breakdown.

        Exists because "no worker was available" has two causes with opposite
        meanings: everything is busy (the deployment is working) and everything
        is parked (every proxy is in cooldown and nothing is being scraped).
        A caller that logs one message for both reports a healthy worker as a
        stalled one, which is the confusion this partition was supposed to end
        rather than restate.

        Busy wins over parked when a worker is both, because a busy worker is
        doing something and that is the more useful thing to know.
        """
        busy = sum(1 for w in self.workers if w.busy)
        parked = sum(1 for w in self.workers if not w.busy and self.is_parked(w))
        return busy, parked, len(self.workers)

    def _log_parking_transitions(self) -> None:
        now_parked = {
            url for w in self.workers if (url := w.proxy_url) and self.in_cooldown(url)
        }
        # Counted in **workers, not URLs**. One proxy configured with four
        # slots is four workers, so subtracting a count of parked URLs from a
        # count of workers reported "7 of 8" where the truth was 4 of 8 — on
        # the one line whose whole job is to make remaining capacity honest.
        parked_workers = sum(1 for w in self.workers if w.proxy_url in now_parked)
        for url in now_parked - self._parked_urls:
            logger.warning(
                "proxy worker parked: %s is in cooldown, so it takes no new sync "
                "messages until it recovers (scraping capacity is now %d of %d)",
                url,
                len(self.workers) - parked_workers,
                len(self.workers),
            )
        for url in self._parked_urls - now_parked:
            logger.info("proxy worker resumed: %s is out of cooldown", url)
        self._parked_urls = now_parked

    def _take_free(self) -> ProxyWorker | None:
        for worker in self.workers:
            if not worker.busy and not self.is_parked(worker):
                worker.busy = True
                return worker
        return None

    async def acquire(self, *, timeout: float | None = None) -> ProxyWorker | None:
        """Take a worker whose proxy is healthy. None if `timeout` lapses.

        The event is what keeps this from being a polling loop: `release()`
        sets it, so a freed worker is taken at once rather than at the next
        poll. Without it every dispatch would wait up to
        `WORKER_WAKE_POLL_SECONDS` for a worker that is already free — nothing
        failing, nothing lost, just a queue that looks slow.

        The clear happens before the check because that is the correct shape if
        this ever runs somewhere a `release()` can interleave. On a
        single-threaded event loop it cannot: there is no `await` between
        `_take_free` and the clear, so the order is unobservable today and no
        guard claims otherwise.
        """
        deadline = None if timeout is None else time.monotonic() + timeout
        while True:
            self._wake.clear()
            self._log_parking_transitions()
            worker = self._take_free()
            if worker is not None:
                return worker

            wait = WORKER_WAKE_POLL_SECONDS
            if deadline is not None:
                remaining = deadline - time.monotonic()
                if remaining <= 0:
                    return None
                wait = min(wait, remaining)
            with contextlib.suppress(TimeoutError):
                await asyncio.wait_for(self._wake.wait(), wait)

    def release(self, worker: ProxyWorker) -> None:
        worker.busy = False
        self._wake.set()

    def snapshot(self) -> list[dict[str, Any]]:
        return [
            {
                "index": worker.index,
                "proxyUrl": worker.proxy_url or "direct",
                "state": (
                    "parked"
                    if self.is_parked(worker)
                    else ("busy" if worker.busy else "idle")
                ),
            }
            for worker in self.workers
        ]


class ProxyBinding(Protocol):
    """Anything that can answer "which proxy is this task using right now".

    A protocol rather than `ProxyWorker` because the queue consumer binds its
    **slot**, not the worker inside it, and the difference is a real bug: a
    coalesced waiter puts its worker down while it waits and may take a
    different one back. Binding the worker object captures the proxy at the
    moment the message started, so after such a swap the walk would fetch
    through a proxy that now belongs to somebody else's message — with the
    partition still believing each is on its own. Binding the slot makes the
    read live, and answers whatever the slot holds at the moment of the fetch.
    """

    @property
    def proxy_url(self) -> str | None: ...


#: The binding the current task is fetching under, if any.
#:
#: A `contextvar` for `core/request_meter.py`'s reason, which is the same shape:
#: the value is set by the queue consumer and read by the HTTP client, with
#: `sync_orchestrator` and `scraper` in between reading neither. Threading it
#: through would add a parameter to a dozen signatures that nothing on the path
#: uses. A module-level global would be worse than either — two workers running
#: concurrently would overwrite each other's proxy, and only under concurrency,
#: which is the failure that never reproduces in a single-worker test.
_bound_proxy: contextvars.ContextVar[ProxyBinding | None] = contextvars.ContextVar(
    "proxy_binding", default=None
)


@contextmanager
def bound_to(binding: ProxyBinding | None) -> Iterator[None]:
    token = _bound_proxy.set(binding)
    try:
        yield
    finally:
        _bound_proxy.reset(token)


def bound_proxy_url() -> str | None:
    """The proxy every fetch in this task must use, or None for free choice."""
    binding = _bound_proxy.get()
    return binding.proxy_url if binding is not None else None


# --------------------------------------------------------------------------
# The Slot: one permit out of the Partition, which can be handed back
# --------------------------------------------------------------------------
#
# Moved here from `jobs/sync_queue.py` with the Partition it comes out of
# (ADR-012). It was the queue consumer's because the consumer was the only
# thing that took one; `sync_orchestrator.run_sync_job` takes them too now, and
# that module importing `sync_queue` for a Partition concept is what kept the
# two files in a cycle — `sync_queue` reaching lazily back into
# `sync_orchestrator` for `sync_single_channel`, and `sync_orchestrator`
# importing `SlotLost` at the top. `ReleasableSlot` there is a `Protocol` for
# exactly that reason, and it can stay one: it is also the honest dependency.


#: How long a fan-out waits for a healthy Slot before giving up on one Channel.
#:
#: **Unbounded is a hang, not patience** (found in review). `_take_free` skips
#: a worker whose proxy is in cooldown, so with every proxy parked
#: `acquire(timeout=None)` waits for ever — and the two fan-outs that take
#: Slots outside the drain had no deadline at all. A bulk follow's three
#: hundred tasks would all park with the row left `running`, the `finally` that
#: charges the ledger never reached; an `auto_summary` walk would never return
#: and, under APScheduler's `max_instances=1`, suppress every later tick.
#:
#: The old `asyncio.Semaphore` always granted, so this is a hazard the Slots
#: introduced. `sync_queue` has always passed a deadline here, for exactly this
#: reason; these two now do too.
#:
#: Sized like one whole fetch rather than like the drain's five seconds,
#: because a cooldown is ten minutes and these callers have no sweep behind
#: them to come back: giving up marks the Channel failed, which a person sees.
SLOT_WAIT_SECONDS = 120.0


class SlotLost(Exception):
    """A released permit could not be taken back inside the caller's deadline.

    Raised out of `SyncSlot.released(reacquire_within=...)`. It is not an error
    condition so much as an answer: the waiter has run out of the time it was
    given, and it must not proceed without a permit.
    """


class SyncSlot:
    """One worker out of the partition, which can be handed back.

    Before ticket 13 this wrapped a permit on a single shared semaphore. It now
    wraps a `ProxyWorker` — the same lifecycle, plus the proxy that worker is
    bound to, which is what `_handle_one` installs for the fetches underneath.

    The releasable shape is ticket 12's and the reason is ticket 11's: a
    request that finds another sync already running its Channel waits *inside*
    its slot, so N requests for one busy Channel occupied N scraping slots
    while scraping nothing. `released()` hands the worker back for the duration
    of a wait and takes one again before the caller does anything that needs
    it. The worker it gets back may be a different one, which is fine and is
    the reason binding happens per message rather than per job: a waiter has
    not fetched anything yet.

    **Why this still cannot deadlock.** Ticket 11's argument was "the holder
    acquires its slot before it can claim, so it is always able to finish", and
    that half is untouched — a runner holding a Channel's claim holds its
    worker for as long as it walks and never releases mid-walk. Only a *waiter*
    releases, and a waiter holds no claim. So there is no slot held by
    something waiting for a claim held by something waiting for a slot, which
    is the only cycle available here.
    """

    def __init__(self, pool: ProxyWorkerPool) -> None:
        self._pool = pool
        self._worker: ProxyWorker | None = None

    @classmethod
    def holding(cls, pool: ProxyWorkerPool, worker: ProxyWorker) -> SyncSlot:
        """Wrap a worker the caller has *already* acquired.

        The dispatcher acquires before it knows whether there is a message to
        put in the slot, because that wait is its backpressure. This is how the
        worker it is holding becomes the slot it hands over, without the object
        taking a second one.
        """
        slot = cls(pool)
        slot._worker = worker
        return slot

    @property
    def worker(self) -> ProxyWorker | None:
        return self._worker

    @property
    def proxy_url(self) -> str | None:
        """The proxy this slot's fetches must use — satisfies `ProxyBinding`.

        Read live rather than captured, because `released()` can hand back one
        worker and take a different one. See `ProxyBinding`.
        """
        return self._worker.proxy_url if self._worker is not None else None

    async def acquire(self) -> None:
        if self._worker is None:
            worker = await self._pool.acquire()
            if worker is None:  # pragma: no cover - unbounded acquire waits
                raise SlotLost
            self._worker = worker

    def release(self) -> None:
        if self._worker is not None:
            worker, self._worker = self._worker, None
            self._pool.release(worker)

    async def acquire_within(self, timeout: float) -> bool:
        """Take a worker, giving up after `timeout` seconds. True if taken.

        The bounded form exists because the unbounded one is not bounded by
        anything the caller can see: the dispatcher is sitting on the
        partition's own `acquire()` and takes the freed worker at once, so a
        waiter handing its worker back can be parked here for the length of
        somebody else's whole page walk — during which it evaluates neither its
        own deadline nor its job's cancellation. See
        `sync_orchestrator._put_slot_down`.
        """
        if self._worker is not None:
            return True
        worker = await self._pool.acquire(timeout=timeout)
        if worker is None:
            return False
        self._worker = worker
        return True

    @contextlib.asynccontextmanager
    async def released(
        self, *, reacquire_within: float | None = None
    ) -> AsyncIterator[None]:
        """Hand the permit back for the body, re-take it afterwards.

        With `reacquire_within`, a re-acquire that does not complete in time
        leaves the slot **not held** and raises `SlotLost`. The caller must then
        stop rather than carry on: holding no permit and scraping anyway is the
        cap the gate exists to enforce, quietly exceeded.

        If the body is cancelled the re-acquire raises `CancelledError` too and
        the slot stays empty, which is correct: a cancelled runner wants its
        worker gone, and the dispatcher's own `release()` is then a no-op.
        """
        self.release()
        try:
            yield
        finally:
            if reacquire_within is None:
                await self.acquire()
            elif not await self.acquire_within(reacquire_within):
                raise SlotLost


# --------------------------------------------------------------------------
# The one Partition (ticket 36, ADR-012)
# --------------------------------------------------------------------------
#
# There is exactly one Partition in a process, and only the sync worker builds
# one. It lived in `jobs/sync_queue.py` until ADR-012, which was right while the
# queue consumer was the only thing that took a Slot. It is not any more: the
# egress seam has `sync_orchestrator` taking Slots too, and that module already
# imports this one at the top. Left where it was, the Partition would have been
# reachable only through a lazy import in *each* direction — `sync_queue`
# reaching into `sync_orchestrator` for its inputs, `sync_orchestrator` reaching
# back into `sync_queue` for the Partition — which is how import order becomes
# load-bearing and how a cycle stops being visible to anything that reads the
# import block. Here the Partition is downstream of both and imports neither.

#: The worker's scraping partition, built on first use because it derives from
#: the configured proxies rather than from a constant (ticket 13).
_worker_partition: ProxyWorkerPool | None = None
_partition_signature: tuple[tuple[str, int], ...] = ()
_partition_width = 0
_partition_lock = asyncio.Lock()


def _load_partition_inputs() -> tuple[list[str], int, dict[str, int]]:
    """The proxy fleet and its slot configuration. That is the whole input.

    It used to return `syncConcurrency` as well, and `get_partition` truncated
    the worker list to it. ADR-012 removed the setting: the Partition's width
    *is* the fleet's capacity, and a second number an operator had to keep
    plausible against it was a way to be wrong, not a way to tune. The setting
    even told them so — its own UI copy asked them to keep it at or below proxy
    capacity, which is an invariant `min()` was already enforcing.

    Moved here from `sync_orchestrator` with the Partition it feeds. It reads
    settings and nothing else, so it is what makes the Partition's move a clean
    one: keeping it in the orchestrator is what forced the lazy import the
    section comment above argues against.
    """
    with Session(engine) as session:
        network = load_network_settings(session)
        default_slots, overrides = resolve_proxy_concurrency(network)
        return resolve_proxies(network), default_slots, overrides


async def get_partition() -> ProxyWorkerPool:
    """The worker's scraping partition, built once and refreshed on change.

    **This replaced a single `asyncio.Semaphore`** (ticket 13). The gate said
    how many Channels could be walked at once and nothing about which proxy any
    of them used, so a burst of syncs piled onto whichever lane happened to be
    least loaded and one Channel's backward walk hopped proxies page by page.
    The partition is one worker per proxy slot, each pinned to its proxy for
    the whole message: the count now *derives* from the proxies rather than
    being a number that has to be kept plausible against them.

    **Nothing truncates it any more** (ADR-012). `syncConcurrency` did, and its
    removal is monotonic: the width goes from `min(3, sum)` to `sum`, so one
    proxy stays one and ten proxies go from three to ten. Telegram meters the
    unauthenticated web view by IP — which is why cooldown and pacing are both
    keyed by proxy URL — so a hand-set ceiling of three over ten proxies was
    throwing away most of the fleet.

    **The check-then-await is the bug the lock guards**, and it predates this
    ticket: `drain_sync_lanes` used to gather a whole batch of coroutines, and
    without the lock every one of them saw an unbuilt gate, awaited the
    settings read, and then assigned its *own*. Ten Channels would scrape at
    once whatever the setting said — silently, only under concurrency, and
    pointed at the proxies this deployment is trying to be polite to.
    """
    global _worker_partition, _partition_signature, _partition_width
    async with _partition_lock:
        proxies, default_slots, overrides = await asyncio.to_thread(
            _load_partition_inputs
        )
        pool = await ensure_pool_configured(proxies, default_slots, overrides)
        lanes = pool.lanes()
        signature = tuple((lane.url, lane.max_parallel) for lane in lanes)

        current = _worker_partition
        rebuild = current is None or (
            signature != _partition_signature
            # Rebuilt only while nothing holds a worker, because replacing the
            # partition mid-flight loses track of what is outstanding: the
            # in-flight messages would release into an object nobody reads and
            # the new one would believe itself idle. An operator's change lands
            # on the next idle drain rather than needing a restart.
            and not any(worker.busy for worker in current.workers)
        )
        if rebuild:
            current = ProxyWorkerPool(build_workers(lanes))
            _worker_partition = current
            _partition_signature = signature
            _partition_width = len(current)
        assert current is not None
        return current


def partition_width() -> int:
    """How wide the Partition was when it was last built; 0 before the first.

    A function rather than the module global it reads, because the global is
    rebound by `get_partition` and an importer that had bound the name would
    keep reading the width the Partition had at import time — which is zero,
    for every caller that imports before the worker starts.
    """
    return _partition_width


def reset_worker_partition_for_tests() -> None:
    global _worker_partition, _partition_signature, _partition_width
    _worker_partition = None
    _partition_signature = ()
    _partition_width = 0
