# #166 📋 File ticket 36: one concurrency owner — fan run_sync_job out over the partition

**State:** merged 2026-09-02 · **Branch:** `worktree-ticket-36-rebase` into `main` · **Diff:** +146 / -0 across 2 files · **Opened:** 2026-09-02

---

Files ticket 36. Documentation only — one ticket file and its docs-index entry, no code. Replaces #153, which branched from `3f4386e` and stopped merging after twelve commits landed on the docs index.

## The finding, restated after reading both mechanisms

There are **two independent answers** to "how many Channels may this process scrape at once", they read the same setting, and they **add**.

- **The drain loop** takes a bound worker from the partition per message (`sync_queue.py:1264`, `partition.acquire(...)`) and runs one `sync_single_channel` under it — ticket 13's design, pinned for the whole message so a walk never hops proxies.
- **`run_sync_job`** opens its own `asyncio.Semaphore(concurrency)` (`sync_orchestrator.py:2127`) and `gather`s every Channel under it. Those fetches are dealt no worker, so each picks a lane freely page by page — the hopping ticket 13 removed, still live on this path.

`sync_queue.py:25` already states the rule this ticket enforces: *"Concurrency belongs to the worker, not to the job."* It was applied to the queue path and not to `run_sync_job`.

**The codebase documents the consequence already.** `_run_whole_job` (`sync_queue.py:977`) holds its partition permit around a job that ignores it, so the worker runs **2N scrapes against Telegram instead of 2N−1** — and the docstring adds *"Neither number is good."* That note is the bug report; this ticket is the fix.

## Scope widened from one caller to three

`RUN_SYNC_JOB_CALLERS` declares every path starting a sync outside `enqueue_sync_job`: `_run_whole_job`, `auto_summary._sync_channels_for_summary` (`auto_summary.py:167`), and `bulk_follow.run_follow_job`'s probe phase. All three share the defect. The first draft of this ticket named only `auto_summary`, because that is where the tracker note came from — fixing it alone leaves two paths doing the identical thing.

## Decided, rather than left open

`run_sync_job` keeps what only it can do — open the quota meter and charge once at completion — and loses the semaphore, fanning out by acquiring a partition worker per Channel. The partition becomes the single gate, and a second gate can only disagree with it.

Expected and stated rather than discovered: on these paths peak concurrency **drops**, because work that ran `N` unbound scrapes now competes for the same `N` workers as lane traffic. That is ticket 13's "capacity honestly reflects available proxies", not a regression.

## The option that lost

**Enqueue onto a lane and await completion** is the tidier story and is rejected on behaviour. A lane subjects the work to ticket 23's tier ladder, so an over-Budget account's auto-summary sync lands on a best-effort lane served only when every normal lane is empty — the summary then regenerates on stale input or waits indefinitely. That is a behaviour change nobody asked for, introduced while fixing an accounting bug. Secondarily it reintroduces ticket 11's question: a waiter holding what the drain needs is the deadlock `SyncSlot.released()` exists for.

Ticket 24's per-Channel `assert_within_ceiling` already bounds all three paths in **volume**; this ticket is about which worker performs the work, which the ceiling says nothing about.

🤖 Generated with [Claude Code](https://claude.com/claude-code)

https://claude.ai/code/session_011DXvqCaucaXSrcB9ZKBvbD
