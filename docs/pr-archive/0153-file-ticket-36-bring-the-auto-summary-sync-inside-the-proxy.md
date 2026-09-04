# #153 📋 File ticket 36: bring the auto-summary sync inside the proxy partition

**State:** closed 2026-09-02 · **Branch:** `worktree-ticket-36-and-stale-docstrings` into `main` · **Diff:** +103 / -0 across 2 files · **Opened:** 2026-08-29

---

Files ticket 36 for a gap that has been tracked only in a session tracker since ticket 13. Documentation only — one ticket file and its docs-index entry, no code, no tests, no migration.

## What it is

`jobs/auto_summary.py::_sync_channels_for_summary` calls `sync_orchestrator.run_sync_job` directly (line 155) instead of `enqueue_sync_job`. It never enters a lane, is never dealt a worker by `proxy_pool.build_workers`, and gates itself on its own `asyncio.Semaphore(concurrency)` (`sync_orchestrator.py:1951`). It runs in the same worker process as the lane consumer, so the two limits add rather than compose.

It calls `run_sync_job` for a real reason — the summary cannot regenerate until the sync finishes — which is why tickets 10 through 13 each left it alone.

## Why the forward reference expired

`jobs/sync_queue.py:42-47` closes this caveat with *"Ticket 13's one-worker-per-proxy partitioning is what makes that distinction stop mattering."* Ticket 13's author retracted that, and CLAUDE.md records it as wrong in both halves: the per-proxy **rate** was never at risk here (every proxied `fetch_with_retry` has always taken a lane permit), and the **channel** concurrency is still outside the partition because this path is never dealt a worker.

That docstring still asserts the retracted claim on `main`. Correcting it is one of the ticket's checkboxes rather than a drive-by fix, so it lands with the work it describes.

## The ticket does not pick the design

Two routes preserve the synchronous requirement: enqueue onto a lane and await the job's completion (the machinery exists — `_finalize_if_complete`, `pg_notify`), or hand the path a bound worker directly from `proxy_pool` without a lane. Both are defensible; the ticket requires whichever loses to be written down.

## Verified before filing

`run_sync_job` at `auto_summary.py:155`; the semaphore at `sync_orchestrator.py:1951`; the stale caveat at `sync_queue.py:42-47`.

🤖 Generated with [Claude Code](https://claude.com/claude-code)

https://claude.ai/code/session_015sT3u1i9aTtYfkfxHkuE2o



## Comments

### onhazrat on 2026-09-02

Superseded by #166, which rebases this onto current `main`.

This branched from `3f4386e` and twelve commits have landed since, several of them editing `docs/multi-user-tenancy-tickets.md`, so it no longer merges. #166 carries the same ticket with line references re-verified against `24aaca6` (`auto_summary.py:167`, `sync_orchestrator.py:2127`, `sync_queue.py:47`) plus a note that ticket 24's per-Channel ceiling now bounds this path, which narrows the risk without closing the ticket.
