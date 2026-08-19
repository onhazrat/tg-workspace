# Scaling past one worker

`backend/Dockerfile` runs `--workers 1`. That is a correctness constraint, not a
capacity judgement, and this is how to remove it.

## Why the count is 1 today

The image ran `--workers 4` — the FastAPI template default, never reconciled with the
scheduler that arrived later. Measured on staging 2026-08-19: **four `Auto Sync
(scheduler)` jobs created every tick**, four workers scraping the same channels, every
scheduled job costing four times what it should, and 711 job rows stranded in
`running`. Nothing errored. It was simply doing everything four times.

Three pieces of state are per-process, and each breaks differently:

| state | where | what breaks with N workers |
|---|---|---|
| APScheduler | `app/main.py` lifespan → `jobs/scheduler.py` | every scheduled job fires N times |
| job registry | `services/scraper_jobs.py` (`_active_jobs`, `_channel_locks`, `_cancel_events`, `SyncJobState._update_condition`) | `has_active_sync_job()` sees 1/N of reality; SSE progress is only live on the worker that owns the job |
| proxy lane semaphores | `services/proxy_pool.py` (`asyncio.Semaphore`) | **N x the configured request rate through each proxy** |

`tests/deployment/test_worker_count.py` asserts all three still hold. When you
externalise one, that guard fails — deliberately. It is the notification that the
constraint is lifting, not an obstacle.

## The shape to aim for

Not "more workers". **Two tiers with different scaling rules**, because the two halves
of this system have opposite constraints:

```
  API tier          N replicas, stateless
                    serves reads/writes/SSE, scales with users
        |
        |  Postgres (LISTEN/NOTIFY for progress, job claims)
        |
  Sync tier         1 replica (or a fixed few with a shared proxy budget)
                    scheduler + scraping
```

The API tier is the part that has to grow with your user count, and it is genuinely
stateless once progress fan-out leaves process memory. The sync tier is
**deliberately not scaled by user count** — it is bounded by how fast you may
politely hit `t.me` through a fixed set of proxies. Doubling users does not double
that budget.

This is why "split the scheduler into its own service" is the wrong first move even
though it looks like the clean one: it puts the boundary in the right place while the
state is still in the wrong place. Progress streaming degrades to a 5-second database
poll, and the dedup hole moves rather than closes (manual and bulk-follow syncs would
still start in the API tier).

## Sequence

Each step is independently shippable and leaves the system correct.

### 1. Progress fan-out over Postgres `LISTEN`/`NOTIFY`

`GET /jobs/sync/{id}/events` blocks on an `asyncio.Condition` attached to the
in-memory job. Replace the notify side with `NOTIFY sync_job_<id>` on flush and the
wait side with a `LISTEN` connection, so any process can stream any job's progress.

No new infrastructure — Postgres is already there. Note the 8000-byte payload cap:
send the job id, let the reader fetch state. Keep the in-memory path as the
same-process fast path so nothing regresses while this lands.

**Done when:** an SSE stream served by process A shows live progress for a job running
in process B.

### 2. Move the job claim into the database

`has_active_sync_job()` reads a dict. Replace with a real claim — a row-level
`SELECT ... FOR UPDATE SKIP LOCKED` on `tg_sync_jobs`, or a Postgres advisory lock
keyed by channel to replace `_channel_locks`.

This also fixes the 711 rows stranded in `running`: a claim that can expire is a claim
that can be reconciled on startup. Today nothing does, because the truth was in memory
and memory is gone after a restart.

**Done when:** two processes racing to sync the same channel produce one sync, and a
killed process's jobs are recoverable rather than stuck.

### 3. Share the proxy budget

The one with real-world consequences. `proxy_pool` hands out `asyncio.Semaphore` slots
per lane; N processes means N independent budgets pointed at the same proxies and the
same upstream. Either put the limiter somewhere shared (Redis token bucket), or —
simpler and probably right — keep **all** scraping in the single-replica sync tier and
never scale that horizontally.

Prefer the second. A shared rate limiter is a distributed-systems problem you do not
have to have; "one process owns the proxies" is a constraint you can simply keep.

**Done when:** the total request rate at each proxy is independent of how many
processes are running.

### 4. Split the tiers, then scale the API

With 1–3 done, this is a compose change plus an entrypoint flag rather than a
redesign. The API tier goes to N workers; the sync tier stays at one replica and keeps
the scheduler.

Update `tests/deployment/test_worker_count.py` in the same change — it should then
assert the *sync* tier is single-replica, which is the invariant that still matters.

## Also on the path to many users

Adjacent, and easy to conflate with this — they are separate axes:

- **Per-user data scoping.** `CLAUDE.md` describes Mode A: one superuser owns
  everything, no per-user row scoping. Multi-user needs that regardless of worker
  count. Corpus-level artefacts (embeddings, clusters) stay user-agnostic and get
  scoped at read time.
- **Sync work grows with distinct channels, not users.** Two users following the same
  channel should scrape it once. Worth settling before per-user scoping lands, because
  it decides whether the scheduler iterates users or channels — channels is the
  answer, with fan-out at read time.
- **`tg_sync_jobs` retention.** 196,047 rows / 153 MB as of 2026-08-19, with no
  policy. Independent of scaling but it will bite sooner with more users.

## What not to do

- **Do not raise `--workers` to buy capacity before step 3.** It does not add
  throughput, it adds duplicate work and quadruples the request rate at Telegram.
- **Do not add a distributed lock so the scheduler can run in one of N API workers.**
  It fixes only the tick, leaves SSE and dedup broken, and adds a failure mode where
  the lock holder dies and nothing is scheduled until a restart.
- **Do not delete the worker-count guard to make a change pass.** Its assertions name
  the three preconditions; if one no longer holds, that is a step completed and the
  guard should be updated to say so.
