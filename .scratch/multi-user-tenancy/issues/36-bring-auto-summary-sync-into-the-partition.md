# 36. One egress seam: every request to Telegram leaves from an acquired Lane

**Status:** ready-for-agent
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

- [ ] `fetch_with_retry` raises without a Lane; exemptions declared with reasons
- [ ] Test fixture acquires a real Lane against a fake pool; no "skip when no
      proxies configured" escape hatch
- [ ] Synthetic direct Lane, so a proxy-less deployment still binds
- [ ] Partition moved to `proxy_pool.py`; no bidirectional lazy import
- [ ] `run_sync_job` fans out over Slots; `asyncio.Semaphore` gone
- [ ] `_run_whole_job` deleted. **Staging verified 2026-09-03**: ticket 09's
      lane was created 8.6 hours before ticket 10's migration, all six live
      lanes are empty, and 229,759 archived messages contain zero with a null
      `channelId`. Re-run the check against any other deployment
- [ ] `syncConcurrency` gone from settings, registry, runtime config and
      frontend, with a migration stripping the stored key
- [ ] `build_workers`'s round-robin dealing deleted — nothing truncates now
- [ ] Pool size and `to_thread` executor derive from Partition width
- [ ] `cache_channel_photo` uses the Lane pool; its guard is parametrised over
      **both** cache modules
- [ ] `body.proxies` removed from three schemas, `FollowJobState`, three
      frontend call sites; client regenerated
- [ ] `discover_probe_background` lane created by migration; `DRAIN_ORDER` is
      the Budget product plus declared extras; `is_sync_lane` added
- [ ] Probes never drain while a sync lane has a message
- [ ] `tg_follow_jobs` with `pg_notify`; bulk-follow SSE reads across processes
- [ ] A walk started by `auto_summary` does not hop proxies
- [ ] `sync_queue.py:47` deleted rather than re-pointed; `sync_queue.py:977`'s
      `2N` note goes with the behaviour
- [ ] `RUN_SYNC_JOB_CALLERS` and `sync_single_channel`'s docstring stop naming
      `_sync_stale_channels`, which does not exist
- [ ] `test_worker_count.py` and `test_proxy_worker_partition.py` stay green
- [ ] Every new guard mutation-tested before it is trusted

## Not in scope

The quota ladder still cannot see the non-lane paths. `auto_summary` stays
outside it deliberately: its sync is a prerequisite for a scheduled summary, so a
best-effort lane would regenerate the summary on stale input. The original
ticket considered and rejected that, and the reasoning survives.
