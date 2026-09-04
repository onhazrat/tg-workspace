# #79 ⚡ A1c: run the scoped-posts branch in SQL, completing A1

**State:** merged 2026-08-01 · **Branch:** `a1c-scoped-posts` into `main` · **Diff:** +195 / -85 across 5 files · **Opened:** 2026-08-01

---

Part of the architecture-simplification programme (`docs/architecture-simplification-plan.md`, workstream A). **This completes A1.**

## What

`computeScopedPosts`'s non-semantic branch paged a channel's whole history into the browser and ran the client filter pipeline over it (`buildFilteredPostsFromRaw`: keyword → forwarded → media → per-channel cap → sort). It is now **one bounded `POST /data/posts` call** — every one of those five stages has a server counterpart kept in lockstep by `app/services/post_filters.py`.

Bounding the read (`SCOPED_POSTS_LIMIT = 200`) is only sound because **the server sorts before it limits**: the first N are the first N of the same ordering the client pipeline produced, not an arbitrary N. That reasoning is documented at the constant, because the next reader will otherwise try to raise the number rather than page the feed.

## How much of this branch was live turned out to be the interesting part

Tracing the callers: `usePostsFeed`, `useScopedPostCounts`, `useCommandRegistry`, `DiscoverView` and `getPromptPostsInput` all call `getScopedPosts` **only when a semantic/related search is active** — they already had server paths for everything else.

So the unbounded date-range read was reached from exactly **one** place: `useEntityFlow`'s pick-post pool, which takes `.slice(0, 100)` off it immediately. A whole-history read to populate a hundred-row picker.

`channels` is no longer read on this path either — the `unfollowed_forwarded` filter needed the local channel list to decide what "followed" meant, and the server resolves that from `tg_channels`.

## Also moved: language detection

Already a *bounded* read, so not strictly an A1 target, but it went through `repository.getPostsByDateRange` whose only extra behaviour there was the IndexedDB fallback — which ADR-009 removes.

## `repository.getPostsByDateRange` now has zero callers

Deliberately **not** deleted here. `repository.posts.test.ts` is the only coverage of `singleFlight`'s de-dup, and A3 is where those assertions get ported to the hook layer; deleting it now drops that coverage with nothing replacing it. It carries a doc comment saying so. The genuinely orphaned `getPostsByDateRangeCached` alias (no callers, no tests) is gone.

## Tests rebased, not deleted

The two normal-path tests asserted client-pipeline parity, which no longer exists to assert. They now pin the **translation** — every piece of filter state reaching the server under the right name — plus a dedicated boundedness test, since a regression to an unbounded read would not otherwise change any assertion.

Mutation-tested: dropping `keyword` → 1 fail, unbounding the limit → 2, zeroing the cap → 1, hardcoding the sort → 1, disabling the semantic branch → 3.

## Verified

frontend **717 pass / 0 fail** · `tsc` clean · biome clean.

CI is billing-blocked (`.github/workflows/DISABLED.md`) — expect no checks; run locally.

🤖 Generated with [Claude Code](https://claude.com/claude-code)
