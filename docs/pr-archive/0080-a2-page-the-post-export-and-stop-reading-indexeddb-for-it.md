# #80 🐛 A2: page the post export, and stop reading IndexedDB for it

**State:** merged 2026-08-01 · **Branch:** `a2-server-export` into `main` · **Diff:** +440 / -39 across 6 files · **Opened:** 2026-08-01

---

Part of the architecture-simplification programme (`docs/architecture-simplification-plan.md`, workstream A).

## The plan's premise held; its remedy was about a different export

`entities/post.ts` was indeed the last direct IndexedDB reader outside `lib/cache.ts`. But the plan said *"`GET /data/export` already streams server-side; route the export UI through it"* — and there are **two** exports:

| | source | format | consumed by |
|---|---|---|---|
| palette *"Export List of Posts"* | this unit | per-entity JSONL | its own JSONL importer |
| `DatabaseManagement` *"Export DB"* | `workers/dbWorker.ts` → **IndexedDB** | legacy `{type:"store"}` JSONL | its own worker importer |

`GET /data/export` emits a third, unrelated shape (a version-2 JSON document for `POST /data/import`) and **has no frontend caller at all**. Routing the palette export through it would have changed the format its own importer reads.

## The actual content of this unit: a silent truncation bug

The online branch called `api.getPosts({channelNames, startDate, endDate})` with **no `limit`** and treated the result as the complete corpus. It is not — `PostFeedRequest.limit` defaults to `DEFAULT_POST_PAGE_SIZE` (**500**).

So an operator with more than 500 posts in range got a **silently truncated export online**, while the IndexedDB branch of the same function wrote every post the browser held. The two branches disagreed by however many posts the operator had, and nothing in either file recorded which one produced it.

`fetchAllPostsFromServer` now pages at `EXPORT_PAGE_SIZE` (5000 = `MAX_POST_PAGE_SIZE`) until a short page arrives, bounded at `MAX_EXPORT_PAGES`.

## The IndexedDB branch is deleted, not ported

Under ADR-009 an export assembled from a possibly-stale local mirror is worse than no export, because nothing in the file says it was stale. Post commands are disabled while offline instead — the treatment every *import* command already had. One new field, `DataEntityDef.requiresServer`; channels and summaries deliberately don't set it, their offline source being React state (a view of server data), not a second store.

## Tests

- `backend/tests/api/test_export_paging.py` (5) — omitting `limit` returns one default page; offset paging reaches every row exactly once; a short page ends the loop; an exact multiple costs one extra request; the page size is capped at 422.
- `entities/post.test.ts` (9) — the loop itself, with the fetcher **injected** rather than `mock.module`-ed (T1's process-wide-mock hazard).

Mutation-tested: removing paging → 6 fail, stopping on a full page → 6, freezing the offset → 5, per-page progress → 1. Removing `MAX_EXPORT_PAGES` **hangs the suite forever** rather than failing — the clearest evidence the bound is load-bearing.

## Carried to A4

`DatabaseManagement`'s Export/Import DB still round-trips through `workers/dbWorker.ts` and IndexedDB, and **its import writes nowhere but the browser** — so once A4 deletes the mirror, that import silently becomes a no-op. A4 must repoint both at `GET /data/export` / `POST /data/import`, and keep reading the legacy `{type:"store"}` JSONL so existing backups still import. Recorded in the plan.

## Verified

backend **809 passed / 2 skipped** · frontend **726 pass / 0 fail** · mypy strict clean · ruff clean · `tsc` clean · biome clean.

🤖 Generated with [Claude Code](https://claude.com/claude-code)
