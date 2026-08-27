# One worker per proxy (ticket 13)

`.scratch/multi-user-tenancy/issues/13-one-worker-per-proxy.md`. This is step 3
of `docs/scaling-to-multiple-workers.md`, and it takes a different route than
that document proposed.

## What is wrong today

Two independent limits sit between a queued Channel and Telegram, and neither
of them makes the rate at any one proxy predictable.

1. `sync_queue._concurrency_gate` — **one** `asyncio.Semaphore` for the whole
   worker, sized `min(syncConcurrency, total proxy slots)`. It says how many
   Channels may be walked at once. It says nothing about *which* proxy any of
   them uses.
2. `proxy_pool`'s per-lane semaphores — acquired and released **per HTTP
   attempt**, with least-loaded round-robin dispatch across lanes.

So a single Channel's backward walk hops proxies page by page, a burst of
concurrent syncs concentrates on whichever lane happens to be least loaded at
that instant, and a walk can block up to `ACQUIRE_TIMEOUT_SECONDS` mid-page and
then fail with `ProxyPoolExhausted` — 40 pages in, for a reason that has
nothing to do with the Channel.

`sync_queue`'s docstring points at a third thing here — that
`auto_summary._sync_channels_for_summary` calls `run_sync_job` directly with
its own semaphore, so the gate in (1) caps lane work rather than the worker's
scraping — and names ticket 13 as what makes the distinction stop mattering.
**It does not, and the note is wrong on both halves.** The per-proxy *rate* was
never at risk there: every proxied `fetch_with_retry` takes a lane permit, that
path included. Its *channel* concurrency is still its own semaphore afterwards,
because it calls `run_sync_job` directly rather than enqueueing, and bringing it
into the partition means giving it a worker, which means enqueueing, which
inverts its control flow — it needs the sync finished before it can summarise.
That forward reference stays open and is somebody else's ticket.

## The shape

Replace the shared gate with a **partition**. A worker is one scraping slot
**bound to one proxy for the whole message**, and there are exactly as many
workers as there are proxy slots.

```
before   [ one semaphore, size N ] -> any channel -> pick a lane per request
after    [ worker(proxy A) ] [ worker(proxy B) ] [ worker(proxy C) ]
             one channel        one channel        one channel
             every request      every request      every request
             on proxy A         on proxy B         on proxy C
```

- **Worker count derives from proxy count.** One worker per lane slot, taken
  round-robin over lanes so that with 10 proxies and 3 workers you get three
  distinct proxies rather than three slots of the same one. `syncConcurrency`
  still truncates the list — an operator lowering it is asking for less
  parallelism, and silently overriding that would be the same dishonesty this
  ticket is fixing. With **no proxies configured** there is one direct
  partition of width `syncConcurrency`, which is exactly today's behaviour.
- **The worker owns the lane; it does not hold the lane's permit.** What it
  holds for the whole message is the lane's `httpx.AsyncClient`, which is the
  connection reuse the ticket asks for. The semaphore permit is still taken per
  request — on the bound lane rather than a chosen one — because holding it for
  a whole backward walk would park every *other* kind of proxied traffic behind
  it. A five-minute backfill would make thumbnails and bot publishes wait, and
  `ProxyPoolManager.acquire` starts raising `ProxyPoolExhausted` after two
  minutes. Per-proxy concurrency stays true for every caller that way,
  including the ones that never go near a lane queue. `hold()` takes the same
  120-second bound as `acquire()` for the same reason turned around: a bound
  message shares its lane with ~20 thumbnail fetches per page and with anything
  else pointed at that proxy, so an unbounded wait there stalls a message
  toward its 2.4-hour visibility timeout with nothing in the log.
- **The binding travels by `contextvars`**, for `core/request_meter.py`'s
  reason: threading a proxy through `_run_channel` -> `sync_single_channel` ->
  `scraper` -> `fetch_with_retry` puts a parameter nobody on that path reads
  into a dozen signatures, and a module-level global would hand two concurrent
  workers each other's proxy — only under concurrency, which is the failure
  that never reproduces in a single-worker test.

## A bound worker does not hop, and that is the point

While a binding is active `fetch_with_retry` uses the bound lane for **every**
attempt, including retries, and never falls back to another lane.

The fallback is what a reader will want to add back, so: hopping is the
mechanism that turns one bad proxy into several. It moves the dead proxy's load
onto the healthy ones at the exact moment Telegram is already pushing back,
which is how a single rate-limited egress becomes a rate-limited set. And
"capacity honestly reflects available proxies" means throughput has to *drop*
when a proxy dies. Redistributing hides precisely the number the ticket asks to
be honest about.

The Channel is not lost. It fails this pass like any other failure, and the
next sweep dispatches it to a worker bound to a healthy proxy — because the
dead proxy's worker is parked and will not take it.

## Parking

A worker whose proxy is in cooldown takes no new message until the cooldown
lapses. Cooldown is already tracked (`network._bad_proxies`) and lanes already
report `inCooldown`.

**A parked worker must not look like a hung one.** This repo has shipped that
ambiguity before — 711 job rows sat in `running` since June because nothing
distinguished "waiting" from "dead". So both transitions are logged with the
capacity that remains, and a drain that finds *every* worker parked says so and
returns rather than blocking until the sweep kills it.

It is deliberately **not** a new runtime-config field. Cooldown lives in
`network._bad_proxies`, which is process-local, and `/jobs/runtime-config` is
served by the API — so a `parked` flag there could never be true however many
workers were parked in the worker process. A dashboard that can only ever
report zero is worse than no dashboard. The width itself is already on the
wire: `effectiveProxyCapacity` is the partition before truncation and
`allowedConcurrency` is the partition, so nothing about the count is hidden.

## What remains per-process, and the guard

The partition is built from process-local state, so two worker replicas would
each build the whole partition and each own every proxy. The pin therefore
survives ticket 13 — with a different reason, which is what
`tests/deployment/test_worker_count.py` must now say.

Following ticket 10 and ticket 11: the assertion that no longer holds is
**inverted, not deleted**. `test_proxy_concurrency_is_still_capped_per_process`
asserted a shared `syncConcurrency` gate existed; it now asserts that gate is
gone and that the partition replaced it, plus that the partition is still
per-process. Dropping the assertion would leave the file naming a reason that
nothing checks, which is the state ticket 11's note warns about.

## Sequence

1. `proxy_pool.py` — the partition: worker list derived from lanes, acquire /
   release, cooldown parking, snapshot, the binding contextvar.
2. `network.py` — `fetch_with_retry` honours an active binding.
3. `sync_queue.py` — `_concurrency_gate` becomes the partition; `SyncSlot`
   wraps a worker instead of a semaphore permit; `_handle_one` binds.
4. `runtime_config.py` — parked/bound state on the wire.
5. `tests/deployment/test_worker_count.py` — reason 3 inverted.
6. New guards, each mutation-tested until it goes red.
