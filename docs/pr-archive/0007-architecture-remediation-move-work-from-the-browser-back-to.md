# #7 Architecture remediation: move work from the browser back to the backend

**State:** merged 2026-07-21 · **Branch:** `worktree-architecture-remediation` into `main` · **Diff:** +4571 / -309 across 46 files · **Opened:** 2026-07-21

---

Implements `docs/architecture-remediation-plan.md`.

The app began as a browser-only application and kept that shape after a
FastAPI backend was grafted on: the frontend fetched whole datasets and
did filtering, sorting and aggregation in JS, and the backend happily
served unbounded data. That surfaced as a staging incident — workers at
3.09 GB RSS, load average 7+, Postgres connections idle-in-transaction
for minutes — root-caused to `GET /posts` having no LIMIT against a
2.97M-row table.

## Progress

- [x] **Phase 1** — stop the runaway client loops
- [x] **Phase 2** — bound every unbounded endpoint
- [x] **Phase 3** — migrate the frontend onto the bounded APIs
- [ ] **Phase 4** — push aggregation into SQL *(T4.1 backend done; frontend wiring + T4.2/T4.3 not done)*
- [ ] **Phase 5** — move AI prompt assembly server-side *(not started)*
- [x] **Phase 6** — cache hygiene and doc cleanup

## What landed

**Phase 1 — runaway loops.** The worst: `ScraperContext` background language
detection re-armed on every `channels` identity change and never terminated,
refetching each channel's **entire post history** every ~5s to sample 20 posts.
Also fixed `NetworkTelemetry`'s self-sustaining refetch (`loadData` unmemoized,
depended on by its own effect) and `useApiStatus` mounting one poll timer per
consumer, of which there are seven.

**Phase 2 — bounded endpoints.** `GET /posts` paginated with a deterministic
`timestamp DESC` order on the existing index. New bulk post lookup and
single-translation endpoints so callers stop fetching whole tables to read one
row. Tag-run list reduced to a light projection — `promptText` is a full
serialized post corpus. Dead `GET /data/embeddings` deleted. RAG search: N+1
(up to 5000 queries/request) collapsed into one join, date filter pushed into
SQL from Python-after-the-cap, deterministic `ORDER BY`, truncation surfaced.
`logs.py` deletes converted to bulk SQL.

**Phase 3 — frontend migration.** Single-flight de-duplication in
`repository.ts`; `getPostsByDateRange` pages to exhaustion rather than silently
truncating; `getPost` and `rag.ts` use the batched lookup; `getTranslation` uses
the single-row endpoint; `TagContext` is lazy and light.

**Phase 4 (partial) — `GET /data/discover/candidates`,** with all 22 cases from
`discover-candidates.test.ts` ported and passing.

**Phase 6 —** IndexedDB pruning (the helpers had *zero* callers, so client
mirrors grew forever), a shared `RelativeTime` ticker (was one timer per
instance — 500 in a long feed), doc corrections per §3 of the plan, and two
filed follow-ups (pgvector; a shared paginated-list helper).

## Verification

CI is billing-blocked, so its red runs are jobs that never started. Everything
below was run locally:

- **backend**: pytest **441 passed**, 1 skipped (was 383) — mypy and ty clean
- **frontend**: **450 unit tests** (was 435), `tsc --noEmit`, biome, `test:tg-ui`
- **e2e**: `summarizer.spec.ts` — **49 passed, 2 failed**. Both failures are
  **pre-existing**: I checked out the base commit `a52fe9e` and re-ran, and the
  same specs fail there with identical locators (`:341` forward-only empty
  guide, `:464` a strict-mode violation where `getByText('2 selected')` matches
  two elements). Unmodified main actually fails a third (`:387`).
- client regenerated in production mode; no `PrivateService` leak
- new tests specifically prove: concurrent identical fetches produce one
  request, offset paging covers every row exactly once, and RAG query count
  does not scale with rows scanned

**Not verified:** the staging py-spy re-measurement from the plan's acceptance
criteria. That needs a staging deploy and a bulk-follow, and is the remaining
gate on the original incident.

## Deliberately not done

`DiscoverView` still uses the client-side aggregation. It computes over
`filteredPosts`, which reflects keyword/semantic/forwarded/per-channel-cap
filters the new endpoint does not implement. Wiring it up needs the
filter-semantics port that Phase 5 specifies, and doing it half-way would
silently change what Discover shows. Same reasoning applies to T4.2's consumers.
Phase 5 (server-side prompt assembly) is untouched — the plan calls for
byte-identical output parity there, which deserves its own focused pass.

## Note

Commits on this branch are unsigned — the 1Password signing agent isn't
reachable from the background session this was implemented in.

🤖 Generated with [Claude Code](https://claude.com/claude-code)
