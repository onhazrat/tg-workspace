# #9 Record the staging re-measurement closing the load incident

**State:** merged 2026-07-22 · **Branch:** `remeasure-bulk-follow-load` into `main` · **Diff:** +75 / -7 across 2 files · **Opened:** 2026-07-22

---

Closes the final acceptance criterion (§12) of `docs/architecture-remediation-plan.md`: re-measure staging after the `GET /posts` pagination fix and confirm the load incident is resolved.

Docs-only — no code change.

## Result

Re-ran on staging against the deployed fix. The table has *grown* since the incident (3.15M rows / 973 channels vs 2.97M / 962), so this is a harder test.

| Metric | Incident | Re-measurement |
|---|---|---|
| Peak single-worker RSS | 3.09 GB | **0.89 GB** |
| Long idle-in-transaction (>30s) | 2+ min, several | **0** |

`GET /data/posts` on the 725k-post `teteironline` channel now returns 500 rows / 198 KB by default (was ~290 MB unbounded) and rejects limits above the 5000 cap with a 422.

## Honest caveats (also in the doc)

- Load was driven directly through `GET /data/posts` rather than a UI bulk-follow, to avoid mutating staging data. That endpoint *is* the memory-critical path, so this exercises the root cause faithfully, but it is not a byte-for-byte replay of the incident trigger.
- Host load average peaked ~16.9 during the burst — that reflects deliberate synthetic over-driving (concurrency ~24 on 4 cores), not a realistic session. The RAM result is the meaningful one.

## Bearing on remaining work

With the incident closed, the unstarted plan items — step 2 (filter-semantics port), T4.1 frontend wiring, T4.2, T5.1 — are now **efficiency work, not incident remediation**. They reduce total bytes shipped to the browser but do not touch the server-side OOM shape, which is already gone.

🤖 Generated with [Claude Code](https://claude.com/claude-code)
