# Move Discover handle-probing server-side — plan

**Date:** 2026-07-30
**Status:** ✅ DONE — shipped in PR #51 (`5d58b1a`), staging deploy green. Verified:
backend 722 passed / 1 skipped, mypy + ruff clean, `ty` at its 31 pre-existing
diagnostics (zero in `app/`); frontend 661 pass / 0 fail, `tsc` clean, biome at
its 3 pre-existing warnings; migration round-trips and the full suite passes
against a from-scratch database.

> **Where to read what.** The *narrative* — what shipped, both reversals, the
> verdict rule, known limits — lives in
> [`ideas-log/ideas/IDEA-011-discover-tab-refinement.md`](ideas-log/ideas/IDEA-011-discover-tab-refinement.md)
> under **D9**. This document is the plan the work was executed from, kept for the
> parts that do not belong in an idea log: **the decisions and the alternatives
> rejected** (§2), and **the architectural survey done alongside it** (§5), which
> is a live list of work still outstanding.

---

## 1. The problem this solved

D9 originally put "which handles still need probing, and when does a sweep start"
in a React effect (`useDiscoverProbeSweep`) driving a short-lived in-memory job.
Three defects followed from that placement, and the first could not be fixed
there at all:

1. **Closing the Discover tab stranded the report.** A sweep was capped at 400
   handles and the *client* chained the next batch from its poll loop. Generate a
   900-candidate report, navigate away, and 500 handles were never probed —
   indefinitely, silently. PR #50 tried to fix the chaining and could not fix
   this, because the thing chaining the batches lived in the browser. That PR was
   closed unmerged; its whole diff was deleted by #51.
2. **Dedupe and stop state were per-tab `useRef`s.** Two tabs re-requested the
   same handles, and "Stop" in one was not honoured by the other.
3. **`create_probe_job` had a check-then-act race across an `await`.** Two callers
   could both pass the "is a sweep running" check before either recorded one. The
   loser became an orphan sweep that `GET /discover/probe/active` could not see
   and Stop could not reach, burning proxy lanes until it finished. Reachable by a
   recheck click racing the auto-start effect, or simply by two tabs.

**The tell**, and the thing worth remembering: the server already owned the real
decision — `handles_needing_probe`, with the cache check and the backoff clock —
and the client was re-deriving a worse copy of it from a possibly stale report,
then asking the server to re-filter the result. That is the same **D14** mistake
(one rule, two implementations, the client's copy wrong) reintroduced four
workstreams after D14 deleted it. Two implementations of one decision is the
smell; which side is "authoritative" is not the question, because the duplicate
will drift regardless.

---

## 2. Decisions, and what was rejected

Everything here was chosen deliberately. The rejected column is the point of
keeping this document.

| Decision | Chosen | Rejected, and why |
|---|---|---|
| **Queue shape** | Two columns on `tg_discover_probes` (`priority`, `retry_after`). The cache and the work item are the same row. | *A separate `tg_discover_probe_queue` table* — costs a join on every dequeue and creates a second place a handle can exist, with the drift risk that implies. *No new columns*, filtering a bounded superset in Python — loses rank ordering entirely and the superset multiplier is guesswork when many rows are backing off. |
| **Enqueue point** | `create_report` only. Candidates are already ranked and server-side, so drain order comes for free. | *Topping up from recent reports each tick* — re-parses candidate blobs on a timer for work almost always already done. *Lazy enqueue on report read* — makes a read path write, and reading an old archived report would queue work nobody asked for. |
| **Throughput** | 60 handles per 30s tick, concurrency 2 (below bulk-follow's 4). | Slower (15/60s) felt stale on first view; the sweep it replaced did 400 in one burst, which is heavier on the proxy pool than the steady drain. |
| **Sweep trigger** | The scheduler, and *only* the scheduler. No `asyncio.create_task` from routes. | *Kicking `trigger_job` after Generate/recheck* for sub-second start — rejected in favour of one code path with nothing ad-hoc able to start work. Cost: up to one interval of latency after a recheck, accepted. |
| **Single-flight** | Module `asyncio.Lock`, checked non-blockingly. | A lock is not optional here: APScheduler's `max_instances=1` covers the scheduled trigger but **not** `POST /jobs/{id}/trigger`, which calls the runner directly. And at batch 60 a sweep routinely outlasts the 30s interval — returning "already running" instantly keeps APScheduler from logging skipped-instance warnings and lets the pace self-limit to fetch latency. |
| **Old routes** | Deleted all four (`POST /discover/probe`, `…/active`, `…/{id}`, `…/{id}/cancel`). | *Deprecated shims* returning a synthetic job — keeps alive the exact abstraction being removed, for no consumer. |
| **Progress** | Global queue counts: four indexed `COUNT(*)`s. | *Report-scoped progress* — needs the report's handle set per poll, i.e. re-parsing a multi-megabyte candidate blob every 4s, or a denormalised `handles` column. In practice the queue is dominated by the newest report anyway, since a resolved handle never re-enters it. |
| **Pause** | The ordinary job toggle (`PUT /jobs/discover_probe`). | *A Discover-local `AppSetting`* — a second toggle doing what the job toggle already does. *No control at all* — defensible for a gentle drain, but the operator should be able to stand it down when a sync matters more. |
| **Recheck priority** | Priority 0 — next tick. | *Normal rank* — could sit behind 15 minutes of a fresh wide report, and a deliberate click with no visible effect reads as broken. |
| **Failing handles** | Retry forever at the 24h backoff ceiling. | *Giving up after N attempts* — reaches a true empty queue and stops costing anything, but needs a visible "gave up on N handles" affordance or it becomes precisely the silent-hiding failure the verdict rule exists to prevent. Consequence accepted: `retrying` may never reach zero, which is why the progress bar keys off `queued` alone. |
| **Pre-existing reports** | Nothing. No backfill. | *A one-shot `--dry-run` script* — dead code the day after it runs. *A "check remaining handles" button* — a clean fit for the architecture, but unnecessary UI for a day-old feature. |
| **Report retention** | Age **and** count caps (`reportRetentionDays` 90, `reportRetentionMax` 50), `0` disables either, **no floor guard**. | *Age only* — does not bound size; a burst of reports in one afternoon survives in full. *A floor of 1 or 5* — would keep a report the operator's own policy said to delete. Disabling with `0` is the opt-out instead. |

### Two subtleties the tests now pin

Both were got wrong first and caught by the suite.

- **A queue entry is not an answer.** Enqueuing creates a row immediately, so
  `probe_map` omits never-attempted rows (`attempted_at IS NULL`). Without that
  filter a candidate waiting its turn renders identically to one that failed
  three times. Pinned by `test_a_queued_candidate_still_reads_as_not_checked`.
- **Recheck had to become a requeue, not a delete.** Deleting the row was how
  recheck worked before; under a queue model that removes the handle from the
  queue entirely and nothing ever fetches it again — a recheck that looks like it
  worked and then silently never resolves. The row is reset in place at priority
  0. Pinned by `test_recheck_leaves_the_handle_in_the_queue`.

---

## 3. What the shape ended up being

```
create_report ──enqueue_handles(ranked)──▶ tg_discover_probes
                                            status='unknown', priority=rank
                                                      │
                          scheduled job (30s) ────────┤ dequeue_handles(limit=60)
                          app/jobs/discover_probe.py  │   WHERE status='unknown'
                          _sweep_lock, semaphore(2)   │     AND retry_after <= now
                                                      │   ORDER BY priority, handle
                                                      ▼
                                            record_probe_result
                                              ok / unavailable → verdict, cached
                                              anything else    → unknown + backoff
                                                      │
report read ──probe_map()──▶ candidate.probe ◀────────┘
                             (never-attempted rows omitted)
```

The client's entire remaining role: one query with a conditional
`refetchInterval`, one pure predicate (`shouldPollProbeQueue`), one invalidation
effect keyed on `resolved + unavailable`, and two operator actions.

**Key files.** `backend/app/jobs/discover_probe.py` (new),
`backend/app/services/discover_probes.py` (`enqueue_handles`,
`dequeue_handles`, `queue_counts`, `requeue_probes`),
`backend/app/alembic/versions/x6y7z8a9b0c1_probe_queue_columns.py`,
`frontend/src/hooks/useDiscoverProbeQueue.ts`,
`frontend/src/components/discover/DiscoverProbeBar.tsx`.
**Deleted:** `backend/app/services/discover_probe_job.py`,
`frontend/src/components/discover/useDiscoverProbeSweep.ts`.

---

## 4. Verification

```bash
cd backend && uv run alembic upgrade head
cd backend && rtk proxy "uv run pytest tests/ -q"
cd backend && uv run mypy app && uv run ty check && uv run ruff check . \
  && uv run ruff format --check .

bun run --filter tg-summarizer-frontend test:unit
cd frontend && bunx tsc -p tsconfig.build.json --noEmit
bun run lint
```

**The one behavioural check that matters**, on local compose only — staging stays
read-only:

1. `docker compose up -d db prestart backend` (green `prestart` proves the
   migration applied).
2. Generate a wide Discover report. `GET /api/v1/data/discover/probe/queue` shows
   a non-zero `queued` immediately.
3. **Close the Discover tab entirely.** Wait two intervals. `queued` must still
   be falling — this is the defect that motivated the change and the only check
   that proves it fixed.
4. `PUT /api/v1/jobs/discover_probe {"enabled": false}` stops the drain; confirm a
   second tab sees the pause.
5. Restart the backend mid-drain: verdicts already written survive, the queue
   resumes next tick, nothing 404s.

### Known gaps in coverage

- **Effect wiring is untested.** The repo has no `@testing-library` or
  `renderHook`, and component tests use `renderToStaticMarkup`, so no effect,
  state or timer behaviour runs. Keeping the remaining client logic to one pure
  predicate is a deliberate response — it is the only shape that *can* be covered
  here, and the state machine it replaced had none.
- **`alembic check` reports drift**, pre-existing: four hand-written indexes and
  JSON-nullable noise. The new composite `ix_tg_discover_probes_queue` joins that
  list because composite indexes in this schema are migration-only (as
  `ix_tg_posts_channel_name_timestamp` already is).
- **The junk-handle ratio was never measured** before building D9; it was scoped
  on the operator's observation. The queue's `resolved` / `unavailable` counts now
  make it observable.

---

## 5. Architectural survey — outstanding work

Found while planning this change. **None of it is fixed by PR #51** unless noted.
Ordered by risk.

### P0 — `bulk_follow` job state is unrecoverable

`backend/app/services/bulk_follow.py:129` holds the entire job in memory with no
persistence, unlike sync jobs which mirror to `tg_sync_jobs`. A restart mid-job
leaves some channels followed, some not, **no record of which**, a chained sync
running for the followed subset, and a client
(`frontend/src/contexts/ScraperContext.tsx:853-900`) polling a 404 until it times
out with "Follow job timed out". No resume path, and no way to ask what the job
actually did — the only durable evidence is the channel rows themselves.

The probe half degraded gracefully by comparison, because verdicts were written
per-handle. Bulk follow does not. `scraper_jobs.py:249-256` has the pattern to copy:
DB mirror with write throttling, plus rehydration from the row on cache miss.

### P1 — no startup reconciliation of `tg_sync_jobs`

Rows left `running`/`pending` when the process dies stay that way forever
(`backend/app/main.py:32-40`). The in-memory guard (`has_active_sync_job`)
recovers correctly, so this is confusing rather than dangerous. Cheap fix.

### P1 — `tg_summaries` and `tg_tag_runs` still have no retention

Same shape as the reports table PR #51 fixed. Not addressed.

### P2 — `useSyncQueue.ts:51-107` is the same disease in another tab

A `useEffect` implementing a concurrency-limited work queue: it slices
`concurrency - processingIds.size` items and mutates two pieces of React state in
the `finally`, re-arming itself on each completion. It dies on reload, its
concurrency limit is **per-tab** (two tabs = 2× load against a backend with its
own single-instance guard), and a failed channel is `console.error`'d and silently
dropped with `onComplete` never called.

This is the natural next application of the PR #51 pattern. Worth letting #51 run
on staging first, so what gets ported is proven rather than merely argued.

### P2 — `_active_jobs` is never evicted in `bulk_follow`

`scraper_jobs.py:278` has `deactivate_job()`; `bulk_follow` has no equivalent, so
every job stays resident for the process lifetime. On an always-on box that is a
slow unbounded leak. PR #51 deleted the probe half of this problem.

### P2 — residual client/server duplication, two undocumented instances

`post_filters.py` names its TS mirrors deliberately, so that pair is a known
cost. Not documented, and both are live D14-style drift risks:

- **The random-cap seed derivation genuinely differs.**
  `frontend/src/components/DiscoverView.tsx:61` hardcodes `RANDOM_CAP_SEED = 0`
  for the server, while `applyMaxPostsPerChannel` derives its own seed from
  `channel:start:end:limit:channels`. Counts happen to agree in the semantic path
  because both cap; "the cap selects the same posts the Posts tab shows" is only
  true server-side.
- **The candidate sort tie-break differs.** Codepoint order in Python
  (`c["name"]`) vs `localeCompare` in TS. Server-sorted and client-re-sorted lists
  can differ for non-ASCII handles. The client re-sort is also redundant for the
  default key.

### P2 — semantic-scoped reports silently see ≤50 posts

`frontend/src/lib/posts/scoped-posts.ts:94` hardcodes
`searchSimilarPosts(query, 50)`, so a semantic report aggregates over at most 50
posts regardless of how wide the channel/date scope is. `scopedPostCount` records
it, but nothing in the UI explains the number is a hard RAG cap rather than a
property of the corpus.

### P3 — ADR-004 documents the least consequential single-process assumption

It covers the APScheduler instance. Undocumented and equally single-process:
`jobs/scheduler.py:41` `_job_status` (job history resets on restart),
`services/network.py:27` `_bad_proxies` (cooldowns lost, bad proxies retried
immediately after a deploy), `services/proxy_pool.py:102,188` (concurrency limits
are per-process), `services/embeddings.py:18` (backfill throttle),
`jobs/auto_summary.py:35` (in-flight dedupe). Worth one short "single-process
state inventory" note — the scheduler is the *least* consequential item on that
list and the only one written down.

### P3 — testing shape

Backend services are ~70% covered by a named test file, and the untested ones line
up with the findings above (`scraper_jobs`, `data_import_export`; PR #51 closed
the `discover_probe_job` gap). Frontend `lib/` is well covered (~72%); everything
else is nearly bare — 2 tests / 28 hooks, **0 / 9 contexts** including
`ScraperContext`, and until #51, **0 in `components/discover/`**. Root cause is
that there is no `@testing-library` or `renderHook` in the repo at all. Adding
that capability is a prerequisite for confidently touching `ScraperContext` or
`useSyncQueue`.

---

## 6. Still open in IDEA-011

| Item | One line |
|---|---|
| **D2** | Render the `samplePost` the backend already returns — expandable rows, matched handle highlighted, per-carrier breakdown from `seenIn`. |
| **D6** | Independent-corroboration scoring (`Σ_carriers log(1 + carrier_total)`) so one loud carrier cannot outrank three agreeing ones. |
| **D7** | "New since last report" — derived from each candidate's `lastSeen` vs the previous report's timestamp. |
| **D10** | Push `minTotal` / `followState` / `nameQuery` / sort / paging into the request, and virtualize the table. **Adjacent to #51:** it would cap what a report ships to the browser, which also shrinks the report refetch the new design triggers on each verdict batch. |
| **D11** | Materialize `tg_post_references` at `upsert_posts` time, turning Discover into a `GROUP BY` over an index. Largest item; unblocks D6/D7. |
| **D12** | `functools.lru_cache` on `_text_link_re()` — one line. |
| **D13** | SSE for Generate progress. Explicitly sequenced *after* D11 — if D11 makes generate fast, this is wasted work. |
