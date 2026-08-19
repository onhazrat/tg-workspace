# The scheduler tick costs more than every endpoint combined

## How this was found

The three monitoring layers added on 2026-08-19 (`deployment.md` → **Finding slow
endpoints**) were built to find slow *endpoints*. Two rounds of that worked —
`/data/summaries` and `/data/logs/sync` — and after them the Traefik log showed
nothing above a second except `/data/channels/stats`:

```
 total(s)   count     mean    meanKB  path        (19/Aug 04:20–08:48, 286 requests)
     13.5      76      178       0.6  /jobs/status
     10.5      84      126       0.0  /telegram/channel-photo/{id}
      8.3       5     1662      31.8  /data/channels/stats
      4.1       5      820     175.2  /data/channels
```

`pg_stat_statements` disagreed about where the database's time actually goes. Over
one ~10 h window:

| calls | total | mean | blks_read | statement |
|---:|---:|---:|---:|---|
| 2,189 | **69 min** | 1,890 ms | 76.2 M | `SELECT channel_name, count(*), min(post_id), max(post_id) … GROUP BY` |
| 181,879 | 19 min | 6 ms | 1,963 | `UPDATE tg_sync_meta SET etag` |
| 53,292 | 9.5 min | 11 ms | 7,925 | `UPDATE tg_channels SET anchor_post_id` |
| 94,994 | 7.5 min | 5 ms | 270,487 | `UPDATE tg_sync_jobs SET channels=<json>` |
| 2,189 | 7.4 min | 203 ms | 7.1 M | the velocity LATERAL |
| 703 | 4.7 min | **399 ms** | **112** | `UPDATE tg_channels SET subscribers` |
| 4,850 | 2.9 min | 35 ms | 527 | `UPDATE tg_channels SET last_updated, next_regular_sync_at` |
| 197 | 1.2 min | **380 ms** | 31 | `UPDATE tg_channels SET links` |

**The lesson worth keeping: the edge log cannot see this at all.** Nothing in the
list above is a request. Layer 1 answers "which endpoint is slow", layer 3 answers
"what is the database actually doing", and after two rounds where the answer was the
same, it was tempting to stop at layer 1.

## 1. The tick computes 2,077 channels' stats to read six of them

`jobs/auto_sync.py:57` runs `compute_channel_stats_batch` over every channel on every
scheduler tick (`AUTO_SYNC_CHECK_INTERVAL_SECONDS = 60`) and uses exactly two values
out of it:

```python
has_posts=int(stats.get("count") or 0) > 0,
velocity=float(stats.get("velocity") or 0.0),
```

`min_id` and `max_id` are computed and discarded, and `has_posts` — a boolean — is
answered by `count(*)` over 4.54 M rows in a 5.9 GB table. That is 76 M block reads
and 69 minutes of database time per 10 hours: **roughly 11 % of a core, burning
continuously, forever.**

The important part is not that the aggregate is wasteful. It is that **almost none of
the channels need the answer at all.** `sync_schedule` only reads `has_posts` and
`velocity` inside `_is_dynamic_eligible`, which is only reached from `_is_dynamic_due`:

```
dynamic_due = dynamic_sync_enabled AND has_posts AND velocity > 0
              AND (next_dynamic_sync_at is None OR now >= next_dynamic_sync_at)
```

If `dynamic_sync_enabled` is false, or the channel is frozen, or its dynamic deadline
is still in the future, `dynamic_due` is false **whatever the stats say** — and
`dynamic_due` is the only output that depends on them. Measured on staging:

| | channels |
|---|---:|
| stats computed every tick | 2,077 |
| frozen | 312 |
| dynamic-enabled, not frozen | 1,762 |
| …with a *future* dynamic deadline | 1,756 |
| **whose due-ness can actually depend on stats** | **6** |

So this needs no denormalised `post_count` column, no new table, and no migration —
which is where this was heading before the numbers came in. It needs the caller to
stop asking.

### The change

- `services/sync_schedule.py` — add `needs_dynamic_stats(channel, now_ms) -> bool`,
  next to `_is_dynamic_due`, deriving from the same conditions. It lives in the pure
  module *specifically* so the predicate and the rule it mirrors cannot drift apart in
  separate files.
- `jobs/auto_sync.py` — build the schedule view in two passes: one with stub stats to
  find the channels the predicate flags, then `compute_channel_stats_batch` over only
  those, then the real decision.

### The guard

`tests/services/test_sync_schedule_stats_narrowing.py`, asserting **the reason, not
the state** (per `CLAUDE.md`, and following `client-split.conform.ts`):

1. **Exhaustive equivalence.** Over the full cross product of `is_frozen` ×
   `regular_sync_enabled` × `dynamic_sync_enabled` × `next_regular_sync_at` ×
   `next_dynamic_sync_at` × `has_posts` × `velocity`: wherever `needs_dynamic_stats`
   is false, `due_reason` and `is_channel_due` must return **the same answer for every
   stats value** as they do for the stub. This is the safety property, and it is
   checked over the whole input space rather than at sampled points.
2. **The predicate is not vacuously false.** A `return False` implementation would
   pass (1) only by breaking the cases that genuinely do depend on stats, so those are
   pinned separately.
3. **The predicate is not vacuously true.** `return True` restores the original cost
   while passing every correctness test, so the SQL is counted: one `run_auto_sync`
   over N channels where only k need stats must issue the aggregate against k names,
   not N.

## 2. A 2,000-entry JSON array rewritten to change one entry

`UPDATE tg_sync_jobs SET channels=<json>` — 94,994 calls, 7.5 min, 270 k blocks.

`scraper_jobs._should_flush_db` flushes whenever *any* channel's status changes, and
`_persist_job` serialises the **entire** channel map to do it. A job covering 2,000
channels goes through ~3 status transitions each, and every one rewrites the whole
array: quadratic in job size, and a full-table job is the normal case here.

The row is only the SSE reconnect fallback — live progress goes over the stream — so
non-terminal flushes can be throttled by `SYNC_JOB_PERSIST_INTERVAL_MS` (5 s) like
the no-change case already is. Terminal statuses and job-level status changes keep
flushing immediately.

## 3. 181,879 etag commits

`services/sync_meta.touch_sync` does `SELECT` + `UPDATE` + `COMMIT` per call, and
`sync_orchestrator` calls it from eleven places across the per-channel paths
(`channels`, `sync_logs`, `posts`, `network_logs`), so a single channel sync commits
that table several times over.

Coalescing has to respect what `a3-etag-two-jobs` records: logs need
invalidate-on-write, channels need the refetch suppressed. So this is *deduplication
within a unit of work*, never a delay or a coarser granularity.

## 4. Every `tg_channels` UPDATE waits

| statement | calls | mean | blks_read |
|---|---:|---:|---:|
| `SET anchor_post_id` | 53,292 | 11 ms | 7,925 |
| `SET last_updated, next_regular_sync_at` | 4,850 | 35 ms | 527 |
| `SET links` | 197 | 380 ms | 31 |
| `SET subscribers` | 703 | 399 ms | 112 |

Single-row updates by primary key, with essentially no I/O — so the time is spent
waiting, not working. Note the direction: the **rarer** the statement, the slower it
is, which is not what a bad plan or a missing index looks like.

The standing hypothesis is that this is a *symptom* rather than a cause: items 2 and 3
together commit 277 k times per 10 hours — 7.7 fsyncs a second, sustained — and
anything landing behind that queue waits. **Diagnose after 1–3 are deployed**, since
the fix for the others may remove it. Do not pre-emptively add an index here.

## Landing

PR + squash merge (GitHub signs the landing commit). Local 1Password signing is
currently failing, and `CLAUDE.md` is explicit that a direct-to-`main` signing failure
is a blocker to raise rather than bypass with `gpgsign=false`.

## Verification

```bash
cd backend && uv run pytest tests/ -q          # TEST_POSTGRES_DB=... if another worktree is live
cd backend && bash scripts/lint.sh
```

Mutation-test each guard by hand before trusting it — `CLAUDE.md` records six false
passes caught that way, and two more in the summaries round.

After deploy, reset the counters and re-measure the same window:

```sql
SELECT pg_stat_statements_reset();
-- ~1h later
SELECT calls, round(total_exec_time) ms, round(mean_exec_time) mean, shared_blks_read, left(query,90)
FROM pg_stat_statements ORDER BY total_exec_time DESC LIMIT 12;
```

Expected: the aggregate drops out of the top of the list entirely (2,189 calls over
2,077 names → the same call count over ~6), and `tg_sync_jobs` writes fall by roughly
the ratio of status transitions to 5 s windows.
