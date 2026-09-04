# #145 🔒 Per-Channel sync claim, coalescing, mutual exclusion (ticket 11)

**State:** merged 2026-08-27 · **Branch:** `worktree-ticket-11-channel-claim` into `main` · **Diff:** +1867 / -118 across 10 files · **Opened:** 2026-08-27

---

Closes ticket 11 (`.scratch/multi-user-tenancy/issues/11-per-channel-claim-coalescing-mutual-exclusion.md`). All five checkboxes.

## What was wrong

Two backward walks of one Channel interleave their writes to `last_updated`, `anchor_post_id`, `oldest_stored_post_timestamp` and `history_complete_to_cutoff`, and the row that results describes neither walk. Posts were never at risk — `bulk_upsert_posts_impl` upserts on the unique constraint — those four cursors were.

The protection was `scraper_jobs._channel_locks`, an `asyncio.Lock` per channel name. That stopped meaning anything when ticket 10 moved the scheduler into its own process, and will mean less again when ticket 13 puts a second worker beside the first.

## What this does

`Channel.sync_claimed_at` / `sync_claimed_by` (migration `a8b9c0d1e2f3`), taken by a conditional `UPDATE ... RETURNING` in `services/channels.py` — the aggregate that already owns `tg_channels`, so the table keeps one writer. The lock is **deleted, not kept beside it**: two answers to "is this Channel being synced" diverge the moment the second worker arrives.

The claim lives in `sync_single_channel` rather than in its two callers, for ticket 33's reason — that is the function that walks the pages, and guarding a caller leaves the next caller unguarded.

### Decisions worth reading

- **The lease is not the visibility timeout.** Five minutes against the VT's ~2.4 hours. The VT decides when a crashed worker's *message* comes back; the lease decides when its *Channel* does. Tying them leaves a Channel that died at noon refusing every sync until 14:24. A live sync renews on a heartbeat, so the lease bounds how long a **dead** holder blocks the Channel, never how long a live one may take. An expired claim is simply taken by the next caller — no reaper, nothing for an operator to run.
- **Release and renew are conditional on the holder.** An overrun runner still reaches its own `finally`; an unconditional release there clears the *new* holder's claim mid-walk.
- **A coalesced request is not charged**, and both halves are asserted — it never enters the walk so its meter counts nothing, and a charge of zero writes no row. Either alone passes for a request that scraped and was let off.
- **A waiter holds a concurrency-gate permit while it waits.** Stated rather than glossed: it cannot deadlock, but N waiters on one busy Channel occupy N slots, so the wait is capped and reports a skip past it. Draining as slots free is ticket 12's.
- **The claim never moves the scheduling deadline** (decision 33), is not indexed, and does not bump `updated_at` or the channels etag.

## Code review

`/code-review high` found **seven** real issues, all fixed in `7f05310` — the worst being that the two new columns were writable through `PUT /data/channels/{id}`, because `apply_channel_fields` writes any key in `Channel.model_fields` and `SERVER_MANAGED_CHANNEL_FIELDS` had not been updated. Clearing a live holder's claim that way starts the exact concurrent walk this ticket prevents. Also fixed: the lease was timed off the caller's wall clock (fine with one worker, wrong the moment ticket 13 lands), a runner that had lost its lease still announced an outcome riders would adopt, releasing before announcing left a window costing an extra scrape, job-scoped `skipped`/`cancelled` outcomes were adoptable by riders, losing the lease mid-sync still wrote the cursors, and the row fallback invented a success it had no evidence for.

## Guards

`tests/services/test_channel_mutual_exclusion.py` — 24 tests. **Every one was watched to fail** against a named mutation; the mutations are listed in the module docstring, including one that was run and **caught nothing**: swapping `RETURNING` for `rowcount` is not a defect on a plain conditional `UPDATE` through `session.execute`, so that is recorded rather than papered over.

`tests/deployment/test_worker_count.py`'s reason 2 shrank on purpose and left a guard pointing the other way, so the constraint is not quietly dropped.

Full backend suite: **1748 passed, 2 skipped**. mypy, ty, ruff clean.

Note: CI test workflows are billing-blocked and never start, so expect no checks here.
