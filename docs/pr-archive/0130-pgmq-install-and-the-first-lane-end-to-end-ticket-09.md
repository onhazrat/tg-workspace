# #130 🔒 PGMQ install and the first lane end to end (ticket 09)

**State:** merged 2026-08-25 · **Branch:** `worktree-ticket-09-pgmq-first-lane` into `main` · **Diff:** +3188 / -6 across 13 files · **Opened:** 2026-08-25

---

## Summary

A manual single-Channel sync (`syncMode: "individual"`) now travels through a real PGMQ queue (`manual_single_normal`) instead of an in-process `asyncio.create_task`, with progress still reaching the browser unchanged via the existing job row / SSE stream.

## What's here

- PGMQ vendored unmodified (`app/alembic/vendor/pgmq_v1.12.0.sql`, tag v1.12.0, PostgreSQL License) and installed by migration `f0a1b2c3d4e5` as plain SQL — `CREATE TABLE`/`CREATE FUNCTION`, not `CREATE EXTENSION pgmq` — so it needs neither a `postgres:18` image change nor superuser.
- `app/services/pgmq.py` — thin integration wrapper (`send`/`read`/`archive`/`delete`/`queue_length`).
- `app/services/sync_lanes.py` — one home for the six-queue naming convention (`Budget` x tier); this ticket creates only `manual_single_normal`.
- `app/jobs/manual_single_queue.py` — the consumer. An immediate post-enqueue kick handles the common case with no added latency; a periodic APScheduler sweep (30s) is the durability backstop, deliberately not a toggleable job. Visibility timeout is derived from existing retry/timeout settings (~2x the no-backfill worst case) rather than a literal. Redelivery is capped; exhausted messages are archived and the job marked failed. A process-local in-flight guard stops a redelivered message from reprocessing a job still genuinely running past its VT.
- `POST /jobs/sync` routes `syncMode: "individual"` through the queue; every other sync mode (`auto`/`bulk`/`sync_all`/`recheck_restricted`) is untouched.

## Bugs found along the way

Two surfaced only at full-suite scale (invisible in isolated test runs): a missing `session.commit()` in the read claim let two concurrent drains grab the same message, and an unreferenced `asyncio.create_task` let the event loop garbage-collect a kick mid-drain. Code review caught two more: the redelivery-while-still-running race (fixed with the in-flight guard above) and sequential (rather than concurrent) processing of a drain batch, silently un-parallelizing what used to run fully concurrent per request — fixed with `asyncio.gather`.

## Testing

- `tests/services/test_pgmq.py` — send/read/archive/delete round trip against the real lane.
- `tests/jobs/test_manual_single_queue.py` — VT derivation, terminal-job skip, exhausted-redelivery archiving, redelivery-while-running guard.
- `tests/api/test_sync_jobs.py` — new case exercising `syncMode: "individual"` end to end through the real queue via the existing polling endpoint.
- Full backend suite: 1338 passed, 2 skipped, 0 failed (`uv run pytest tests/ -q` from `backend/`).
- `bash scripts/lint.sh` — mypy strict, ty, ruff check/format all clean.

Scope is deliberately narrow — one lane, still in the web process. Tickets 10 (move the scheduler to its own process), 11 (per-Channel claim/coalescing), and 12 (the remaining five lanes) build on this; each limitation is called out in `manual_single_queue.py`'s module docstring and in the ticket file.

🤖 Generated with [Claude Code](https://claude.com/claude-code)
