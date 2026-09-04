# #44 ✨ IDEA-011: Discover reports as saved artifacts (W1) + single aggregation (D14)

**State:** merged 2026-07-28 · **Branch:** `worktree-discover-refinement-doc` into `main` · **Diff:** +3156 / -1075 across 33 files · **Opened:** 2026-07-28

---

Refines the Discover tab: a survey of the whole tab, then two implemented workstreams.

## 1. The survey (`docs/ideas-log/ideas/IDEA-011-discover-tab-refinement.md`)

How Discover works today, then **14 proposals (D1–D14) in 8 workstreams**, each with *why we may need this* and *how we can achieve this*, plus effort/risk, sequencing, non-goals and open questions. Registered in `IDEAS-LOG.md`.

## 2. W1 — a report is a stored artifact

A Discover report is now an entity you keep, modelled on `Summary`. The Channels/Posts selections are its **input**, captured at generate time; afterwards it is immutable.

This dissolved two of W1's three original items rather than solving them:
- **D3 (mark stale)** — superseded. An immutable report has no staleness to label.
- **D4 (own scope)** — reduced to a snapshot. The selection coupling is intentional and stays.
- **D1** — built as a Details side panel.

- `tg_discover_reports` + `services/discover_reports.py`, mirroring `services/summaries.py` including the light projection — the list ships `candidateCount`, never the candidate rows.
- **`isFollowed` is not stored**; it's resolved against live `tg_channels` on every read, so a saved report self-corrects as candidates get followed. Counts historical, follow state live.
- Discover opens on the latest report; **the scope-invalidation effect is gone**, so changing a selection no longer discards a completed report.
- `DiscoverScopeCard` renders the report's frozen scope, not live state — that was the subtler half of the original bug.
- "View posts" → side panel. It used to write shared `ScraperContext` scope, invalidating the report being read. The panel lazy-fetches the sample post and always offers a Telegram link, so evidence survives retention pruning.
- Reports archived in `HistoryView` (open/delete), addressed by `?report=<id>`.

## 3. D14 — one aggregation, not two

The counting rules had two implementations; the client copy existed only for the two scopes the server couldn't reproduce. Both are now server-side:

- **`random` cap** — `posts.random_cap_order` was *already* a deterministic seeded ordering used by the feed; it simply wasn't reachable from Discover. The request now carries `maxPerChannelMode` + `seed` and reuses it, so Discover caps the same posts the Posts tab shows.
- **Semantic query** — the request accepts an explicit `postIds` set. The vector search keeps the ranking; only the post selection crosses the wire. An empty list means "matched nothing" and is deliberately distinct from absent.

Deleted: `computeDiscoveryCandidates`, `postReferences`, `countPostsBySignal`, `SERVER_REPRODUCIBLE_CAP_MODES`, and the now-meaningless "Unsaved result" state. **Every scope is aggregated server-side, so every report is saved.**

The TS aggregation tests were deleted rather than ported — `backend/tests/services/test_discover_candidates.py` already covered every case (and more: replies, invite links, reserved paths, the email false-positive guard). The kept TS tests are sort, result filtering and `deriveDiscoveryEmptyReason`, none of which moved.

## Verification

- Backend: **640 passed, 1 skipped** (was 625 pre-change); `mypy` + `ty` + `ruff` clean.
- Frontend: **608 pass, 0 fail**; `tsc -p tsconfig.build.json` clean; biome back to its 3 pre-existing warnings.
- Migration chain rebuilt from scratch on a dedicated DB and applies cleanly.
- E2E not run (needs a live stack); its Discover mocks were updated to the report envelope and now echo the requested scope.

## Alembic

Resolved. `origin/main` is merged into the branch and the migration is re-chained onto `s1t2u3v4w5x6`, giving a **single linear head** (`u3v4w5x6y7z8`). The branch is 0 commits behind main and `git merge-tree` reports no conflicts. The new scope columns went into that same unmerged migration rather than a follow-up.

Note: the shared `app_test` DB is stamped at `t2u3v4w5x6y7`, an unmerged migration from another session — these tests ran against a dedicated `app_test_discover`, so nothing of that session's was touched.

🤖 Generated with [Claude Code](https://claude.com/claude-code)
