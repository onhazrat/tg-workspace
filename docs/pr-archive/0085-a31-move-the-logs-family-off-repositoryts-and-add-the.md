# #85 ♻️ A3.1: move the logs family off repository.ts, and add the invalidation seam

**State:** merged 2026-08-02 · **Branch:** `a3-logs` into `main` · **Diff:** +484 / -353 across 21 files · **Opened:** 2026-08-01

---

**Stacked on #84** (`f1b-fetch-transport`) — both touch `main.tsx`. Merge #84 first.

First A3 family, plus the prerequisite every later family needs. `repository.ts` **956 → 749 LOC, 67 → 46 exports**; consumer files 45 → 40.

## What moved

- **`lib/queryClient.ts`** — the `QueryClient` becomes a module singleton instead of a local in `main.tsx`, so non-React writers can invalidate. This is the prerequisite: most log writers are *services* (`services/telegram.ts`, `services/ai.ts`, `lib/network/tor-actions.ts`, `lib/channels/*`) and cannot use a hook. The plan's "move each caller to a hook" was not possible for them.
- **`lib/logs/write.ts`** — five plain `saveXLog` functions replacing the `repository` ones, each invalidating its own panel.
- **`hooks/useLogs.ts`** — reads go straight to `api.listLogs(type)`; new `useDeleteLogsMutation(type)` covers delete *and* clear from the single endpoint D1/D2 collapsed. Dead `useInvalidateLogs` deleted (zero callers — it was written for this and never wired up).
- **`DataContext`** — five near-identical `loadXLogs` collapsed onto one `loadLogsOfType(type)` sharing `fetchLogs` with the query hook.
- **`repository.ts`** — the 21 log functions and the now-unreferenced `listWithStaleCheck` deleted.

## Two behaviour notes

**A failed log write no longer throws — deliberately.** `apiWrite` rethrew *after* saving to IndexedDB, so the entry survived locally and the throw was recoverable. With the mirror gone there is nothing to fall back to, and rethrowing would let a failed *log* break the operation it was recording — a proxy test that worked would report as failed because recording it did not. Several callers never awaited these anyway, so a rejection was an unhandled promise rejection rather than an error anyone saw. Deletes still throw: the operator asked for those.

**`LogsView` still calls `reload()` after the mutation, and must.** The log queries are created `enabled: false` (the panels are lazy), and `invalidateQueries` does not refetch a disabled query. What the invalidation buys is that the *next* `fetchQuery` sees the entry as stale and goes to the server instead of returning the cache the write just made wrong. Invalidate-**and**-refetch is the faithful replacement for the etag path; neither alone is.

## A pre-existing bug fixed on the way

`useLazyTabData` prefetched `queryKeys.logs.publish`/`.sync` with a bare list call and **no sort**, writing the same keys `useLogsQuery` sorts. Whichever won the race decided the order, so those two panels could render oldest-first. Both now go through `fetchLogs`.

## Verification

- `tsc` clean; biome clean; `bun run build` succeeds
- **769 pass / 0 fail** across 106 files (758/105 before — the delta is the 11 new tests)
- Mutation-tested against **6 mutations, all caught**: invalidation dropped, invalidates every panel, invalidates after a failure, rethrows on failure, wrong log type, entry not batched

> **The first draft of the test passed alone and failed in the suite.** It used `spyOn(api, "createLogs")`; `src/lib/repository.posts.test.ts` calls `mock.module("@/api", …)`, and Bun's module mocks are **process-wide**, so the spy observed that file's stub once everything ran in one process. Fixed by injecting the writer (`LogPoster`) — the pattern this repo already settled on in A2. The remaining families will hit the same thing.

## Next

Remaining families in order: channels (7 fns / 20 files), summaries + tag runs (8 / 16), posts (7 / 12), credentials (6 / 5), then the leftovers and the infrastructure block.

🤖 Generated with [Claude Code](https://claude.com/claude-code)
