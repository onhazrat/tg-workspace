# 09: PGMQ install and the first lane end to end

**What to build:** A manual single-Channel sync travels through a real durable queue instead of an in-process call, and the person triggering it sees the same result as before.

**Blocked by:** None (can start immediately)

**Status:** done

- [x] The queue is installed from a migration, needing no image change and no superuser privilege
- [x] One lane exists and a manual single sync is enqueued and consumed through it
- [x] Progress still reaches the browser unchanged
- [x] The visibility timeout is set from the expected worst case, with redelivery capped and exhausted messages archived

PGMQ vendored unmodified at `app/alembic/vendor/pgmq_v1.12.0.sql` (upstream
tag v1.12.0, PostgreSQL License) and installed by migration `f0a1b2c3d4e5` as
plain SQL — `CREATE TABLE`/`CREATE FUNCTION`, not `CREATE EXTENSION pgmq` — so
it needs neither a `postgres:18` image change nor superuser. Same migration
creates the one lane, `manual_single_normal` (`app/services/sync_lanes.py`,
which pairs `Budget.MANUAL_SINGLE` from ticket 08 with the `_normal` tier
suffix ticket 12's five remaining lanes will reuse).

`app/services/pgmq.py` is the integration wrapper (`send`/`read`/`archive`/
`delete`/`queue_length`) around the `pgmq.*` SQL functions — thin `text()`
calls, since PGMQ ships no Python client for the plain-SQL install path.

`POST /jobs/sync` with `syncMode: "individual"` now calls
`enqueue_manual_single_sync` (`app/jobs/manual_single_queue.py`) instead of
`asyncio.create_task(run_sync_job(...))`. The job row is created first exactly
as before, so `GET /jobs/sync/{id}` and its SSE stream see the same
"pending" → "running" → terminal sequence with no protocol change — the
queue only changes what schedules `run_sync_job`, not what reports its
progress. Two things drain the lane: an immediate best-effort kick right
after enqueueing (so the common case adds no latency) and a periodic
APScheduler sweep every `MANUAL_SINGLE_QUEUE_POLL_INTERVAL_SECONDS` (30s) as
the durability backstop — deliberately **not** a toggleable `JOB_IDS` entry,
since disabling it would silently strand every manual single sync.

The visibility timeout (`visibility_timeout_seconds`) is derived from
`NETWORK_FETCH_RETRIES`/`NETWORK_FETCH_TIMEOUT_SECONDS`/`SYNC_MAX_RETRIES`/
`SYNC_RETRY_BACKOFF_BASE_MS` — 2x the worst case of one `get_channel_info`
call plus one retried page fetch (~2.4h at current defaults) — rather than a
literal, so it moves if those settings do. It bounds the no-backfill case
only: a Channel still needing backfill paginates until the retention cutoff
with no hard cap today, queue or not; documented as a known gap in the
module docstring rather than papered over with a bigger constant.
Redelivery is capped at `MANUAL_SINGLE_QUEUE_MAX_READ_COUNT` (3); a message
read past the cap is archived and its job marked failed instead of retried
forever. Messages are archived on success too (decision 32), not deleted —
nothing prunes the archive table yet, left for a future ticket.

Three real bugs surfaced only once the full suite (not this ticket's own new
tests in isolation) exercised the code under real timing:

1. `_read_batch` originally read via `pgmq.read` without committing before
   closing its session, which silently rolled back PGMQ's claim (the
   `vt`/`read_ct` UPDATE) and let the post-enqueue kick and the periodic
   sweep both grab and process the same message. Fixed by committing inside
   `_read_batch`.
2. The post-enqueue kick's `asyncio.create_task(...)` held no reference
   anywhere, so the event loop was free to garbage-collect it mid-drain — a
   documented asyncio hazard, and the actual cause of the flakiness once (1)
   was fixed. Fixed by keeping tasks in a module-level `_pending_kicks` set,
   dropped via a done-callback.
3. Code review (not the full-suite run) caught a redelivery race the tests
   above didn't reach: a Channel that needs backfill can still be
   mid-`run_sync_job` when its message is redelivered past VT, and the
   terminal-status check in `_process_message` does not catch a job that is
   `running`, not finished — the redelivered copy would call `run_sync_job` a
   second time on the same live `SyncJobState`. Fixed with `_in_flight_job_
   ids`, a process-local guard. The same review also caught that
   `drain_manual_single_lane` processed a batch's messages one at a time,
   silently serializing what used to run fully concurrent per request —
   fixed by running `_handle_one` across a batch with `asyncio.gather`.

Guards: `tests/services/test_pgmq.py` (send/read/archive round trip against
the real lane), `tests/jobs/test_manual_single_queue.py` (VT derivation,
terminal-job skip, exhausted-redelivery archiving), and a new case in
`tests/api/test_sync_jobs.py` exercising `syncMode: "individual"` end to end
through the real queue via the existing polling endpoint.

Notes for tickets 10-14, which build on this:

- The consumer still runs in the web process (`scheduler.py`'s
  AsyncIOScheduler) — ticket 10 moves it to its own process. Until then it
  carries the same restart risk `run_sync_job` always did:
  `reconcile_interrupted_jobs` can mark a job `failed` at startup before a
  redelivered message arrives; `_process_message` checks the job's status
  first and skips reprocessing a terminal job rather than resurrecting it,
  but this is a guard against the worst symptom, not a fix for the race.
- No per-Channel claim or coalescing (ticket 11) — two individual syncs
  enqueued for the same Channel still run concurrently, exactly as before
  this ticket.
- Only the `manual_single_normal` lane exists; `auto_sync`/`manual_bulk`
  still use `asyncio.create_task` unchanged. Ticket 12 adds the other five
  lanes and weighted draining.
