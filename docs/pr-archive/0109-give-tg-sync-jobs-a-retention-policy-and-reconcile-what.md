# #109 🐛 Give tg_sync_jobs a retention policy, and reconcile what restarts stranded

**State:** merged 2026-08-19 · **Branch:** `perf/sync-job-retention` into `main` · **Diff:** +343 / -5 across 7 files · **Opened:** 2026-08-19

---

`tg_sync_jobs` reached **196,047 rows / 153 MB** with no policy at all, and **711 rows sat in `running`** (48 in `pending`) going back to June.

## The two halves need each other

- **Pruning is restricted to terminal rows.** That row is what a reconnecting client reads when the SSE stream drops, so deleting by age alone would eventually take a sync that is still working. But that also makes a stranded `running` row immortal.
- **`reconcile_interrupted_jobs` runs in the lifespan.** In-memory progress does not survive the process, so at startup every non-terminal row is provably dead — no age threshold to guess at.

Drop either and the table still grows. Drop the terminal filter instead and it shrinks by deleting live work, which is worse than not shrinking.

## Why a constant and not a setting

`SYNC_JOB_RETENTION_DAYS` is a deployment constant, unlike every other window in `load_retention_settings`. **There is no list endpoint for sync jobs** — the only reads are `GET /jobs/sync/{id}` and the SSE reconnect fallback — so nobody browses the history and nobody can be surprised by its length. That follows the `CHANNEL_PHOTO_ORPHAN_MAX_AGE_DAYS` precedent rather than adding a settings-panel knob, a zod schema entry and a frontend context field for internal bookkeeping.

No count cap either, unlike Discover reports: jobs are created at most once a minute, so an age window bounds the table on its own. Reports needed a cap because a burst in one afternoon can outrun any age.

## Small decisions worth flagging

Interrupted jobs are marked `failed` with a finish time, rather than getting an `error` column or a fourth status value. There is no error column today, and a status the frontend does not know would have to be threaded through `_TERMINAL_SYNC_STATUSES` and the generated client — for a row nothing lists.

Reconciliation is **only sound while the sync tier is a single replica**; with more than one process, a starting worker would fail jobs another is actively working. The general answer is a claim that expires — step 2 of `docs/scaling-to-multiple-workers.md`. Called out in the docstring so it is not a silent assumption.

## Guards

Six mutations watched go red, including the two that matter most:

- prune drops the terminal filter → deletes live jobs
- prune only handles `completed` → two thirds of the table keeps growing
- `0` means "prune everything" instead of disabled
- reconcile also stamps already-finished jobs
- reconcile forgets `finished_at`
- **the retention job silently stops calling the pruner** — the wiring half, which does nothing visible when broken

## Verification

1002 passed, 2 skipped; mypy/ruff/ty clean.

🤖 Generated with [Claude Code](https://claude.com/claude-code)
