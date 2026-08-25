# 10: Move the scheduler into a worker process

**What to build:** Automatic sync runs outside the web process. Restarting or deploying the API no longer interrupts syncing.

**Blocked by:** 09

**Status:** done

- [x] The scheduler runs in its own process consuming the queue
- [x] One message per Channel sync, never one per tick
- [x] A bulk sync remains one job with aggregate progress, its messages carrying the job identity
- [x] The web process no longer schedules work

`app/worker.py` (`python -m app.worker`, a single-replica `worker` compose
service on the same image) owns APScheduler and the lane consumer. `app/main.py`
starts neither, and `tests/deployment/test_worker_count.py` reads its **AST** to
say so — a substring check fails on the docstrings that explain the split, which
is a guard a correct file cannot satisfy.

**Step 1 of `docs/scaling-to-multiple-workers.md` had to land first.** That doc
names this exact move as the wrong first one, because splitting the tiers while
progress still lives in process memory degrades streaming to a 5-second poll —
and *not as an error*: `sync_job_events` already falls back to `get_job`'s row
read, so a sync in another process keeps streaming and quietly serves stale
state. `app/core/pg_notify.py` is that step. The notification carries the
**changed Channel**, not just the job id as the doc suggested: the row is what
`_should_flush_db` throttles to 5s, so a wakeup that forces a row read buys a
faster poll of stale data. A watcher patches a mirror; the row keeps its
crash-recovery cadence. Cancellation rides the same channel the other way,
because the `asyncio.Event` the sync polls now lives in a different process from
`POST /jobs/sync/{id}/cancel`.

`reconcile_interrupted_jobs` moved to the worker **and out of the API**. It fails
every non-terminal job on the reasoning that in-memory progress died with the
process — which stopped being true of the API the moment the sync left it, so
leaving it there would have failed every in-flight sync on each web deploy.

Enqueueing is now every mode's path (`enqueue_sync_job`), one message per
Channel carrying `jobId`, on the lane matching the job's Budget. Two lanes added
by migration `b3c4d5e6f7a8` (`auto_sync_normal`, `manual_bulk_normal`); the three
best-effort lanes and weighted draining stay ticket 12's. `app/jobs/
manual_single_queue.py` became `app/jobs/sync_queue.py`.

Three things changed shape because no `run_sync_job` sits above the Channels any
more: **`_finalize_if_complete`** recomputes the job's status after every message
so the last Channel to finish writes the terminal row; **concurrency** moved from
a per-job semaphore to one per worker (closer to what the limit always meant);
and **the quota meter** is per message rather than per job — same daily total,
but a job that dies half way now pays for the Channels that finished.

Ownership is explicit, because guessing it was the ticket's worst bug.
`create_job` runs wherever the request landed, so while it wrote to
`_active_jobs` the API believed it owned every sync it created: `get_job` served
its own stale object and `apply_progress_event` dropped the worker's deltas as
its own echo. The stream sat at `pending` and never sent `[DONE]`. `claim_job`
is now the only thing that grants ownership, and only the consumer calls it —
`tests/services/test_cross_process_progress.py` asserts creation does not.

Scheduler state crosses the split too. `_job_status` is filled in by whichever
process runs the jobs, so `GET /jobs/status` would have reported `idle`/`null`
for everything forever, and `POST /jobs/{id}/trigger` ran the runner **in the
API** — retention sweeps and Discover probes back in the tier this ticket
emptied. The worker announces each transition; the API folds it in and rings the
worker to trigger.

Review and the test suite each caught one real bug:

1. `enqueue_sync_job` inherited ticket 09's post-enqueue kick, which was right
   when the enqueueing process *was* the consumer and is precisely wrong now:
   `POST /jobs/sync` runs in the API, so the kick put the scraping straight back
   in the tier this ticket removed it from — invisibly, since the sync still
   happened. Surfaced as a **deadlock in `test_bulk_follow`'s teardown**, a
   stray drain racing the truncate. The kick is a `NOTIFY` the worker listens
   for; the 30s sweep remains the backstop for a lost ring.
2. The stand-in worker fixture returned before its `LISTEN` was established, so
   the ring from the *first* test in a module went nowhere and it timed out
   while every later test passed. `wait_until_listening` is why that is not a
   flake.

Code review found seven more, all fixed: the concurrency gate's check-then-await
let a whole batch each build its own semaphore (ten Channels scraping at once
whatever `syncConcurrency` said); a drain read one batch per ring, so a
50-Channel job idled through 30-second sweeps; `_fail_exhausted` failed every
sibling Channel when it could not resolve one message's; a cancel arriving while
the worker held the job as a mirror was dropped; `_publish_progress` fired a
NOTIFY per scraped page; `_mirrored_jobs` grew without bound; and the migration
cited a guard that did not exist — `tests/services/test_sync_lanes.py` now is it.

A second review round found eight more. The serious one: **`sync_mode` was
never persisted**, so the worker rebuilt every job from the row as `auto` —
billing the wrong quota Budget *and* applying the wrong per-Channel permission,
while lane routing stayed correct because it is computed at enqueue. Migration
`c4d5e6f7a8b9` adds the column. Also fixed: a dead mirror-expiry branch that
left the browser's final render wrong; `set_job_enabled_flag` nulling `nextRun`
in the API (the untouched twin of a guard already added); ~2,000 sequential
round trips to enqueue a `sync_all` (now `pgmq.send_batch`); a 30-second hang
when triggering a disabled job; `activeSyncJob` diagnostics going null in the
API; a crashed message stranding the job in `_active_jobs` and blocking
auto-sync for the visibility timeout; and worker shutdown abandoning claimed
messages for that same timeout, which in dev is every file save.

A third round found eleven more, three high — all about what "this job is dead"
means once two processes exist. `reconcile_interrupted_jobs` failed jobs the API
had queued while the worker was restarting, then archived their messages as
already-terminal (a `sync_all` interrupted at Channel 50 lost the other 1,950);
`queued_job_ids()` now exempts anything still on a lane. The round-two crash
path released the *whole* job when one message failed, leaving siblings to
rebuild a second `SyncJobState` from a lagging row and wait forever. `API_KEY`
was missing from the worker's compose environment — in production a silent
crash-loop with no HTTP symptom. Plus: the batch size capping `syncConcurrency`,
an unbounded `_cancel_events`, a count that hydrated 2,077 ORM rows, a trigger
wait coupled to the worker's restart-resetting counter, an oversized `detail`
dropping announcements, and two docstrings describing mechanisms that no longer
exist.

Two existing guards were substring matchers that a correct file could not
satisfy, and both were rewritten to read identifiers: the worker-count guard
(above), and `test_auto_sync_session_scope`'s ORM-escape check, which flagged
`to_sync` inside the word `run_auto_sync`.

Notes for tickets 11-13:

- **No per-Channel claim** (11). `_channel_locks` and `_in_flight` are
  process-local, which is at least now the process doing the work, but two syncs
  of one Channel still race. `_finalize_if_complete`'s consistency also rests on
  the sync tier being one replica.
- **Three lanes, drained in strict order** (single, bulk, auto). Ticket 12 adds
  the best-effort tier and the 3:2:1 weighting; enqueue is not yet interleaved
  by User.
- **The API tier is still `--workers 1`** — the job registry (step 2) is still a
  dict. The proxy pool (step 3) is what pins the *sync* tier to one replica, and
  that is ticket 13.
