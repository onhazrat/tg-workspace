# #110 ⚡ Delete expired sync jobs in bounded transactions

**State:** merged 2026-08-19 · **Branch:** `perf/sync-job-prune-batched` into `main` · **Diff:** +103 / -9 across 2 files · **Opened:** 2026-08-19

---

Follow-up to #109, prompted by the real size.

I quoted `tg_sync_jobs` as 153 MB from `pg_relation_size`. `pg_total_relation_size` is **871 MB** — `channels` is TOASTed and the heap figure hides it.

That changes the shape of the first run: ~180k expired rows, and one DELETE across 871 MB of TOAST is a transaction held for however long it takes. A long transaction pins the xmin horizon so autovacuum reclaims nothing while it runs — the exact failure fixed in #105 hours ago, where `run_auto_sync` held a session across the sync and left `tg_sync_meta` with 10 live rows and 4,743 dead.

Deletes are now batched, each batch its own transaction. **Not for memory** — only ids are selected, so the JSON is never loaded. Purely to keep transactions short enough that vacuum keeps pace with the deletes rather than queueing behind them.

Three more mutations watched go red:
- revert to one unbounded DELETE
- break out of the loop after one pass (leaves a backlog, silently)
- default batch size large enough that batching is real in tests and absent in production

1005 passed, 2 skipped; mypy/ruff/ty clean.

Note: the branch commit is unsigned — 1Password failed twice mid-session. Per CLAUDE.md that is only a blocker for direct-to-`main`; the squash merge is what GitHub signs.

🤖 Generated with [Claude Code](https://claude.com/claude-code)
