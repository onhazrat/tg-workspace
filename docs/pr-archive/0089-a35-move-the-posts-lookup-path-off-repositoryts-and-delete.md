# #89 ♻️ A3.5: move the posts lookup path off repository.ts, and delete what A1 orphaned

**State:** merged 2026-08-02 · **Branch:** `a3-posts` into `main` · **Diff:** +279 / -289 across 9 files · **Opened:** 2026-08-01

---

**Stacked on #88** → #87 → #86 → #85 → #84.

Fifth A3 family. `repository.ts` **397 → 252 LOC, 22 → 17 exports**; consumer files 20 → 16. New `lib/posts/store.ts` with `lookupPosts`, `getPost`, `bulkUpsertPosts`.

## Collecting on A1's deferred deletion

`getPostsByDateRange` is gone, with `fetchAllPosts` and `repository.posts.test.ts`. A1c left it **callerless on purpose**, with a comment saying to delete it at A3 once the `singleFlight` concurrency assertions had somewhere to live. A3.3 gave them one (`singleFlight.test.ts`), and A2 already replicated the paging-loop coverage in `data-transfer/entities/post.test.ts` — so nothing is lost. `getPostsWithoutEmbeddings` went too: also zero callers.

## Three functions deliberately stay

`clearChannelPosts`, `deleteOldPosts` and the mirror reads **never touched the server** — they are thin `lib/cache` wrappers from the browser-only era. A3 moves *API* access out of this file; something that only clears IndexedDB has nowhere to move to. They disappear with the mirror in **A4**, and `repository.ts` now says so in place rather than leaving it to be re-derived.

## A mutation survived, and the guard was what was wrong

`lookupPosts`'s `refs.length === 0` early return turns out **not** to be what makes the empty case issue no request — the batching loop runs zero times for zero refs regardless. The guard's only real job is skipping a de-dup key registration.

Rather than delete a passing-looking assertion, or keep a mutation that cannot fail, the test now states what it actually verifies and the guard says what it is for. Fifth unit in this programme where mutation testing changed something.

## Verification

- `tsc` clean; biome clean; `bun run build` succeeds
- **806 pass / 0 fail** across 109 files
- Mutation-tested against **4 real mutations, all caught**: batch limit raised past what the server accepts, no batching at all, de-dup key stops sorting, de-dup key ignores the refs

## Running total

`repository.ts` **956 → 252 LOC, 67 → 17 exports, 45 → 16 consumer files** across A3.1–A3.5.

Remaining: embeddings/translations/stats/network-settings/migration, then the infrastructure block (`apiWrite`, etag staleness, the `TgProviders` write-fallback toast).

🤖 Generated with [Claude Code](https://claude.com/claude-code)
