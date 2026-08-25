# Moving the scheduler into a worker process (ticket 10)

Ticket: `.scratch/multi-user-tenancy/issues/10-move-the-scheduler-into-a-worker-process.md`.
Builds on ticket 09 (PGMQ, the `manual_single_normal` lane). Unblocks 11, 12, 13.

## Why this is not just a compose change

`docs/scaling-to-multiple-workers.md` names this exact move as the wrong *first*
one:

> This is why "split the scheduler into its own service" is the wrong first move
> even though it looks like the clean one: it puts the boundary in the right
> place while the state is still in the wrong place. Progress streaming degrades
> to a 5-second database poll.

That degradation is not hypothetical and it is not a hang. `sync_job_events`
already calls `get_job(job_id)` on every loop, and `get_job` falls back to the
`tg_sync_jobs` row whenever the job is not in *this* process's `_active_jobs`.
So the moment the sync leaves the web process, the stream keeps working and
quietly starts serving state that `_should_flush_db` throttles to
`SYNC_JOB_PERSIST_INTERVAL_MS` (5000 ms), polled at `SYNC_JOB_SSE_THROTTLE_MS`
(1000 ms). Nothing errors. The progress bar just gets worse.

So step 1 of the scaling doc — progress fan-out over `LISTEN`/`NOTIFY` — is a
prerequisite of this ticket, not a follow-up to it.

## What the four boxes require

| Ticket 10 box | What it actually costs |
|---|---|
| The scheduler runs in its own process consuming the queue | `app/worker.py` entrypoint, a `worker` compose service, `start_scheduler` out of the web lifespan |
| One message per Channel sync, never one per tick | auto-sync and bulk-follow enqueue N messages instead of calling `run_sync_job` once |
| A bulk sync remains one job with aggregate progress, its messages carrying the job identity | `jobId` in every message; the last channel to finish finalises the job row |
| The web process no longer schedules work | `POST /jobs/sync` enqueues for every mode, not just `individual` |

## Decisions

### 1. `NOTIFY` carries the delta, not just the job id

The scaling doc says "send the job id, let the reader fetch state", written on
the assumption the reader re-reads the row. Re-reading the row is the thing that
makes progress 5 seconds stale, so that advice does not survive contact with
this ticket. One channel's delta — id, status, posts fetched — is a few hundred
bytes, nowhere near the 8000-byte `NOTIFY` payload cap, and it costs no table
write at all.

That matters more than it looks. The flush throttle exists because
`_persist_job` rewrites the entire `channels` JSON array to record one entry:
**94,994 `UPDATE tg_sync_jobs` in 10 hours, 7.5 minutes of database time**, and a
whole-table job is normal here. Making the row fresher to feed the stream would
walk straight back into that. Sending deltas over `NOTIFY` keeps the row on its
5-second crash-recovery cadence and makes the stream *live*, which is better
than what the in-memory condition gave a watcher on another worker.

### 2. The in-process condition stays as the fast path

`touch_job` keeps notifying `_update_condition`. A watcher in the same process
as the sync — every test, and the whole system until the compose file changes —
behaves exactly as before. `LISTEN` is additive, so nothing regresses while this
lands.

### 3. The web process keeps a mirror, dropped when the stream ends

A cross-process watcher needs a full snapshot to serve, and it gets one the way
a reconnecting client already does: read the row, then apply deltas as they
arrive. The mirror is keyed by job id, only exists for jobs someone is actually
watching, and is dropped on terminal status or when the last watcher leaves.

### 4. Two new lanes, not six

Ticket 12 owns "six lanes exist" and weighted draining. This ticket adds only
the two normal-tier lanes it needs to get work out of the web process:
`auto_sync_normal` and `manual_bulk_normal`. Draining stays round-robin across
whatever lanes exist; the weighting is 12's.

### 5. `channelId` is optional, because a deploy has messages in flight

A `manual_single_normal` message enqueued by the old code carries `jobId` and
`userId` and no channel. Treating that as malformed would strand every sync
enqueued in the seconds before the worker restarts. Absent `channelId` means
"every channel in this job", which is exactly what the old consumer did.

### 6. Each message charges its own quota meter

`run_sync_job` opened one meter per job and charged once at completion. Per
channel, each message opens its own and charges its own. The total is identical
— `tg_quota_usage` accumulates on `(user_id, day, budget)` — and a job that dies
half way now pays for the channels that finished rather than losing the lot,
which is the same argument the `finally` in `run_sync_job` already makes.

### 7. Concurrency moves from the job to the worker

`run_sync_job` sized an `asyncio.Semaphore` per job. With one message per
channel there is no job-shaped scope to hang that on, so the worker holds one
process-wide semaphore sized the same way (`_load_sync_job_concurrency`). This
is strictly closer to what the limit meant: the constraint was always "how many
channels may this deployment scrape at once", never "per job".

## Sequence

1. `app/services/job_events.py` — publish/listen, in-process fast path kept.
2. `app/worker.py` + compose `worker` service; `start_scheduler` leaves the web
   lifespan; `reconcile_interrupted_jobs` moves with it.
3. Two lanes by migration; `app/jobs/sync_queue.py` as the lane-agnostic
   consumer; auto-sync, bulk-follow and `POST /jobs/sync` all enqueue.
4. Guards: `test_worker_count.py` reason 1 flips, a new guard proves a stream in
   process A sees a job running in process B.

## Not in this ticket

- Per-Channel claim and coalescing (11). Two syncs of one Channel still race;
  `_channel_locks` is now worker-local, which is where the work is, so this is
  no worse than before — but it is not fixed.
- The three best-effort lanes and weighted draining (12).
- One worker per proxy, and the rest of the worker-count guard (13).

## What review changed after the fact

Ten findings, and the headline one invalidated the guards for everything else.

**`create_job` claimed every job it created.** It writes in whatever process
handled the request, which is the API — so the API held every sync in
`_active_jobs`, served its own stale object from `get_job`, and discarded the
worker's deltas in `apply_progress_event` as its own echo. The stream sat at
`pending` and never sent `[DONE]`. Nothing errored. The cross-process tests
passed because they cleared `_active_jobs` by hand to "simulate" the second
process, which is precisely the state the bug prevented. Ownership is now
`claim_job`'s alone, granted by the consumer as it starts a Channel.

The rest, briefly: the concurrency gate's check-then-await let every coroutine
in a batch build its own semaphore; a drain read one batch per ring, so large
jobs idled through 30-second sweeps; `_fail_exhausted` failed every sibling
Channel when it could not resolve one message's; a cancel arriving while the
worker still held the job as a mirror was dropped; `_publish_progress` fired a
`NOTIFY` per scraped page, reintroducing one layer up the write volume
`_should_flush_db` exists to avoid; `_mirrored_jobs` grew without bound; the
Jobs panel and its trigger button both broke on the split (status now crosses by
announcement, triggering by request); a comment claimed bulk follow's probe
phase had moved when only its chained sync had; and the migration cited a guard
that did not exist, which `tests/services/test_sync_lanes.py` now is.

The lesson worth keeping: **a test that reaches into module state to simulate
the other process is not testing the split.** Two of the guards here did that,
and both would have shipped the defect they were written for.

## Second review round

Eight more, after the fixes above. The load-bearing one was again a thing that
looked fine from inside one process.

**`sync_mode` was never persisted.** It lived on `SyncJobState` only, which was
sound while the process that created a job also ran it. The worker rebuilds the
job from `tg_sync_jobs`, found no column, and got the dataclass default — so
**every worker-run job came back as `auto`**. That is not only billing the wrong
quota Budget that tickets 23 and 24 will read; `channel_allows_sync_operation`
reads the same field, so Channels were being synced under a mode their setting
group forbids. Lane routing stayed correct throughout, because it is computed at
enqueue in the process that still had the right value — which is precisely why
nothing looked wrong. Migration `c4d5e6f7a8b9` adds the column.

The rest: a job-level notification refreshed `_mirror_notified_at_ms` while
trying to *expire* the mirror, making the expiry dead code and leaving the
browser's final render permanently wrong on the `_fail_exhausted` path;
`set_job_enabled_flag` nulled `nextRun` in the API — the untouched twin of a
guard already added to `_refresh_enabled_flags`; enqueueing sent one message per
Channel in its own transaction, putting ~2,000 sequential round trips in front
of a `sync_all` response (`pgmq.send_batch` now); triggering a *disabled* job
waited out the full 30-second timeout because a disabled run never sets
`lastRun`; `activeSyncJob` diagnostics went permanently null in the API, which
never claims a job; a crash outside `sync_single_channel`'s handler stranded the
job in `_active_jobs`, so auto-sync skipped every tick for the ~2.4h visibility
timeout; and worker shutdown abandoned claimed messages for that same timeout —
every file save in dev, since compose restarts the worker on change.

Two rounds, eighteen findings, and the pattern in the serious ones is identical:
**state that was implicitly shared because one process held it**. The split does
not announce which assumptions it broke; each one has to be found.

## Third review round

Eleven more, three of them high, and all three were about the same thing: what
"this job is dead" means once two processes are involved.

**`reconcile_interrupted_jobs` was no longer sound.** It fails every
non-terminal row at worker boot, reasoning that in-memory progress cannot
survive a restart. True while one process created and ran everything; false now.
The API creates jobs on its own lifecycle, so pressing Sync while the worker
restarts produced a real row with real messages on a lane — which the booting
worker then failed, after which `_process_message` archived every one of its
messages as "already terminal". A 2,000-Channel `sync_all` interrupted at
Channel 50 lost the other 1,950 and reported failure. `queued_job_ids()` is the
fix: a job with messages still queued is *waiting*, which is what a queue is
for. It also rescued the previous round's shutdown-release, which was being
defeated by exactly this.

**The crash path released the whole job.** Added in round two and wrong in the
same way a message is not a job: dropping the job from `_active_jobs` while nine
sibling Channels are still scraping means the next message rebuilds a second
`SyncJobState` from a lagging row, which then waits forever for Channels whose
messages were already archived. Scoped to "no sibling still in flight".

The rest: `API_KEY` missing from the worker's compose environment, which in
production is a silent crash-loop with no HTTP symptom; the batch size silently
capping `syncConcurrency`; `_cancel_events` growing unbounded in the API (its
sibling dict got a cap, it did not); `_operator_channel_count` hydrating ~2,077
ORM rows to produce one integer; the trigger wait coupled to the worker's
restart-resetting counter; an oversized `detail` silently dropping a whole
announcement; and two docstrings describing mechanisms that no longer exist.

Three rounds, twenty-nine findings. Every serious one was **state that was
implicitly shared because a single process held it** — and none of them
announced itself. The tests that mattered were the ones that made the two
processes actually distinct, rather than reaching into module state to pretend.
