# #104 ⚡ Stop the scheduler tick counting 4.5M posts to schedule six channels

**State:** merged 2026-08-19 · **Branch:** `perf/scheduler-db-cost` into `main` · **Diff:** +936 / -35 across 10 files · **Opened:** 2026-08-19

---

`pg_stat_statements` found what the edge log cannot see. Every endpoint was under a second after the last two rounds — and the auto-sync tick was still spending **69 minutes of database time and 76M block reads per 10 hours**, ~11% of a core, continuously. Nothing in the top ten by total time was a request.

| calls | total | mean | blks_read | statement |
|---:|---:|---:|---:|---|
| 2,189 | **69 min** | 1,890 ms | 76.2 M | stats `GROUP BY` aggregate |
| 181,879 | 19 min | 6 ms | 1,963 | `UPDATE tg_sync_meta SET etag` |
| 94,994 | 7.5 min | 5 ms | 270,487 | `UPDATE tg_sync_jobs SET channels=<json>` |

## The stats batch — 69 min

`auto_sync` computed `count(*)`, `min(post_id)` and `max(post_id)` across 4.54M posts for all 2,077 channels every 60 seconds, and read two values: `has_posts` and `velocity`. `min_id`/`max_id` were discarded outright; `has_posts` is a boolean answered by a full count.

The interesting part is not that the aggregate is wasteful — it is that almost no channel needed the answer. Those fields are read only by `_is_dynamic_eligible`, reached only from `_is_dynamic_due`, so a channel whose dynamic deadline is still in the future is decided identically whatever the stats say:

| | channels |
|---|---:|
| stats computed every tick | 2,077 |
| dynamic-enabled, not frozen | 1,762 |
| …with a *future* dynamic deadline | 1,756 |
| **whose due-ness can actually depend on stats** | **6** |

So no `post_count` column and no migration — which is where this was heading before the numbers came in. `sync_schedule.needs_dynamic_stats` lives next to the rule it mirrors, not in the caller: split across two files, the next condition added to `_is_dynamic_due` silently stops being reflected in what the caller bothers to fetch. It deliberately does **not** short-circuit on `is_frozen`, so its guarantee holds for `due_reason` standalone rather than only behind `is_channel_due` — and a frozen group disables both sync modes, so that costs nothing.

## The job row — 7.5 min, 94,994 writes

`_persist_job` rewrites the entire channel array to record one entry, and a per-channel status change forced a flush: quadratic in job size, with whole-table jobs the normal case here. `get_job` serves live jobs from memory, so the row is crash recovery — the interval already governing `postsFetched` staleness governs statuses too. Terminal and job-level transitions still write immediately.

## The etag — 19 min, 181,879 writes

Every `sync_orchestrator` site was `session.commit()` followed by `touch_sync` committing again. Deferring the bump into the caller's transaction halves the fsyncs and fixes a real bug: split across two commits, a crash between them leaves the data written and the etag stale — and a stale etag does not heal, it tells every client there is nothing to refetch.

## Guards

Each mutation-tested until red. The narrowing guard checks the safety property over the **whole** input space, because getting it wrong in that direction stops syncing a channel with no error and no log — 144 stats-independent shapes × 4 stats values.

Seven mutations were watched fail. An eighth — changing the stub `_schedule_view` substitutes — **passed everything**, so `test_the_skipped_channels_are_scheduled_with_the_stats_this_file_proved_safe` was added to tie the guard's premise to the running code.

## Not in this change

The `tg_channels` single-row UPDATEs: `SET subscribers` at 399 ms mean on 112 block reads, `SET links` at 380 ms on 31. Near-zero I/O means waiting, not working, and the rarer the statement the slower it is — not what a bad plan looks like. The standing hypothesis is that it is downstream of the 277k commits/10h the other two items were making, so it gets diagnosed after this deploys rather than pre-emptively indexed.

## Verification

976 passed, 2 skipped; mypy/ruff/ty clean. Plan and measurements in `docs/scheduler-db-cost-plan.md`. Post-deploy: reset `pg_stat_statements` and re-measure the same window.

🤖 Generated with [Claude Code](https://claude.com/claude-code)
