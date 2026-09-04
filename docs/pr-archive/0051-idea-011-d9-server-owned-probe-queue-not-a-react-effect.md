# #51 ♻️ IDEA-011 D9: server-owned probe queue, not a React effect

**State:** merged 2026-07-29 · **Branch:** `discover-server-side-probe-queue` into `main` · **Diff:** +1950 / -856 across 37 files · **Opened:** 2026-07-29

---

## Why

Discover handle-probing was orchestrated from a React effect (`useDiscoverProbeSweep`) driving a short-lived in-memory job. Three defects followed from that placement, and the first could not be fixed there at all:

1. **Closing the Discover tab stranded the report.** A sweep was capped at 400 handles and the *client* chained the next batch from its poll loop. Generate a 900-candidate report, navigate away, and 500 handles were never probed — indefinitely, silently. #50 tried to fix the chaining and could not fix this, because the chaining lived in the browser. That PR is closed unmerged; its whole diff is deleted by this one.
2. **Dedupe and stop were per-tab `useRef`s.** Two tabs re-requested the same handles, and "Stop" in one was not honoured by the other.
3. **`create_probe_job` had a check-then-act race across an `await`.** Two callers could both pass the "is a sweep running" check before either recorded one. The loser became an orphan sweep that `GET /discover/probe/active` could not see and Stop could not reach, burning proxy lanes until it finished. Reachable by a recheck click racing the auto-start effect, or just two tabs.

The tell: the server already owned the real decision — `handles_needing_probe`, with the cache check and the backoff clock — and the client was re-deriving a worse copy from a possibly stale report, then asking the server to re-filter it. That is the **D14 mistake** (one rule, two implementations, the client's copy wrong) reintroduced four workstreams later.

## What changed

`tg_discover_probes` is now the queue as well as the cache — a `status="unknown"` row *is* a work item. Two columns make it drainable without being handed a candidate list:

| Column | Purpose |
|---|---|
| `priority` | Candidate rank at enqueue; repeat enqueues take `min()`. Preserves "the rows you're reading resolve first". |
| `retry_after` | Materialized backoff deadline, so the dequeue is one indexable `WHERE` instead of recomputing per row. |

`create_report` enqueues its candidates; a scheduled `discover_probe` job drains `DISCOVER_PROBE_BATCH_SIZE` (60) per 30s tick at concurrency 2, whether or not a tab is open.

**Registering it as an ordinary scheduler job carried most of the value.** It inherits enable/disable, manual trigger and last-run status, and APScheduler's `max_instances=1` plus a module try-lock replaces the racy latch — defect 3 stops existing rather than being patched. The try-lock is load-bearing, not defensive: at batch 60 a sweep routinely outlasts the interval, and returning "already running" instantly keeps APScheduler from logging skipped-instance warnings while letting the pace self-limit to fetch latency. **Pause is now the job toggle** — durable, global, honoured by every tab.

Two subtleties worth review attention:

- **A queue entry is not an answer.** Enqueuing creates a row immediately, so `probe_map` omits never-attempted rows. Otherwise a candidate waiting its turn would read identically to one that failed three times. Pinned by `test_a_queued_candidate_still_reads_as_not_checked`.
- **Recheck had to become a requeue, not a delete.** Deleting the row was how recheck worked; under a queue model that removes the handle from the queue entirely and nothing fetches it again. Reset in place at priority 0. Pinned by `test_recheck_leaves_the_handle_in_the_queue`.

**Deleted:** `services/discover_probe_job.py`, four probe-job routes, `useDiscoverProbeSweep`, `DiscoverProbeJob` and its four API methods, and the refs. The client keeps one query with a conditional `refetchInterval`, one pure predicate (`shouldPollProbeQueue`), and two operator actions.

## Also in scope

Both were adjacent problems in files this already touched:

- **Report retention.** `tg_discover_reports` was the one table growing per user action with *no retention at all* — a full candidate blob per Generate, single-reference tail included. Now capped by age **and** count (`reportRetentionDays` 90 / `reportRetentionMax` 50, `0` disables either), in the retention `AppSetting` and surfaced in Settings → Data Retention so the disable path is reachable. **No floor guard** — policy is policy, and Discover falls back to its empty state prompting a Generate.
- **`GET /discover/probes` is paged.** It was a whole-table select on a table that is never pruned. `docs/unbounded-query-audit.md` requires new hits be bounded or justified; all three Discover tables landed after the last sweep and none were listed. Now they are (§4).

## Things to know before merging

- **Accepted regression:** reports generated before this keep whatever probe rows they have, and their never-probed handles are never queued — there is no backfill. Regenerating over the same scope enqueues them. Deliberate trade against carrying a one-shot script for a day-old feature.
- **Retention on upgrade:** on a box already holding more than 50 reports, the first retention run deletes the excess. Close to theoretical for a day-old feature, but worth saying rather than discovering.
- `alembic check` still reports drift. Pre-existing: four hand-written indexes and some JSON-nullable noise. The new composite `ix_tg_discover_probes_queue` joins that list because composite indexes in this schema are migration-only (as `ix_tg_posts_channel_name_timestamp` already is). No separate index on `priority` alone — nothing queries it without `status`.

## Verification

- Backend **722 passed, 1 skipped**; mypy clean; ruff clean; `ty` at its **31 pre-existing** diagnostics, **zero in `app/`**.
- Frontend **661 pass, 0 fail**; `tsc` clean; biome at its 3 pre-existing warnings.
- Migration round-trips (`downgrade`/`upgrade`), and the full suite passes against a **from-scratch database**.
- New coverage: `tests/jobs/test_discover_probe_sweep.py` (9 — self-directed work, batch bound, try-lock single-flight, failure isolation), `tests/jobs/test_report_retention.py` (7), `tests/api/test_discover_probe_queue.py` (7), plus queue cases in `test_discover_probes.py`. This also closes the "`discover_probe_job` has no test file" gap.
- **Not covered:** effect wiring. The repo has no `@testing-library`/`renderHook` and component tests render to static markup, so no effect, state or timer behaviour runs. Keeping the remaining client logic to one pure predicate is a deliberate response — it is the only shape that *can* be covered here, and the state machine it replaces had no coverage at all.

Manual check worth doing on local compose: generate a wide report, **close the Discover tab entirely**, wait two intervals, and confirm `GET /api/v1/data/discover/probe/queue` shows `queued` still falling. That is the defect that motivated this and the one check that proves it fixed.

🤖 Generated with [Claude Code](https://claude.com/claude-code)
