# #86 ♻️ A3.2: move the channels family off repository.ts, without invalidating

**State:** merged 2026-08-02 · **Branch:** `a3-channels` into `main` · **Diff:** +390 / -137 across 18 files · **Opened:** 2026-08-01

---

**Stacked on #85** → #84. Merge those first.

Second A3 family. `repository.ts` **749 → 633 LOC, 46 → 39 exports**; consumer files 40 → 31. New `lib/channels/store.ts`, 14 importing files repointed.

## Written to the opposite rule from A3.1, deliberately

`repository.ts` called `markResourceSynced("channels")` after every write, which stored the *new* etag so the next staleness check answered "fresh". A channel write **suppressed** the refetch, because 17 call sites already apply their change optimistically through `setChannelsInCache`/`setChannelStatsInCache`.

Invalidating here would refetch the whole list on every edit, and once per channel during bulk follow — at the ~1,070 channels a real account holds, the load shape `docs/discover-bulk-follow-load-investigation.md` already had to root-cause once.

`store.test.ts` asserts the **negative**: a write must leave the cached list fresh and must not refetch. Both "someone generalised A3.1 across the families" mutations fail it.

> The rule for the remaining families, now in the plan: **`markResourceSynced` after a write means suppress; a bare `refreshSyncMeta(true)` means refetch.** Check which before converting.

## Three findings

- **`bulkSyncChannelSettings` was dead** — zero callers anywhere. Deleted rather than carried across.
- **`getChannelStats` loses its `channelName` parameter.** It only existed to key the IndexedDB fallback. It still returns `null` rather than throwing, because both callers (`useSyncJob`, `useFollowJob`) refresh a card *after* a sync that already succeeded.
- **The data-import path needs no invalidation either**, and adding one would have been redundant: `data-transfer/entities/channel.ts` already re-reads with `listChannels()` and writes through `ctx.setChannels`, which is authoritative and costs the same one request. Its trailing `refreshSyncMeta(true)` — the last caller of that outside `repository.ts` — is deleted.

## Left for A4, on purpose

The channel mirror is now **write-only**: `hydrateChannelMirror` still runs, but nothing reads it back except `repository.checkNeedsMigration` ("is there local data the server does not have?"). Dropping the write here would make that check silently answer "no" — the same trap A2 found for `DatabaseManagement`'s import. Both go together in A4.

## Verification

- `tsc` clean; biome clean; `bun run build` succeeds
- **779 pass / 0 fail** across 107 files (769/106 before — the delta is the 10 new tests)
- Mutation-tested against **6 mutations, all caught**: upsert invalidates, delete invalidates, stats not batched, stats not split out of the row, stats keyed by id instead of name, `getChannelStats` rethrows

The tests inject a fake `ChannelsApi` rather than calling `mock.module("@/api", …)` — Bun's module mocks are process-wide and `repository.posts.test.ts` already mocks that module, so mocking it here passes alone and collides in the suite. Same lesson A3.1 learned the hard way.

🤖 Generated with [Claude Code](https://claude.com/claude-code)
