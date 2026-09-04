# #32 ⏳ Fix audit A2: log panels claimed "no logs" while still loading

**State:** merged 2026-07-27 · **Branch:** `fix/audit-a2-settings-loading` into `main` · **Diff:** +184 / -0 across 9 files · **Opened:** 2026-07-27

---

⏳ Fix audit A2: log panels claimed "no logs" while still loading

The audit's stated cause was wrong
-----------------------------------
It blames SettingsHub.tsx:88-120 — "five log queries must all resolve before
anything paints". They do not. That Promise.all is `void`ed; it is fire-and-forget
refetch triggering and gates no render at all.

The real defect is one level down. Every log tab renders

    if (logs.length === 0) return <LogEmptyState message="No LLM logs found" />

and the logs come from react-query via DataContext, where
`llmLogs = llmLogsQuery.data ?? emptyArray`. While a query is in flight the array
is empty, so the panel is indistinguishable from a panel that genuinely has no
logs — and it does not go blank, it confidently states "No LLM logs found", then
quietly replaces it. That is the UI asserting something false, which is worse than
showing nothing.

Fix
---
DataContext exposes a `logsLoading` flag per panel, computed as
`isPending && length === 0` to match the existing isInitialChannelsLoading
convention. A background refetch with data already on screen is deliberately not a
loading state, so lists do not flicker back to skeletons on every revalidation.
Each tab checks it before the empty state and renders LogsSkeleton instead.

Also corrects the record on PR #31
-----------------------------------
#31's message claims C7's scroll reset made the e2e suite flaky. That comparison
was confounded and the conclusion does not hold.

seedTestChannel appends on every e2e run — about 136 channels per full suite — and
never resets. `main` was measured early in the session against a small database and
`+C7` later against a much larger one, so DB growth tracked the variable under
test. By the end of the day tg_channels held 2,152 rows and the suite was failing
tests no working-tree change could affect: "channel card frosted icon buttons
expose hover classes" failed on clean main, with C7 removed, and with A2 absent.

After truncating the tg_ tables, both arms measured from zero:

    clean main    75/75
    main + A2     75/75

What stands: the C7 guard is still correct on its own terms — an unconditional
scrollTop write does force a layout read/write every tab render — and nothing
shipped in #31 is harmful. What does not stand: the claim that removing it fixed a
measured regression.

Same lesson as B2 in a new disguise. There a stale backend container made a revert
look like it made things worse; here a growing database made a branch look worse
than main. Both times the environment drifted between measurements while only the
code was believed to have changed.

Verified: biome clean, tsc clean, 612 unit tests, 75/75 e2e on a truncated database.

Co-Authored-By: Claude Opus 5 <noreply@anthropic.com>
