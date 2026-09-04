# 36. One egress seam: every request to Telegram leaves from an acquired Lane

**Status:** done
**Blocked by:** None
**Design authority:** `docs/proxy-binding-seam-plan.md` — read it first. It
carries every decision, the alternative that lost, and the reason. This file is
the scope and the checkboxes only.

## What changed about this ticket

It was "One concurrency owner: fan `run_sync_job` out over the partition", and
that named the wrong defect. Three of its factual claims did not hold:

1. It named three `run_sync_job` callers. There are two — `RUN_SYNC_JOB_CALLERS`
   already said so. `bulk_follow` holds a *separate* `asyncio.Semaphore(4)` and
   has enqueued its chained sync since ticket 10.
2. It said `_run_whole_job` hops proxies. It does not; `_process_message` binds
   the whole legacy job to one Slot on purpose. Hopping is live on
   `auto_summary` alone.
3. It treated double-counted concurrency and proxy hopping as one defect. They
   are two, with different victims.

The `2N` over-count is real and is the smaller half. The operator's actual goal
is narrower to state and wider to reach: **one place in the code talks to
proxies and Telegram.**

`bound_to` appears in exactly one place in the whole codebase. Eleven places
reach Telegram or a proxy. That ratio is the ticket.

## Scope

- Mandatory Lane binding, enforced by a runtime raise plus an exemption
  inventory with reasons.
- `syncConcurrency` removed end to end. Partition width becomes `sum(slots)`.
  Database pool and thread executor derive from the width instead of silently
  capping it.
- `run_sync_job`'s semaphore deleted, fan-out acquires a Slot per Channel,
  `_run_whole_job` deleted after a staging check.
- `cache_channel_photo` through the Lane pool. It is a privacy bug: its twin
  `cache_post_thumb` already argues the case in its own docstring.
- `body.proxies` removed, so a request cannot choose its own egress.
- Discover probes onto a lowest-priority lane; `tg_discover_probes` survives as
  the backlog.
- Bulk follow moves to the worker, which needs `tg_follow_jobs`, `pg_notify` and
  a rewritten SSE. Largest piece, accepted knowingly.

## Checkboxes

- [x] `fetch_with_retry` raises without a Lane; exemptions declared with reasons
      — **a required argument instead of a raise**, which is stronger.
      `_fetch_once(*, client: httpx.AsyncClient)` has no default and only
      `build_lane_client` produces one, so a caller with no Lane cannot call it
      and the type checker says so. `test_egress_seam.py` is the inventory half
- [x] Test fixture acquires a real Lane against a fake pool; no "skip when no
      proxies configured" escape hatch — **no fixture needed** once the raise
      became an argument: there is no flag a test could set without acquiring
- [x] Synthetic direct Lane, so a proxy-less deployment still binds
- [x] Partition moved to `proxy_pool.py`; no bidirectional lazy import
- [x] `run_sync_job` fans out over Slots; `asyncio.Semaphore` gone
- [x] `_run_whole_job` deleted. **Staging verified 2026-09-03**: ticket 09's
      lane was created 8.6 hours before ticket 10's migration, all six live
      lanes are empty, and 229,759 archived messages contain zero with a null
      `channelId`. Re-run the check against any other deployment
- [x] `syncConcurrency` gone from settings, registry, runtime config and
      frontend, with a migration stripping the stored key
- [~] `build_workers`'s round-robin dealing deleted — **not done, and the plan
      was wrong to ask for it**. `_take_free` hands out the first idle worker in
      list order, so lane-by-lane dealing stacks the first concurrent walks on
      one proxy wherever a proxy has more than one slot. Identical at the
      default of one, which is why deleting it would have looked safe.
      `max_workers` is gone; the dealing stays, with the reason written down
- [x] Pool size and `to_thread` executor derive from Partition width
- [x] `cache_channel_photo` uses the Lane pool; its guard is parametrised over
      **both** cache modules. Media fetches capped at one attempt
      (`MEDIA_FETCH_RETRIES`), because the page-fetch retry budget under a
      per-page call took the sync-job suite from 13s to 8 minutes
- [x] `body.proxies` removed from three schemas, `FollowJobState`, three
      frontend call sites; client regenerated. **More senders than three**:
      `publishSummary` and `fetchBotInfo` took the list positionally from five
      more
- [x] `discover_probe_background` lane created by migration; `DRAIN_ORDER` is
      the Budget product plus declared extras; `is_sync_lane` added.
      **No new tier** — `NON_SYNC_LANES` served by an unweighted pass after
      `TIER_ORDER` gives the same ordering without multiplying through the
      Budget product
- [x] Probes never drain while a sync lane has a message
- [x] `tg_follow_jobs` with `pg_notify`; bulk-follow SSE reads across processes.
      **A trigger, not a lane**: a follow job is one message that runs for
      minutes, so it takes `scheduler.request_job_run`'s shape
- [x] A walk started by `auto_summary` does not hop proxies
- [x] `sync_queue.py:47` deleted rather than re-pointed; the `2N` note goes with
      the behaviour
- [x] `RUN_SYNC_JOB_CALLERS` and `sync_single_channel`'s docstring stop naming
      `_sync_stale_channels`, which does not exist
- [x] `test_worker_count.py` and `test_proxy_worker_partition.py` stay green
- [x] Every new guard mutation-tested before it is trusted — 33 mutations, and
      two of the guards written along the way could not fail until they were

## Found while doing it

Recorded in full in `docs/proxy-binding-seam-plan.md`. The three worth naming
here, because each is a trap the next ticket can walk into:

1. **Moving a call onto `fetch_with_retry` hands it the page-fetch retry
   budget.** Eight attempts with a 3s escalating delay is right for a page and
   wrong for anything cosmetic or on a per-page path. Decide the budget before
   the move.
2. **The synthetic direct Lane must not be built inside `configure()`.** The
   pool is one object shared by every caller, so a caller resolving "no proxies"
   replaced the fleet another had just configured, and the next call replaced it
   back. Under the suite that deadlocked on `aclose()` of a client belonging to
   a finished event loop, while holding `_pool_lock` — every later caller in the
   process stopped, with no error and no log.
3. **Moving a fetch out of the tick that dequeued it needs a lease.** The
   Discover sweep recorded a verdict in the same call, which is what took a
   handle out of the due set. Once the tick only enqueues, every tick handed out
   the same first batch again.

## Review

`/code-review` found 11 issues, 3 serious, all fixed. The two that matter most
were guarded by tests that could not see them: the probe lane was **enqueued
and never drained** (the guard drove `LaneScheduler` directly and never asked
whether the drain offered it the lane), and the API answered every follow-job
read with a **permanently stale** in-memory copy (every test called
`clear_follow_jobs_for_tests()`, emptying the dict that was wrong). Both now
have tests that go through the real loop. Details in the plan doc.

## Left open

- ~~The probe dequeue lease is not renewed.~~ Closed by deleting the lease: the
  sweep gates on the probe lane being empty, so a queued handle cannot be
  selected twice and `retry_after` means only the failure backoff again.
- A Partition rebuilt mid-job leaves that job on the old one until it finishes.
  Bounded, and the fetch is unaffected because the lane is resolved live.
- The direct Lane is one width for two processes with different traffic.
- The `_run_whole_job` deletion was cleared against **staging only**.

## Not in scope

The quota ladder still cannot see the non-lane paths. `auto_summary` stays
outside it deliberately: its sync is a prerequisite for a scheduled summary, so a
best-effort lane would regenerate the summary on stale input. The original
ticket considered and rejected that, and the reasoning survives.
