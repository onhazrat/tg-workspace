# #87 ♻️ A3.3: move summaries and tag runs off repository.ts, and extract singleFlight

**State:** merged 2026-08-02 · **Branch:** `a3-summaries` into `main` · **Diff:** +422 / -158 across 18 files · **Opened:** 2026-08-01

---

**Stacked on #86** → #85 → #84. Merge those first.

Third A3 family. `repository.ts` **633 → 490 LOC, 39 → 28 exports**; consumer files 31 → 22.

## `singleFlight` moves out first

It is shared infrastructure that outlives `repository.ts`, so the families leaving cannot keep importing it from the file they are leaving. `lib/singleFlight.ts` now owns it, and `repository.test.ts` becomes `singleFlight.test.ts` with its **five concurrency assertions intact** — the "port them, don't delete them" the plan asked for.

## Suppress, not invalidate — same rule as channels

A summary write happens on **every autosave of the summary currently streaming**, i.e. once per token batch. Invalidating would refetch the whole history that often. `DataContext.loadHistory()` is already `useInvalidateSummaries()` for callers that do want a refresh.

## Why `singleFlight` survives here but was dropped for logs

Not inconsistency — `useSummariesQuery`/`useSummaryDetailQuery` get react-query's de-duplication for free, but `listSummaries` also has two callers react-query never sees: `lib/commands/search-filters.ts` and `lib/data-transfer/entities/summary.ts`. It goes with the infrastructure block at the end of A3, once nothing outside a hook reads a summary.

## Also

`saveSummarySynced` — a `@deprecated` alias with zero callers — deleted rather than carried across.

## Verification

- `tsc` clean; biome clean; `bun run build` succeeds
- **792 pass / 0 fail** across 108 files (779/107 before)
- Mutation-tested against **6 mutations, all caught**: save invalidates, delete invalidates, search dropped, de-dup key ignores the search term, de-dup key ignores the summary id, tag-run reads rethrow

> Two test files had to be repointed and **neither was caught by `tsc`**: `repository.posts.test.ts` imported `resetInFlight` from `@/lib/repository`, and `palette-search.test.ts` had `mock.module("@/lib/repository", …)`. `tsconfig.build.json` excludes `src/**/*.test.*`, so both failed only under `bun test`. Expect one per remaining family.

## Remaining after this

posts (7 fns / 12 files), credentials + chat destinations (6 / 5), then embeddings/translations/stats/network-settings/migration and the infrastructure block (`apiWrite`, etag staleness, the `TgProviders` write-fallback toast).

🤖 Generated with [Claude Code](https://claude.com/claude-code)
