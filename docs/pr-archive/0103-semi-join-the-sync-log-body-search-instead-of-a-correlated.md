# #103 ⚡ Semi-join the sync-log body search instead of a correlated EXISTS

**State:** merged 2026-08-19 · **Branch:** `perf/log-search-semijoin` into `main` · **Diff:** +19 / -8 across 1 files · **Opened:** 2026-08-19

---

Follow-up to #102, from measuring the endpoint after it deployed.

`searchInDetails` was an `EXISTS (… WHERE p.sync_log_id = l.id …)`, which Postgres evaluates once per candidate row of `tg_sync_logs` — so it scaled with the log table (191k rows) rather than with the payloads being searched. `IN (SELECT …)` runs the ILIKE once over the payload table and semi-joins.

**Measured on staging: 5.81 s → 4.54 s**, with a plan that no longer probes per log row.

The gain is modest because the join was never the bottleneck. The plan shows 30,532 buffers on a seq scan of `tg_sync_log_payloads` — the cost of detoasting ~5,700 bodies to match them. Searching bodies means reading them; that is inherent, it is why this sits behind a checkbox, and it is why nothing else on the read path pays it.

I originally wrote "5.07s → 0.10s" in the comment before measuring. It was wrong, and the committed comment carries the real numbers.

955 backend tests pass; mypy, ty and ruff clean.

🤖 Generated with [Claude Code](https://claude.com/claude-code)
