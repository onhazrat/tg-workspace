# #52 📝 Record the probe-queue plan and the survey that came with it

**State:** merged 2026-07-30 · **Branch:** `docs-probe-queue-plan` into `main` · **Diff:** +277 / -0 across 3 files · **Opened:** 2026-07-30

---

Docs only. Follows up #51.

## Why

#51's narrative is in IDEA-011 D9, but two things from the planning had nowhere to live:

- **The decisions with their rejected alternatives** — eleven calls, each with what was chosen *against* and why: a separate queue table, lazy read-path enqueue, an immediate `trigger_job` kick, a backfill script, a retention floor guard, deprecated route shims. The reasoning is the expensive part to reconstruct later; "we picked X" is not.
- **The architectural survey done alongside it** (§5) — a prioritised list of what is still wrong, **none of which #51 fixed**. This is the part worth acting on:

  | | |
  |---|---|
  | **P0** | `bulk_follow`'s job state is unrecoverable — a restart mid-job leaves some channels followed, some not, no record of which, a chained sync running for the followed subset, and a client polling a 404 until timeout. `scraper_jobs.py:249-256` has the pattern to copy. |
  | **P1** | No startup reconciliation of `tg_sync_jobs`; `tg_summaries` / `tg_tag_runs` still have no retention. |
  | **P2** | `useSyncQueue.ts:51-107` is the same client-orchestration disease #51 cured, per-tab and silently dropping failed channels. Two undocumented client/server duplications that genuinely differ: the random-cap **seed derivation**, and the sort tie-break (codepoint vs `localeCompare`). Semantic reports silently see ≤50 posts. |
  | **P3** | ADR-004 documents the *least* consequential single-process assumption; five others are undocumented. No `@testing-library`/`renderHook` in the repo at all, which is why 0/9 contexts are tested. |

Filed as `docs/discover-probe-queue-plan.md` to match `lazy-filtered-posts-refactor-plan.md`, with a `docs/README.md` index entry and a pointer from D9 so the narrative leads to the decision record.

## Note on accuracy

The file:line references were **re-checked against `main`** rather than trusted from my planning notes. Six had drifted — including two `scraper_jobs.py` lines that pointed at blank lines, and `scheduler.py:37`, which #51 itself shifted. Corrected.

## Verification

Docs only: no code, no tests, no API change. Pre-commit hooks passed (mypy/ty ran; biome/ruff/SDK had no files to check). Relative links checked by hand in both directions.

🤖 Generated with [Claude Code](https://claude.com/claude-code)
