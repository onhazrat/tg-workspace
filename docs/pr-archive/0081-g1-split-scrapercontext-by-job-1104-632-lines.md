# #81 ♻️ G1: split ScraperContext by job (1,104 → 632 lines)

**State:** merged 2026-08-01 · **Branch:** `g1-split-scraper-context` into `main` · **Diff:** +1361 / -566 across 8 files · **Opened:** 2026-08-01

---

Part of the architecture-simplification programme (`docs/architecture-simplification-plan.md`, workstream G). Unblocked by **T2** (which extracted and covered the sync-job decisions first) and **A1** (which removed the bulk post reads).

## What moved

| New home | LOC | Takes |
|---|---|---|
| `hooks/usePostFilters.ts` | 185 | the 10 filter/search `useState`s, their 4 `localStorage` effects, both debounces, `postViewOptions` |
| `hooks/useSyncJob.ts` | 281 | `runServerSync`, `waitSyncJob`, `pollSyncJobFallback`, `applySyncJobStatus`, `scrapingChannels`, the failure backoff |
| `hooks/useFollowJob.ts` | 279 | `waitFollowJob`, `followDiscoverChannels` |
| `hooks/usePromptPosts.ts` | 167 | `getScopedPosts`, `getPromptPostsInput` |

What stays is one responsibility: **scrape orchestration** — `handleScrapeChannel` and siblings, the sync queue, `addNewChannel`, language detection, composition.

## One deviation from the plan, deliberately

The plan put filter state in `contexts/PostFilterContext.tsx`. Splitting the *context* means changing every consumer, and the payoff is a re-render optimisation that **G2 is the right place to bank**, once it decides which providers survive. Doing it here would have made a large mechanical diff whose correctness rests on the same e2e suite the plan says is *not* a sufficient net for this refactor.

So the state moved out; where it is *published* did not. `usePostFilters` is a context away when G2 wants it.

## Why this was safe to do in one step

**The public surface is byte-identical** — verified by extracting and diffing the provider's `value={{…}}` block against `origin/main`. **Zero consumer files changed.** So any behaviour change has to be inside a moved function — and the three riskiest (`waitSyncJob`, `pollSyncJobFallback`, `waitFollowJob`) were diffed whitespace-insensitively against the original and confirmed **verbatim**.

## Three things the move surfaced

1. **`activeJobRef` was written in four places and read in none.** A ref tracking the in-flight job id that nothing consumed. Deleted.
2. **`runServerSync` invalidated the post views twice** — `await handleFilterPosts()` then `invalidatePostViews()`, where `handleFilterPosts` *is* `invalidatePostViews`.
3. **A typing bug.** `FollowJobDeps` first restated the five proxy settings by hand and got two wrong — `defaultProxyUrls` / `torProxyUrls` are a newline-or-comma-separated `string`, not `string[]`. It now `extends ProxySettings` so the shape cannot drift. Same class of defect workstream B exists to remove, one layer down.

## Tests: 726 → 744

- `usePromptPosts.test.ts` (7) — the **scope-vs-posts** decision, which is load-bearing: a scope on the semantic path would silently summarise the *unranked* corpus.
- `usePostFilters.test.ts` (11) — hydration against hostile stored values (a non-numeric cap must not become `NaN`; an unknown sort must not reach the server as a 422), and which four keys persist.

Both use `renderHook` with **injected** dependencies — no `mock.module`, per T1's process-wide-mock hazard.

Mutation-tested: cap fallback → 2 fail, sort fallback → 1, dropped persistence → 1, semantic→scope → 2, dropped keyword → 2.

## Verified

frontend **744 pass / 0 fail** across 103 files · `tsc` clean · biome clean.

CI is billing-blocked (`.github/workflows/DISABLED.md`) — expect no checks.

🤖 Generated with [Claude Code](https://claude.com/claude-code)
