# #76 ✅ T2: characterise the sync-job watcher before G1 splits it

**State:** merged 2026-08-01 · **Branch:** `t2-scrapercontext-characterisation` into `main` · **Diff:** +304 / -23 across 4 files · **Opened:** 2026-08-01

---

Workstream `T2` from `docs/architecture-simplification-plan.md` — the gate on `G1`.

## Not done by mocking the context

`ScraperContext` imports `@/api`, and **two existing test files import it too**. `mock.module` is process-wide, so mocking it would have reproduced exactly the T1 failure that silently hung the suite.

The repo already has a better pattern, recorded in `useDiscoverProbeQueue.test.ts`: **lift the decision into a pure function and test that.**

## What

`src/lib/sync/job-state.ts` — `isTerminalSyncStatus`, `deriveScrapingChannels`, `hasRateLimitError`, `shouldFallBackToPolling` — plus **20 characterisation tests**.

`ScraperContext` now calls them, so the tests guard the **real path**, not a copy. This is both G1's safety net *and* a down payment on G1 itself: `useSyncJob` extracts these same decisions, and they're now already extracted and covered.

## Two warts characterised, not fixed

T2's contract is to pin behaviour, not improve it. `hasRateLimitError` regexes the error **string**:

| input | result |
|---|---|
| `"config error: rate limit setting is invalid"` | ✅ trips the banner (unrelated error) |
| `"HTTP 429 Too Many Requests"` | ❌ does **not** trip it |

Both asserted as-is and labelled `WART:` in the test names.

## One real duplication removed

`["completed", "failed", "cancelled"]` was written out inline **three times in one file** — the sync poller, the SSE watcher, and the follow-job watcher. That's how one of them ends up missing a state after the backend gains a fourth.

## A bug in my own test, found by mutation-testing it

The first version used `test.each([...TERMINAL_SYNC_STATUSES])` — **self-referential**. Deleting `"cancelled"` deleted a *test case* rather than failing one, so the suite went **19 passing → 18 passing and reported success**.

The set is now asserted literally. Same mutation: **2 tests fail**.

| Mutation | Result |
|---|---|
| drop `"cancelled"` from the terminal set | **2 fail** |
| treat `pending` as inactive | **1 fail** |

## Verification

| Check | Result |
|---|---|
| frontend suite | **715 pass / 0 fail** |
| `tsc -p tsconfig.build.json` | clean |
| biome | clean |

🤖 Generated with [Claude Code](https://claude.com/claude-code)
