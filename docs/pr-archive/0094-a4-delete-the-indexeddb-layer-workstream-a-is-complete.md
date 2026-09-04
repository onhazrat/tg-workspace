# #94 🔥 A4: delete the IndexedDB layer — workstream A is complete

**State:** merged 2026-08-02 · **Branch:** `a4-idb` into `main` · **Diff:** +606 / -2503 across 38 files · **Opened:** 2026-08-02

---

**−2,491 / +136 lines.** `lib/cache.ts` (1,226), `workers/dbWorker.ts` (229), `lib/repository.ts` (116), `MigrationPrompt.tsx`, `useCachePrune.ts`, `useBotCredentialMigration.ts`, `lib/channels/mirror-hydration.ts` and the `idb` dependency are gone.

**PostgreSQL is the only store.** Workstream A is complete.

## Import was broken, and this fixes it

A2 found it; A4 acts on it. `handleImportDB` ran `dbWorker`, which wrote the file into IndexedDB and `localStorage` and reloaded the page — **it never reached the server**, so the next sync erased it. "Import DB" did nothing durable.

Both Export and Import now go through `GET /data/export` and `POST /data/import` via a new `lib/data-transfer/database.ts`.

**Existing backups still import.** The old worker wrote JSONL — one `{type:"store", storeName, data}` object per line. `parseLegacyJsonl` reads that shape. This matters more than usual now: with the browser copy gone, that file may be the operator's only one.

**The per-table export selection is preserved**, filtered client-side. `GET /data/export` streams the whole corpus and takes no filter; narrowing the downloaded document keeps the export a single always-complete streamed read, at the cost of transferring more than a partial export strictly needs.

## Three things were genuinely removed, not moved

1. **The Query panel** — it ran queries against IndexedDB object stores. There is no server equivalent, and adding a SQL-query endpoint is a security decision, not a refactor.
2. **The "Storage · Browser" card and the local/server data-source toggle** — both described a store that no longer exists. `TableSizeSource` survives as a one-member union so cached server sizes keep their namespaced key across the upgrade.
3. **"Migrate Local Data to Server"** (panel + command) — its whole purpose was IndexedDB → PostgreSQL.

## Also

- `clear-indexeddb-table` → `clear-server-table`, against `DELETE /data/tables/{name}`
- `SERVER_TABLE_NAMES` mirrors the backend's `_TABLE_SECTIONS`
- `DBStats` narrowed to exactly `DbStatsResponse` — the five client-only fields went with the Storage API readings, so `getDBStats`'s `remote.x ?? local.x` merge could go too
- The client-side retention sweep went; the backend's scheduled `job_retention` is now the only one
- User-facing copy promising a browser cache was corrected (`app-copy.test.ts` guards this)

## Verification

- `tsc` clean; biome clean; `bun run build` succeeds
- **819 pass / 0 fail** across 110 files
- `lib/data-transfer/database.ts` mutation-tested against **6 mutations, all caught**: legacy JSONL dropped, `type` discriminator removed, import never posts, table filter ignored, metadata dropped, unchecked store name

> **A test caught a real bug in the importer.** A legacy JSONL *line* also has an object `data`, so it passed the "is this an export document?" check — a single-row backup imported as a document whose one "table" was that row's fields. The fix is the `type` discriminator: a document has none, a legacy line always does.

🤖 Generated with [Claude Code](https://claude.com/claude-code)
