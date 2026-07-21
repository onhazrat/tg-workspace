# Frontend/backend responsibility boundary audit

**Date:** 2026-07-21
**Status:** Research complete. No code changed. Follows on from `discover-bulk-follow-load-investigation.md` (problems A/B/C proposed there).
**Trigger:** confirming or ruling out a hypothesis — that the RAM/CPU problem found in Discover/`list_posts` is one instance of a systemic pattern left over from this app's origin as a pure-browser app (fetch everything, compute/filter/sort/search entirely in JS) later grafted onto a FastAPI backend built from [fastapi/full-stack-fastapi-template](https://github.com/fastapi/full-stack-fastapi-template).

**Verdict: confirmed, and more widespread than the Discover investigation alone showed.** It is not four separate problems — it is substantially **one root cause** (`list_posts` / `GET /posts` has no bound) with several independent consumers redundantly re-deriving results from the same over-fetched array, plus a handful of structurally similar sibling problems (embeddings, translations, channels) that share the same shape but weren't visible from the Discover investigation alone.

The reassuring counterpoint: **this codebase already knows how to do this correctly in three places** — logs, channel stats, and the export endpoint. The fix is largely "apply the pattern that already exists here to the places that don't have it yet," not invent something new.

---

## 1. Template comparison — where the discipline was lost

The original template's list-endpoint convention survives untouched in the two routers the migration never adapted:

| Route | Pagination | Response shape |
|---|---|---|
| `GET /items/` (`backend/app/api/routes/items.py:14-16`) | `skip: int = 0, limit: int = 100`, `.offset(skip).limit(limit)` | `ItemsPublic(data=..., count=count)` |
| `GET /users/` (`backend/app/api/routes/users.py:37,46`) | same pattern | `UsersPublic(data=..., count=count)` |

Every domain-specific route added for this app under `/data/*` **dropped** that convention — except logs, which independently reinvented a narrower version of it (its own `limit`/`offset`, default 500 / hard cap 5000, `backend/app/services/logs.py:31-32,254`) with no shared helper connecting it back to the template's pattern.

**In one sentence: the template had the right convention; the migration kept the FastAPI/SQLModel substrate but not the pagination discipline that came with it, except in the one place someone independently reinvented a piece of it.**

---

## 2. Backend: every `GET` route, bounded or not

| Route | Service fn | Bounded? | Notes |
|---|---|---|---|
| `GET /data/posts` | `list_posts` (`posts.py:97-111`) | **No** — filters optional, no LIMIT | ~3M rows on staging. Primary finding from the prior investigation. |
| `GET /data/embeddings` | `list_embeddings` (`data_vectors.py:19-20`) | **No** | `tg_post_embeddings`, ~1 row/post, full vector payload each — scales toward the same magnitude as posts, heavier per row. |
| `GET /data/translations` | `list_translations` (`data_vectors.py:61-64`) | **No** | `tg_post_translations`, ~1 row per (post × language). |
| `GET /data/summaries` | `list_summaries` (`summaries.py:31-32`) | **No** | Smaller than posts, still structurally unbounded. |
| `GET /data/tag-runs` | `list_tag_runs` (`tag_runs.py:39-41`) | **No** | One row per tagging run. |
| `GET /data/channels` | `list_channels` (`channels.py:225-228`) | **No** | Bounded in practice by channel count (962 on staging), not row growth — lower risk than the above, but not zero, and the response includes per-channel stats blobs. |
| `GET /data/bot-credentials`, `/chat-destinations` | `credentials.py` | **No**, but low cardinality | Small config tables — low risk regardless of bound. |
| `GET /data/publish-logs`, `/sync-logs`, `/llm-logs`, `/embedding-logs`, `/network-logs` | `logs.py:258-320` via `_list_logs_page` | **Yes** | `.offset(offset).limit(limit)`, default 500, hard cap 5000. **The one already-correct precedent in the whole `/data/*` surface.** |
| `GET /data/channels/{id}/stats`, `GET /data/channels?includeStats=true` | `compute_channel_stats`/`_batch` (`channels.py:101-172,320-327`) | n/a — aggregate | `GROUP BY`/windowed computation, not raw rows. **Second already-correct precedent.** |
| `GET /data/stats`, `GET /data/table-sizes` | `stats.py:44-113` | n/a — aggregate | `COUNT(*)` / `pg_total_relation_size` per table. `table-sizes` is literally the one endpoint that already tells an operator "these tables run into the millions of rows" (`stats.py:133-135`). |
| `GET /data/export` | `stream_export_data` | n/a — intentionally unbounded, **streamed** | Correct design for the one case where "give me everything" is genuinely the point: never materializes the full set in memory. **Third already-correct precedent**, for the different-but-related problem of bulk access. |

### 2b. A regression of a fix that was already made once

`backend/app/services/stats.py`'s `clear_table`/`_scoped_delete` does a bulk SQL `DELETE`, with a comment explicitly noting it's written that way *because* fetch-then-loop "repeat[s] the exact memory blowup already fixed for log viewers" (`stats.py:133-136`).

> **Correction (2026-07-21).** This section originally described the *scheduled*
> retention sweep as doing fetch-then-Python-loop deletes. That was wrong. The
> scheduled sweep lives in `backend/app/jobs/retention.py` and was **already
> fixed** — it uses bulk `sa_delete` with batching. The unfixed code was
> `logs.py`'s `clear_logs` / `delete_old_logs`, which are reachable only from
> **user-triggered API endpoints** (`data.py`), not from a schedule. Real, but
> far lower risk than "runs hourly on its own". Both have since been converted
> to bulk `sa_delete`.

`logs.py:193-232` (`clear_logs`, `delete_old_logs`) — reachable from the
user-triggered clear/prune endpoints — **did exactly the fetch-then-Python-loop
thing that comment warns against**: `select(model)).all()` before deleting, for
every log table.

Someone already learned this lesson once and fixed it in `stats.py`. It was not
carried over to `logs.py` because there was no shared, reusable pattern
connecting the two — this is itself an argument for a shared bulk-delete helper
rather than fixing each call site independently.

`channels.py:41-43` (anchor-reset) and `channels.py:309` (`delete_channel`) have the same shape, scoped to one channel at a time — lower risk since they're not global, but the same anti-pattern.

---

## 3. Frontend fetch/sync layer: how many resources are exposed to the thundering-herd pattern

`frontend/src/lib/repository.ts` gates **11 distinct resources** (corrected 2026-07-21 — the original count of 13 was wrong; 7 direct plus 4 via `listWithStaleCheck`) through `isResourceStale`/`markResourceSynced` — a single etag per resource name (`sync_etag_<resource>` in localStorage), **not scoped by query parameters**, refreshed via one shared, throttled `refreshSyncMeta()`.

TanStack Query provides real in-flight de-duplication (shared query key ⇒ concurrent callers coalesce into one request) — but **only for callers that actually go through the query client**. Several call sites bypass it and call `repository.ts` functions directly, which defeats that protection even for otherwise-protected resources.

| Resource | Bounded fetch params? | Call sites | TanStack Query protected? | Risk |
|---|---|---|---|---|
| **posts** | Params exist but caller-controlled, often unbounded in practice (`startDate:0`, all-selected-channels) | **6**, all direct: `ScraperContext.tsx:247,373`, `ChatContext.tsx:198`, `AIContext.tsx:178,387,460` | **No — zero query-client coverage anywhere** | **Highest.** Matches the production incident exactly. |
| **embeddings** | None at all | ≥1 direct | No | **Very high per-row** — full vector payloads, no bounding params even client-side. |
| **translations** | N/A — architecturally wrong shape (see below) | `components/PostCard.tsx:182`, once per rendered card | No | High, and structurally the worst-shaped of all of them. |
| **network_logs** | Backend paginates (500/5000), but... | Query-client path **+** `components/NetworkTelemetry.tsx:29`, independent `setInterval(10000)` poll, direct repository call | **Partially** — the query-client consumer is protected, the poller isn't | High and self-inflicted: refetches the whole 500-row page every ~10s on a resource that's written continuously during scraping. |
| channels | None | `hooks/useChannels.ts:21` (protected) + `repository.ts:716` `checkNeedsMigration` (direct, bypasses) | Mostly | Low/medium — channel count is small, but the bypass exists. |
| summaries | None | `hooks/useSummaries.ts:12` (protected) + `data-transfer/entities/summary.ts:32` (direct, export path) | Mostly | Medium — export path is low-concurrency. |
| bot_credentials | None, tiny table | `DataContext.tsx:126` (protected) + `useBotCredentialMigration.ts:24` (direct, fires every session's first mount) | Mostly | Low — small table, plausible double-fire on every mount. |
| chat_destinations | None, tiny table | protected only | Yes | Low. |
| publish/sync/llm/embedding_logs (4 types) | Backend paginates | All via query client, shared keys | **Yes** | Low — this is the safe baseline. |

**Translations, specifically:** `getTranslation` (`repository.ts:448-465`) is called to answer "give me the translation for this one post," and on a stale check it fetches `api.listTranslations()` — **the entire translations table** — then does a local lookup for the one row it wanted. This is the single worst-shaped call in the audit: N visible `PostCard`s independently trigger N full-table fetches to each answer a single-row question.

---

## 4. Frontend compute layer: what's actually being recomputed in JS, and over what

The key finding here: **most of what looked like "four separate expensive computations" (Discover, Posts-tab filtering, command-palette post search, channel-grid post-count sort) are four consumers of the exact same over-fetched array**, not four independent fetches.

```
ScraperContext.tsx:373  getPostsByDateRange(selectedNames, startDate, endDate)
                         → full post bodies for every selected channel in range
                              │
              ┌───────────────┼────────────────────┬─────────────────────────┐
              ▼               ▼                    ▼                         ▼
   post-view.ts filters   discover-candidates.ts  search-filters.ts:42   sort-channels-for-grid.ts:91
   /sort/cap (Posts tab)  (Discover mention/link  (palette post search,  buildPostsInScopeCounts
                          /forward aggregation)    slices to top 50)      (per-channel GROUP BY COUNT,
                                                                           done in JS)
```

Each of those four downstream consumers is doing something a single SQL `WHERE`/`ORDER BY`/`LIMIT`/`GROUP BY COUNT` could answer directly, without ever shipping full post bodies to the browser for that purpose.

| Area | Finding | Classification |
|---|---|---|
| Posts tab pipeline (`post-view.ts` + `ScraperContext.tsx:373`) | Keyword/forwarded/media filtering, per-channel capping, sorting — all in JS over the full fetched array | **Risky — the root of the tree above** |
| Discover (`discover-candidates.ts`) | Confirmed: consumes the same array, not a separate fetch | Risky (already known) |
| Command-palette post search (`search-filters.ts:42`) | Fetches everything, filters/sorts in JS, slices to 50 | Risky — cost scales with total posts in scope, not with the 50 shown |
| Command-palette semantic search (`search-filters.ts:70`) | Delegates to backend vector search with an explicit cap | **Fine** — proof the palette already does this correctly for one search mode |
| `buildPostsInScopeCounts` (`sort-channels-for-grid.ts:91`) | Per-channel post-count tally by iterating the full posts array | Risky — a `GROUP BY channel_name` the backend could return directly |
| Full channel list (`listChannelsWithStats`) | Unfiltered fetch of all 962+ channels with stats, every time | Risky (fetch) |
| Channel filter/search — **duplicated in two places** | `filter-channels-for-grid.ts` (grid) and `commands/filter-channels.ts` (palette) independently fuzzy-match over the same full in-memory channel list | Risky — no backend search/filter param exists for channels, unlike logs |
| `channel-tags.ts:62 sortTagsForChannelGrid` | O(tags × channels) — filters the entire channel list once per tag to compute chip counts | Risky |
| Channel stats/velocity (`sort-channels-for-grid.ts:108-116`) | Reads precomputed `channelStats` map | **Fine — proof the right pattern already exists and is used correctly elsewhere in this codebase.** |
| Log filtering (`lib/logs/filters.ts`) | Client-side filter, but only ever over ≤500 already-paginated rows | **Fine** — bounded by the backend's existing pagination. |
| Data-transfer (`lib/data-transfer/*`) | Full-dataset access, chunked (500/page) and streamed | **Fine and intentional** — legitimate bulk export/import, not a stray aggregation. |

---

## 5. IndexedDB: the client-side mirror has no automatic pruning

`deleteOldPosts(days)` and `deleteOldLogs(days)` exist in `frontend/src/lib/cache.ts:1094-1186` but had **zero callers at all** — not even an explicit user action reached them. Everything ever synced via any `isResourceStale` fetch is written to IndexedDB and stays there indefinitely, growing independent of the backend's 90-day retention policy, until a user manually clears it.

This is a separate scaling dimension from everything above: even a perfectly fixed backend and a perfectly coalesced fetch layer still leaves every browser that's used this app accumulating an ever-growing local mirror with no relationship to server-side retention.

---

## Summary: what's already right vs. what isn't

**Already correct, and provably so — these are the templates to copy, not new patterns to invent:**
1. Log pagination (`logs.py`, `_list_logs_page`) — offset/limit, sane defaults, hard cap.
2. Channel stats (`compute_channel_stats`/`_batch`) — aggregate computed server-side, consumed correctly by `sort-channels-for-grid.ts`.
3. Export streaming (`stream_export_data`) — correct design for the one case where full-dataset access is the actual intent.
4. Semantic search in the command palette (`search-filters.ts:70`) — bounded backend search, not fetch-then-filter.

**Not correct, ranked by risk:**
1. `list_posts`/`GET /posts` — no bound, root of a five-consumer fan-out (Posts tab, Discover, palette search, channel-sort counts, plus every direct `getPostsByDateRange` caller).
2. ~~`list_embeddings`/`GET /embeddings`~~ — **overstated (corrected 2026-07-21).** Unbounded on both sides, but it had **zero frontend callers**: it was dead code, and the theoretical risk never materialised. Since deleted.
3. Translations — wrong *shape*, not just missing a limit: a single-row lookup implemented as a full-table fetch, called once per rendered card.
4. `NetworkTelemetry.tsx`'s bespoke poll — bypassed the one protection (TanStack Query dedup) that covers every other log type. **Corrected 2026-07-21:** this was not really a 10s poll. `loadData` was not `useCallback`-wrapped and the effect depended on it, so every `setLogs` re-armed the effect — a self-sustaining refetch loop, with the `setInterval` largely irrelevant. Mitigating: it mounts on only two settings sub-tabs, and `listNetworkLogs` is etag-gated so most calls hit IndexedDB rather than the network.
5. Channel list/search — fetched full every time, filtered in JS, duplicated independently in two UI surfaces with no backend search param to consolidate onto.
6. `logs.py`'s `clear_logs`/`delete_old_logs` — fetch-then-Python-loop delete. **Corrected 2026-07-21:** these are reached from **user-triggered endpoints**, not the scheduled sweep; `jobs/retention.py` was already bulk-delete correct. Lower risk than originally written, same memory shape.
7. IndexedDB — no automatic pruning to match server retention; unbounded client-side growth over a browser profile's lifetime.

No code has been changed. This document and the prior load investigation are the basis for deciding fix scope and sequencing next.
