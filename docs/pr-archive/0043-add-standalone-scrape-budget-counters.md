# #43 ✨ Add standalone scrape-budget counters

**State:** closed 2026-07-28 · **Branch:** `worktree-scrape-budget-counters` into `main` · **Diff:** +628 / -1 across 13 files · **Opened:** 2026-07-28

---

Follow-on to the question raised by #42: *do we have any way to track how we spend scraping budget?*

## What exists today

The raw data is all there — it's the aggregation that's missing.

| Layer | Records | Gap |
|---|---|---|
| `tg_network_logs` | one row **per scrape request**: `url`, `duration`, `status`, `proxy_used`, `attempts` | no `channel_name`; channel only recoverable by parsing `url` |
| `tg_sync_logs` | per channel per run: `posts_count`, plus `full_request` = the run's page list | request count buried in a JSON blob |
| `NetworkTelemetry.tsx` | success rate, 429s, avg latency, direct/Tor/proxy split, per-proxy matrix | measures **health**, never **efficiency** |
| Scheduler `_job_status` | `partialCandidates`, `partialChannels` | in-memory, last run only, wiped on restart, **never rendered anywhere** |

The channels burning budget in #42 looked immaculate in that dashboard — 200s, good latency, no rate limits. They *were* healthy. They were just useless. Nothing computed requests-against-yield, and `partialCandidates` — the one number that would have shown the backlog never draining — was written to a dict nobody could see.

## Approach

Rather than hang metrics off the log tables — they exist to record events, are pruned on `logRetentionDays`, and would quietly become load-bearing for budget accounting — this is a **standalone store**. Nothing imports it except the call sites that record a number, and it imports no domain logic. Dropping the table and deleting one file removes the feature.

Being aggregates rather than rows, counters also outlive the 30-day log retention that would otherwise cap every trend question.

## Design

**`tg_counters`** — daily buckets keyed by a free-form dotted name, unique on `(name, day)`. New dimensions never need a schema change.

**Increments happen in SQL** via `ON CONFLICT DO UPDATE SET value = value + n`. Channel syncs run concurrently on separate sessions; a read-modify-write in Python would drop increments, and the undercount would be invisible. There's a test with two open sessions covering exactly this.

**Dimensioned by retrieval pass, not by channel.** Per-channel is the obvious reach but it's the expensive one — thousands of channels × metrics × days — and it isn't what catches this bug class. This does, at trivial cardinality:

```
scrape.requests.backfill  ↑↑↑     scrape.posts.backfill  ≈ 0
```

That divergence *is* the pathology. Because the name is just a string, per-channel keys remain possible later without a migration.

**Counters vs gauges.** `bump()` accumulates within a day; `set_gauge()` overwrites. `autosync.partial_candidates` is a backlog, not a rate — summing it across days would be meaningless, so `summarize()` takes the most recent reading for gauges and sums for counters.

## Surface

- `app/services/counters.py` — `bump`, `set_gauge`, `read_counters`, `summarize`, `prune_counters`
- Four one-line call sites: request/post counts by pass and empty-page count in the orchestrator, `partial_candidates` gauge in auto-sync
- `GET /api/v1/data/counters?days=&prefix=&daily=` — totals by default, day buckets opt-in for charting
- Pruned at 365 days from the existing retention job. A constant rather than a setting, to keep the module free of config coupling

**No UI.** The endpoint comes first; a panel once the numbers prove they're worth looking at.

## Verification

- `626 passed, 1 skipped` — full backend suite.
- 13 new tests, including the concurrency property, gauge-vs-counter semantics, window boundaries, and pruning.
- End-to-end: `test_sync_records_request_and_post_counters` drives a real sync job through a mocked scraper and asserts `scrape.requests.initial == 1` / `scrape.posts.initial == 2` — the instrumentation is proven wired, not just unit-tested.
- One test guards `bucket_days_ago` specifically: I first wrote the window as `today_bucket() - days * 100`, which walks *months* on a YYYYMMDD integer and silently widened every window ~30x. It's real date arithmetic now, with a test pinning three known values.
- mypy, ruff, biome clean; `bunx tsc --noEmit` clean; `ty` at 53 diagnostics — unchanged from the `main` baseline.
- Client regenerated via `scripts/generate-client.sh`; the diff is additive only (60 lines, just the new route).
- `tg_counters` added to `TG_TABLES` so test teardown truncates it.

## ⚠️ Merge order

This branches from `r0s1t2u3v4w5`, **the same Alembic head as #42**. Whichever merges second needs its migration's `down_revision` repointed at the other, or Alembic will report multiple heads. Noted in the migration docstring too.

🤖 Generated with [Claude Code](https://claude.com/claude-code)


## Comments

### onhazrat on 2026-07-28

Closing — the design needs more thought before this lands.

Main open question is the dimensioning: counters are keyed by retrieval pass only, so they show *that* backfill burns requests without yield, but not *which* channels. Per-channel attribution likely wants to be a real indexed column rather than a string-key convention.

Branch `worktree-scrape-budget-counters` is kept, so the work is recoverable if we pick this up again.
