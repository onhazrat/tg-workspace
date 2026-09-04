# #90 ♻️ A3.6: retire the etag layer and the write fallback — A3 is complete

**State:** merged 2026-08-02 · **Branch:** `a3-rest` into `main` · **Diff:** +177 / -177 across 7 files · **Opened:** 2026-08-01

---

**Stacked on #89** → #88 → #87 → #86 → #85 → #84. Final A3 unit.

Moves translations and network settings out, then deletes the whole etag-staleness and write-fallback machinery now that nothing uses it.

## A3 total: `repository.ts` 956 → 116 LOC, 67 → 7 exports, 45 → 13 consumer files

## Findings in this unit

- **`listEmbeddings`/`saveEmbeddings` were dead** — zero callers. That is **five dead exports** A3 has found across its six units (`bulkSyncChannelSettings`, `saveSummarySynced`, `getPostsWithoutEmbeddings`, and these two).
- **The translations etag was actively harmful.** `getTranslation` was a full-table download *per read*, gated on a resource etag — and `saveTranslation` bumped that etag, so **every save forced the next read to re-download every translation in the database**. It is a single-row request now, needing neither etag nor invalidation.
- **`setWriteFallbackHandler` and its toast are gone**, as the plan asked. The toast said *"Saved {resource} locally only — server sync failed"*, which with the mirror retired would be a **lie**: there is no local copy for a failed write to land in. A failed write now surfaces as the error it is.
- **Both migration functions called `refreshSyncMeta(true)` for nothing** — it primed an etag cache that never affected either. The import's call becomes `queryClient.invalidateQueries()` with no filter: a wholesale replacement of every table where nothing was written through is the one place in this codebase that is right.

## What deliberately remains

`clearChannelPosts`, `deleteOldPosts`, `getDBStats`, `cleanupLegacyBots`, `checkNeedsMigration`, `importIndexedDBToServer`, `export { cache }`. Every one is a `lib/cache` wrapper from the browser-only era or part of the one-time IndexedDB→server migration. A3 moves *API* access out; these have no API to move. The file header now says this in place so nothing grows back.

> **A4's first job is `getDBStats`.** It merges the server's stats response with local mirror counts field by field (`remote.x ?? local.x`). Deleting the mirror means confirming the server covers every `DBStats` field first — check, don't assume.

## Verification

`tsc` clean; biome clean; `bun run build` succeeds; **806 pass / 0 fail** across 109 files.

## The rule A3 established, for the record

The etag layer was doing **two opposite jobs**, and getting this backwards is a real regression either way:

| write did | means | replacement |
|---|---|---|
| `refreshSyncMeta(true)`, no mark | force a refetch | explicit `invalidateQueries` |
| `markResourceSynced(resource)` | **suppress** the refetch (callers already wrote through) | nothing — leave the cache alone |

Only logs were the first kind. Channels, summaries, bots and posts were all the second.

🤖 Generated with [Claude Code](https://claude.com/claude-code)
