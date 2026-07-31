# Architecture entropy audit

**Date:** 2026-07-31
**Status:** Analysis only — no code changed.
**Companion:** [`architecture-simplification-plan.md`](./architecture-simplification-plan.md) turns these
findings into an incremental backlog.

> This document describes the codebase **as it is today**, in the present tense, with
> measurements rather than impressions. Every number was produced by running a command
> against `main` at `36f6e09`. It deliberately does *not* propose fixes — that is the
> companion document's job — so that the description stays useful even if we choose a
> different remedy than the one we picked.

---

## 1. Why this audit exists

The goal stated for this work: make the architecture *neater and leaner*, and lower both
**code entropy** (how disordered the code is locally) and **architecture entropy** (how many
distinct, unrelated structural rules a reader must hold in their head at once), so the
codebase is easier to understand and maintain a year from now.

This is a different axis from the two investigations that preceded it:

| Prior work | Axis | Status |
|---|---|---|
| `docs/discover-bulk-follow-load-investigation.md` | Runtime resource use | Closed 2026-07-22 |
| `docs/frontend-backend-boundary-audit.md` | Where computation happens | Superseded |
| `docs/architecture-remediation-plan.md` | Performance / boundedness | ✅ Complete 2026-07-22 |
| `docs/discover-probe-queue-plan.md` §5 | Robustness / durability survey | Open findings |
| **this document** | **Comprehensibility & maintainability** | Analysis |

**Relationship to the probe-queue survey.** `discover-probe-queue-plan.md` §5 is a prioritised
list of *correctness and durability* gaps (`bulk_follow` job state unrecoverable, no startup
reconciliation of `tg_sync_jobs`, no retention on `tg_summaries`/`tg_tag_runs`, `useSyncQueue`
as a `useEffect` work queue, per-process state undocumented by ADR-004). **Those are out of
scope here and remain tracked there** — they are bugs and robustness risks, not entropy. Two of
its findings do overlap this audit and are credited inline: P2 (residual client/server
duplication) is the same disease as E1, and P3 (testing shape) is E11 below.

The remediation plan succeeded at what it set out to do (peak worker RSS 3.09 GB → 0.89 GB).
But it succeeded by **adding a second, better data path next to the old one** rather than by
replacing the old one. That is the correct way to ship a performance fix under time pressure,
and it is also the origin of the largest entropy source described below. This audit is
substantially about **finishing** what that plan started.

---

## 2. Size of the thing

```
backend/app        (excl. alembic)   18,850 LOC     44 service modules, 13 route modules
backend/tests                        15,005 LOC     89 test files
frontend/src       (excl. client/)   59,881 LOC    161 components, 32 hooks, 9 contexts
frontend/src/client (generated)       7,660 LOC     committed, do not hand-edit
frontend  tests                       9,551 LOC     98 test files
```

Test-to-code ratio is healthy on the backend (0.80:1) and reasonable on the frontend.
**The tests are an asset, not a problem** — they are what makes the refactors in the companion
plan safe to attempt without CI. Nothing in this audit suggests reducing them.

---

## 3. The central finding: two complete data architectures coexist

Everything else in this document is downstream of this.

The app began as a **standalone browser application**: it pulled whole datasets into IndexedDB
and did all filtering, sorting, searching and aggregation in JavaScript. A FastAPI backend was
grafted on later. The July 2026 remediation moved the *post feed* to server-side paging — but
left every other consumer of post data on the original client-side path.

Both stacks are live, in the same app, over the same data:

### Stack A — the original browser app (still load-bearing)

```
component → context → lib/repository.ts → ┬→ api/  (network)
                                          └→ lib/cache.ts (IndexedDB, 12 stores, DB v13)
                        ↓
                 lib/posts/*.ts  (client-side filter/sort/aggregate pipeline)
```

- `lib/cache.ts` — **1,226 LOC**, 12 IndexedDB object stores, schema version 13
- `lib/repository.ts` — **955 LOC**, **67 exported functions**, **77 `cache.*` call sites**
- `workers/dbWorker.ts` — 229 LOC
- **2,410 LOC total** for the local-mirror layer alone

### Stack B — server-first (what the remediation plan built)

```
component → hooks/use*.ts → TanStack Query → api/ → FastAPI (SQL paging/filtering/aggregation)
```

### They meet in the middle, awkwardly

`hooks/useChannels.ts` is the clearest illustration — TanStack Query caching, in memory, the
result of a function that **already caches the same rows in IndexedDB**:

```ts
// hooks/useChannels.ts
async function fetchChannels(): Promise<ChannelsQueryResult> {
  const { channels, stats } = await listChannelsWithStats()   // ← repository → api + IndexedDB
  ...
}
export function useChannelsQuery() {
  return useQuery({ queryKey: queryKeys.channels, queryFn: fetchChannels, staleTime: … })
}
```

And post reads have split in two, permanently:

| Consumer | Path | Fetch shape |
|---|---|---|
| Post feed (`usePostsView`) | **Stack B** — `api.postsFeed` + `useInfiniteQuery` | 20 rows/page, server-filtered |
| Summary / AI prompt (`AIContext`) | **Stack A** — `getPostsByDateRange` | whole date range into the browser |
| Scoped posts (`ScraperContext.getScopedPosts`) | **Stack A** | whole date range into the browser |
| Command-palette search (`lib/commands/search-filters.ts`) | **Stack A** | whole date range into the browser |
| Export (`lib/data-transfer/entities/post.ts`) | reads IndexedDB **directly** | bypasses both |

### The measured consequences

**Seven distinct ways a component obtains server data:**

| Mechanism | Components using it |
|---|---|
| React contexts | 27 |
| hand-written `@/api` | 15 |
| generated `@/client` | 13 |
| `lib/repository` | 13 |
| `useQuery` directly | 10 |
| `lib/cache` (raw IndexedDB) | 2 |
| `services/*` | 2 |

**Three stacked, independent staleness systems**, none aware of the others:

1. TanStack Query `staleTime` — 21 declaration sites
2. `repository.ts` `singleFlight` (19 call sites) + `syncMeta` etag tracking (16 references)
3. IndexedDB persistence + `useCachePrune` (6-hourly retention sweep)

A reader debugging "why is this row stale?" has to reason about all three, plus which of the
two post paths the screen in question happens to use.

### The locked-decision tension

This is not an accident or an oversight — it is **mandated** by:

- **ADR-003 (Hybrid Sync)** — "Read-through cache with API-first writes"
- **Decision #4** — API-first; IndexedDB fallback + user-visible warning on failure
- **Decision #5** — Offline mode: browse cached data; disable sync/scrape/summary/publish when API down

**However, the offline promise is already only partially delivered.** The main post feed is
now server-only paged — with the API down, the primary view of the application shows nothing.
The IndexedDB layer therefore currently pays its full complexity cost (2,410 LOC, a second
cache, a second staleness model, a write-fallback path, a migration prompt, a 6-hourly pruner)
in exchange for offline access to *everything except the screen users actually look at*.

Additionally, `MEMORY.md` records that **multi-user is coming soon**. A per-browser mirror of
server rows becomes an active liability the moment rows are user-scoped: cached data outlives
the session that was entitled to it.

> **Decision taken (2026-07-31):** retire the hybrid, supersede ADR-003 and Decisions #4/#5.
> See the companion plan, workstream **A**.

---

## 4. Entropy sources, ranked

Ranked by *(comprehension cost saved) ÷ (risk of changing it)*.

### E1 — Backend response types are not declared, so the contract is unenforceable

**This is the highest-leverage finding in the audit.** Of 129 API operations:

```
$ref-typed 200 response:  26
loose / untyped:         103
```

Return annotations across all route modules:

| Annotation | Count |
|---|---|
| `dict[str, Any]` | 56 |
| `list[dict[str, Any]]` | 17 |
| `dict[str, int]` | 10 |
| `dict[str, str]` | 8 |
| `Any` | 7 |
| declared Pydantic models | ~10 |

In OpenAPI these become `{"additionalProperties": true, "type": "object"}`; in TypeScript,
`Record<string, unknown>`.

The knock-on effect is the real cost. Because generated types are useless, the frontend
**hand-maintains its own copy of the server's domain model** in `frontend/src/types.ts` — 24
interfaces (`Post`, `Channel`, `Summary`, `PublishLog`, `SyncLog`, `LLMLog`, `EmbeddingLog`,
`NetworkLog`, `BotCredential`, `ChatDestination`, `PostEmbedding`, `PostTranslation`, `TagRun`,
`ChannelSettingGroup`, …) that mirror `backend/app/models_tg.py` **with no compiler-enforced
link between them**. Renaming a column is a silent, type-clean frontend break.

This single fact is also the true reason ADR-006 exists — see §6.

### E2 — `data.py` is a god-router

**1,438 LOC, 73 endpoints, 14 unrelated resource families** in one module: sync-meta, channels,
bulk-follow (+SSE), setting-groups, posts, discover (candidates/ignored/probes/reports),
summaries, tag-runs, bot-credentials, chat-destinations, embeddings, translations, 5× logs,
stats, table admin, settings, import/export.

Schema placement is inconsistent: `app/schemas/data.py` holds 14 request models, while 6 more
are declared inline in the route file. There is no stated rule for which goes where.

### E3 — One concept ("a log") expanded into five parallel copies across six layers

Five log types — `PublishLog`, `SyncLog`, `LLMLog`, `EmbeddingLog`, `NetworkLog` — each with
near-identical shape and handling:

| Type | backend files | frontend files |
|---|---|---|
| PublishLog | 18 | 17 |
| SyncLog | 18 | 15 |
| LLMLog | 18 | 13 |
| EmbeddingLog | 21 | 14 |
| NetworkLog | 18 | 25 |

Per log type the same idea is restated in: a SQLModel table, a service upsert fn, a service
list fn, 2 endpoints (GET+POST), a TS interface, an IndexedDB store, a repository read fn, a
repository write fn, a react-query hook, a `DataContext` field. **Adding a sixth log type is a
~30-file change.**

Notably `services/logs.py` *already* has the right abstraction — a generic
`_list_logs_page[LogModel]` — but it is wrapped by five hand-written per-type functions, and
the genericity stops there and is never propagated up the stack.

### E4 — `ScraperContext` is a 1,103-LOC module with five unrelated jobs

14 `useState` hooks in one provider, mixing:

1. Post-filter UI state (`postSearch`, `forwardedFilter`, `mediaFilter`, `postSortOrder`, …)
2. Sync orchestration (`runServerSync`, `waitSyncJob`, `pollSyncJobFallback`, SSE handling)
3. Follow-job orchestration (`waitFollowJob`, `followDiscoverChannels`)
4. Scoped-post fetching (`getScopedPosts` — the Stack A path)
5. AI prompt assembly (`getPromptPostsInput`)

`handleScrapeChannel` alone spans lines 608–853. Anything touching post filters must load a
module that also owns SSE sync plumbing.

More broadly: **9 context providers** (3,853 LOC), nested **11 deep** in `TgProviders.tsx`
together with `CommandPaletteProvider` and `TooltipProvider`.
`DataContext` is a partial exception and shows the intended direction — it derives from
react-query and exposes Dispatch-compatible write-throughs — but it still reads 9 of its
fields straight from `lib/repository`.

### E5 — Three parallel settings systems

Adding one user-facing setting requires edits in three schemas that know about each other only
by convention:

| Module | LOC | Owns |
|---|---|---|
| `lib/settings/schema.ts` | 320 | persistence: storage key, legacy keys, zod validator, default, backend section |
| `lib/settings/catalog.ts` | 834 | UI: label, group, control type, badge formatting, search text |
| `lib/commands/settings-schema.ts` | 569 | command-palette: command id, parse/clamp, setter binding |

The catalog does import from the schema, so this is layered rather than fully duplicated — but
the third system re-derives setters and validation independently (`clampInt`, `clampFloat`,
`booleanSetter`, `sliceGetter`), so a validation rule can be tightened in one place and stay
loose in another.

### E6 — Long functions concentrated in the sync path

| LOC | Location |
|---|---|
| 257 | `services/sync_orchestrator.py:484` `_apply_scrape_page` |
| 210 | `services/data_import_export.py:74` `import_data` |
| 205 | `services/sync_orchestrator.py:964` `sync_single_channel` |
| 163 | `services/scraper.py:581` `resolve_start_time_to_id` |
| 156 | `services/discover.py:138` `compute_discover_candidates` |
| 144 | `jobs/retention.py:86` `run_retention_cleanup` |
| 138 | `jobs/auto_sync.py:35` `run_auto_sync` |
| 133 | `services/network.py:162` `fetch_with_retry` |

`sync_orchestrator.py` (1,218 LOC) is the single hardest module in the backend to modify safely
and holds three of the top eight.

### E7 — Service-module fragmentation with no stated boundary rule

44 service modules, with clusters that have no obvious membership criterion:

- `discover.py`, `discover_probes.py`, `discover_reports.py`, `discover_ignored.py` (+ `jobs/discover_probe.py`)
- `posts.py`, `post_filters.py`, `post_sync_state.py`, `post_media_parser.py`, `post_thumbnails.py`, `post_reply_parser.py`, `post_links_parser.py`
- `channels.py`, `channel_setting_groups.py`, `channel_photos.py`, `channel_tags.py`, `followed_channels.py`
- `sync_orchestrator.py`, `sync_meta.py`, `sync_schedule.py`, `scraper_jobs.py`
- `network.py`, `network_settings.py`, `proxy_pool.py`

Sizes range from 12 LOC (`async_db.py`) to 1,218. Some splits are principled (parsers are
genuinely separable and well-tested); others look like "this file got long". Without a written
rule, every new feature re-litigates where its code goes — the definition of architecture
entropy.

### E8 — Template residue still wired in

- `items` router mounted in `api/main.py`; `Item` / `ItemBase` / `ItemCreate` / `ItemUpdate` /
  `ItemPublic` / `ItemsPublic` in `models.py`; `ItemsService` in the generated SDK;
  5 components under `components/Items/`; routes in `routeTree.gen.ts`
- `routes/legacy.py` (136 LOC) — its own docstring says *"Scheduled for removal after one
  release cycle once all clients migrate"*; mounted outside production only
- `_template_tmp/` at repo root

None of it is reachable from the summarizer. It is, however, load-bearing for
`PYTHON-314-TEMPLATE-RESYNC.md`-style diffing against upstream — a real trade-off, not pure dead
weight. (`users`/auth is *not* in this category: it is load-bearing and multi-user needs it.)

### E9 — The generated client is misconfigured and 70% dead

`frontend/src/client/` is 7,660 committed LOC covering all 10 services / 129 operations.
Actual usage:

| Service | Files importing it |
|---|---|
| `UsersService` | 8 |
| `ItemsService` | 4 *(itself template residue, E8)* |
| `LoginService` | 3 |
| `AiService`, `DataService`, `JobsService`, `NetworkService`, `RagService`, `TelegramService`, `UtilsService` | **0** |

So `DataService` — a full generated client for every endpoint `api/data.ts` hand-writes — is
generated, committed, linted, and never called.

The config compounds it:

```ts
plugins: [
  "legacy/axios",                       // ← pulls axios in alongside fetch: two HTTP stacks
  { name: "@hey-api/sdk", asClass: true /* NOTE: this doesn't allow tree-shaking */ },
  { name: "@hey-api/schemas", type: "json" },   // ← emits schemas.gen.ts: 2,986 LOC
]
```

`schemas.gen.ts` (2,986 LOC of runtime JSON Schema objects) is imported by **nothing** outside
`client/`. `asClass: true` defeats tree-shaking, and the generated client's `legacy/axios`
transport means the app ships **both axios and fetch** for the same job.

### E11 — There is no capability to test a hook or a context at all

Recorded independently in `docs/discover-probe-queue-plan.md` §5 (P3) and confirmed here:

- **0 of 9 contexts** have a test — including `ScraperContext` (1,103 LOC)
- **2 of 32 hooks** have a test
- **Root cause:** there is no `@testing-library/react` and no `renderHook` anywhere in the repo
  (`frontend/package.json` has neither), so the capability doesn't exist rather than having been
  skipped.

This is an entropy finding, not just a coverage gap: the untested layer is precisely the layer
holding the most tangled state (E4), and the absence of a testing seam is *why* logic accretes
in contexts instead of being extracted into testable units. It is also a hard constraint on the
companion plan — any workstream touching contexts or hooks is currently unverifiable except
through Playwright e2e, which is slow, must run serially, and needs a rebuilt backend.

### E10 — Component-level size outliers

`HistoryView.tsx` 962 · `SummaryView.tsx` 910 · `ChannelCard.tsx` 823 · `TorPanel.tsx` 626 ·
`BotManagement.tsx` 569 · `NetworkTelemetry.tsx` 523 · `DiscoverView.tsx` 507 ·
`DatabaseManagement.tsx` 482 · `PostCard.tsx` 477 · `ChatView.tsx` 472.

(`ui/sidebar.tsx` at 737 is vendored shadcn — excluded; leave it alone.)

This is the *lowest*-leverage item on the list and is included for completeness. Large view
components are a normal outcome of dense UI, and splitting them for a line count is churn.
Worth doing **only** where a split falls out of E1/E4 work anyway.

---

## 5. What is already good — do not "simplify" these

An honest audit has to mark the load-bearing walls, or a refactor will helpfully remove them.

- **Backend layering discipline.** Thin routes / fat services is genuinely followed. Route
  handlers delegate; business logic is in `services/`. This is the pattern to extend, not replace.
- **The AI provider registry** (`app/ai/`). Small, pluggable, correctly abstracted at 39 LOC of
  base + a 27-LOC registry. A model to imitate elsewhere.
- **Parsers are properly separated and well-tested.** `post_media_parser`, `post_reply_parser`,
  `post_links_parser`, `telegram_html` are cohesive units with real test coverage
  (`test_post_media_parser.py` is 413 LOC). E7 does *not* apply to these.
- **`lib/settings/schema.ts` as a concept.** Schema-driven settings with declared legacy keys is
  the right design; E5 is about the *other two* systems, not this one.
- **The `queryKeys` module and `applySetStateAction` helper.** Small, correct, exactly the kind
  of shared primitive that reduces entropy.
- **Test coverage — with one large caveat (see E11).** 89 backend + 98 frontend test files.
  Backend services are ~70% covered by a named test file and frontend `lib/` is ~72% covered;
  with CI billing-blocked (`MEMORY.md`), these are the only safety net. But the coverage is
  **very unevenly distributed**, and the gap lands exactly where this plan wants to refactor.
- **Boundedness of queries.** The remediation plan's §12 audit is still valid; do not
  reintroduce unbounded reads while refactoring.

---

## 6. Research answer: should we adopt the template's generated-client pattern everywhere?

*This section answers the question raised during planning: is it a good idea to use the FastAPI
template's dynamic client-generation pattern for the whole codebase?*

### Short answer

**Yes as a destination, no as a next step — and the codegen is not actually the change that
matters.** Adopting generated clients wholesale *today* would make the codebase measurably
worse. Doing it *after* declaring backend response models makes it a large, compounding win.

### Why "no, not today"

ADR-006 justifies the hand-written client with *"SSE streams and large telemetry payloads do not
fit generated client patterns well."* That rationale is **true but far too narrow**. Counting
what genuinely cannot be generated:

| Endpoint | Why codegen can't help |
|---|---|
| `POST /ai/summary/stream` | SSE text stream |
| `POST /ai/tag/stream` | SSE text stream |
| `POST /ai/chat/stream` | SSE text stream |
| `GET /jobs/sync/{id}/events` | SSE JSON stream |
| `GET /data/channels/bulk-follow/{id}/events` | SSE JSON stream |
| `GET /telegram/bot-file/{id}`, `/post-thumb/…`, `/channel-photo/…` | binary blobs (generatable, but awkwardly) |

That is **~8 of the 50 endpoint paths** the hand-written client covers. SSE does not explain
the other 42.

The real reason is **E1**: with 103 of 129 operations returning `dict[str, Any]`, the generator
emits `Record<string, unknown>`. Switching `api/data.ts` to `DataService` today would trade 50
precise hand-written signatures for 103 untyped ones — strictly worse type safety, in exchange
for less code. Nobody would accept that trade, which is presumably why `DataService` sits
generated-and-unused.

**So the ordering is forced:** declare response models first; adopt codegen second. Reversing
the order actively harms the codebase.

### Why "yes as a destination"

Once responses are typed, one generated contract subsumes three hand-maintained artefacts:

1. hand-written request/response types in `api/*.ts`
2. the 24 domain interfaces in `types.ts` that mirror `models_tg.py`
3. the manual discipline of keeping (1) and (2) in step with the backend

and converts a whole class of silent runtime breakage into compile errors. For a **solo
operator with no CI** (`MEMORY.md`: CI billing-blocked, PRs show no checks) that is
disproportionately valuable: `tsc` becomes the contract test that CI isn't running. It is also
the cheapest possible preparation for multi-user, where response shapes will change as rows
gain user scoping.

### The shape to aim for

Not "generated client for everything" — that fails on SSE. Rather:

```
client/          generated, typed, tree-shakeable, fetch transport   ← 95% of endpoints
api/streaming.ts hand-written, ~150 LOC                              ← the 5 SSE endpoints
```

with the current config's three specific mistakes corrected: drop `@hey-api/schemas`
(2,986 dead LOC), drop `asClass: true` (restores tree-shaking), and drop `legacy/axios` in
favour of the fetch transport (removes the second HTTP stack). The generated client must also
gain the hand-written client's one genuinely extra behaviour — `clearStaleSession()` redirect
on 401/403 — as an interceptor.

### Consequence for the template-residue question

E8 asked whether to delete `items` / `legacy.py` / `_template_tmp/`. The argument for keeping
them is easier upstream template re-syncs. But adopting the generated-client destination means
**deliberately diverging from the template's client configuration anyway** (it ships
`legacy/axios` + `asClass`), so template-diff fidelity is being spent regardless. That weakens
the keep-it case considerably — though `users`/auth should stay, since it is both load-bearing
and needed for multi-user.

> This is the input needed to answer the open question in the companion plan (workstream **E**).

---

## 7. Summary table

| # | Entropy source | Evidence | Leverage |
|---|---|---|---|
| E1 | Untyped API responses → hand-copied domain types | 103/129 loose; 24 mirrored interfaces | **Highest** |
| E2 | `data.py` god-router | 1,438 LOC, 73 endpoints, 14 families | High |
| E3 | 5 log types × 6 layers | ~18 backend + ~13–25 frontend files each | High |
| E4 | `ScraperContext` does 5 jobs | 1,103 LOC, 14 `useState`, 11 providers nested 11 deep | High |
| E5 | 3 parallel settings systems | 320 + 834 + 569 LOC | Medium |
| E6 | Long functions in sync path | 257/210/205 LOC top 3 | Medium |
| E7 | 44 services, no boundary rule | 12–1,218 LOC spread | Medium |
| E8 | Template residue | `items`, `legacy.py`, `_template_tmp/` | Low-Medium |
| E9 | Generated client misconfigured, 70% dead | 7,660 LOC, 7 of 10 services unused | Medium |
| E11 | No hook/context testing capability | 0/9 contexts, 2/32 hooks, no `@testing-library` | **Blocker for E4** |
| E10 | Large view components | 10 files > 470 LOC | Low |

**And above all of them, the structural finding of §3:** two data architectures, seven
data-access paths, three staleness systems.
