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

from app.core.config import settings
from app.services.network_settings import clamp_proxy_concurrency, normalize_proxy_url

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
    """One long-lived httpx client per proxy lane (connection reuse)."""
    slots = clamp_proxy_slots(max_parallel)
    return httpx.AsyncClient(
        proxy=normalize_proxy_url(proxy_url),
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

    def lanes(self) -> list[ProxyLane]:
        return list(self._lanes.values())

    def total_capacity(self) -> int:
        return sum(lane.max_parallel for lane in self._lanes.values())

    def snapshot(self) -> list[dict[str, Any]]:
        return [
            {
                "proxyUrl": lane.url,
                "maxParallel": lane.max_parallel,
                "inUse": lane.in_use,
                "inCooldown": self._proxy_in_cooldown(lane.url),
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

    `lane` is None only when the deployment has no proxies configured at all,
    which is the direct-egress case: there is nothing to partition, so the
    partition degenerates to `syncConcurrency` workers that fetch directly.
    That is exactly the behaviour before this ticket, which is the point — a
    proxy-less deployment should not notice the change.
    """

    index: int
    lane: ProxyLane | None
    busy: bool = False

    @property
    def proxy_url(self) -> str | None:
        return self.lane.url if self.lane is not None else None


def build_workers(
    lanes: list[ProxyLane], max_workers: int | None = None
) -> list[ProxyWorker]:
    """One worker per lane slot, dealt **round-robin across lanes**.

    The dealing order is the whole of the difference when `max_workers` cuts
    the list short. Filling lane by lane and then truncating would give a
    deployment with ten proxies and `syncConcurrency` of three all three
    workers on the *first* proxy — one proxy taking the entire scraping load
    while nine sit idle, which is the concentration this ticket is removing,
    reintroduced by the ordering of a loop.
    """
    if not lanes:
        width = max(1, max_workers if max_workers is not None else 1)
        return [ProxyWorker(index=i, lane=None) for i in range(width)]

    workers: list[ProxyWorker] = []
    remaining = {lane.url: lane.max_parallel for lane in lanes}
    while any(count > 0 for count in remaining.values()):
        for lane in lanes:
            if remaining[lane.url] <= 0:
                continue
            remaining[lane.url] -= 1
            workers.append(ProxyWorker(index=len(workers), lane=lane))

    if max_workers is not None:
        workers = workers[: max(1, max_workers)]
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
