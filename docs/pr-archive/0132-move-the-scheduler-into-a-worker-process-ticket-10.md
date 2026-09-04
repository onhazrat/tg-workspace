# #132 ⚙️ Move the scheduler into a worker process (ticket 10)

**State:** merged 2026-08-25 · **Branch:** `worktree-ticket-10-scheduler-worker` into `main` · **Diff:** +4050 / -686 across 38 files · **Opened:** 2026-08-25

---

Closes ticket 10 (`.scratch/multi-user-tenancy/issues/10-move-the-scheduler-into-a-worker-process.md`). Unblocks 11, 12, 13.

## What changed

The API process no longer schedules or scrapes. `app/worker.py` (`python -m app.worker`, a single-replica `worker` compose service on the same image) owns APScheduler and the lane consumer, so deploying or restarting the API stops aborting an in-flight sync.

**Progress fan-out had to land first.** `docs/scaling-to-multiple-workers.md` names this exact split as the wrong first move, because doing it while progress lives in process memory degrades streaming to a 5-second poll — and not as an error: `sync_job_events` already falls back to a row read, so a sync in another process keeps streaming and quietly serves stale state. `app/core/pg_notify.py` is step 1 of that plan. The notification carries the **changed Channel** rather than just the job id, because the row is what the flush interval throttles; a watcher patches a mirror and the row keeps its crash-recovery cadence.

**Every sync mode enqueues one message per Channel** carrying the job id, on the lane matching its Budget. Two lanes added by migration `b3c4d5e6f7a8`; the three best-effort lanes and weighted draining stay ticket 12's. With no `run_sync_job` above the Channels, the last one to finish writes the terminal row, concurrency moved from per-job to per-worker, and the quota meter is per message.

`reconcile_interrupted_jobs` moved to the worker **and out of the API**, where it would otherwise have failed every in-flight sync on each web deploy.

## The bugs found on the way

- **`create_job` claimed every job it created.** It runs wherever the request landed, so the API believed it owned every sync: it served its own stale object and discarded the worker's deltas as an echo, leaving the stream at `pending` with no `[DONE]` and nothing in error. `claim_job` now grants ownership and only the consumer calls it.
- **`enqueue_sync_job` inherited ticket 09's local post-enqueue drain**, which put the scraping straight back in the API tier — invisibly, since the sync still happened. It is a `NOTIFY` the worker listens for now.
- The concurrency gate's check-then-await let a whole batch each build its own semaphore; a drain read one batch per ring, so large jobs idled through 30-second sweeps; `_fail_exhausted` failed sibling Channels; a cancel could be dropped; `_publish_progress` fired per scraped page; `_mirrored_jobs` grew unbounded; the Jobs panel and its trigger button both broke on the split.

## Testing

- `1374 passed, 2 skipped` locally, under random ordering (baseline before this branch: 1352).
- Worker boots and shuts down cleanly on SIGTERM, verified against a real database.
- New guards: `test_cross_process_progress.py`, `test_pg_notify.py`, `test_sync_lanes.py`; `test_worker_count.py` inverted for the reason that is now done. Each mutation-tested.
- Two existing guards were substring matchers a correct file could not satisfy (`run_auto_sync` contains `to_sync`) and now read identifiers.
- No frontend drift: `generate-client.sh` produces no change.

## Operator note

Native dev now needs the worker running separately (`cd backend && uv run python -m app.worker`) — see `development.md`. Without it the app comes up and silently syncs nothing. Docker is unaffected: `docker compose watch` starts the service.

🤖 Generated with [Claude Code](https://claude.com/claude-code)

https://claude.ai/code/session_016Yz4g4FNB8pVsXcezJ7eme
