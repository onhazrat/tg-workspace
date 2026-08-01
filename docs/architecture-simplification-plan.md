# Architecture simplification plan

**Date:** 2026-07-31
**Status:** In progress — execution started 2026-08-01. Landed: `H3`, `A0`, `T1`, `T2`, `B1`–`B7`, `F1a`, `A1a`, `C1`, `D1`+`D2`, `H1`+`H2`, `G3`.
Typed responses **104/121** (was 26/129) — effectively complete; see B6b. Contexts with a test **1/9** (was 0).
Each unit is marked ✅ **DONE** in place as it lands, with what the work changed about the plan.
**Companion:** [`architecture-entropy-audit.md`](./architecture-entropy-audit.md) is the evidence base.
Read §3 and §6 of it before starting workstream A or B.

---

## 0. Decisions taken up front

Agreed on 2026-07-31, before this plan was written:

| # | Decision | Consequence |
|---|---|---|
| 1 | **Retire the IndexedDB hybrid.** Supersede ADR-003 and Decisions #4/#5. | Workstream A is in scope. No offline browsing. |
| 2 | **Incremental, independently shippable units.** | No phase gates. Every unit below is safe to merge alone, in almost any order. |
| 3 | **Prepare multi-user seams; implement no multi-user behaviour.** | Where a refactor touches a boundary multi-user needs anyway, pick the shape that won't be redone. Ship no user-scoping. |
| 4 | Template residue (`items`, `legacy.py`, `_template_tmp/`) | **Open** — see workstream E. Audit §6 provides the input needed to decide. |

---

## 1. The target architecture, in one page

The aim is that a new reader can hold **one** rule per concern in their head.

### Backend

```
routes/<resource>.py     thin: parse → authorize → delegate → return a declared model
  ↓
schemas/<resource>.py    every request AND response model, one home, no inline BaseModels
  ↓
services/<domain>.py     all business logic; owns its SQL; returns typed objects
  ↓
models_tg.py             tables
```

**One rule that does not exist today:** *every route declares a Pydantic response model.*
That single rule is what makes the frontend half of this plan possible.

### Frontend

```
client/          generated from OpenAPI — the ONLY definition of API shapes
api/streaming.ts hand-written, SSE + blobs only (~5 endpoints)
  ↓
hooks/use*.ts    TanStack Query — the ONLY server-state cache
  ↓
contexts/        UI state ONLY (selections, filters, view mode). No server data. No fetching.
  ↓
components/
```

**Three rules that do not exist today:**

1. Server state lives in TanStack Query. Always. There is no second cache.
2. Contexts hold UI state only — if it came from the server, it is not context state.
3. Domain types are generated. `types.ts` holds UI-only types, not mirrors of server tables.

### What disappears

| Artefact | LOC |
|---|---|
| `lib/cache.ts` | 1,226 |
| `lib/repository.ts` | 955 |
| `workers/dbWorker.ts` | 229 |
| `client/schemas.gen.ts` | 2,986 |
| `types.ts` server mirrors | ~350 of 414 |
| `MigrationPrompt.tsx` (95), `useCachePrune.ts` (64), `useBotCredentialMigration.ts` (40) | 199 |
| **Total** | **≈ 5,950 LOC**, plus the `idb` and `axios` dependencies |

Alongside: 7 data-access paths → 2; 3 staleness systems → 1; 9 contexts → ~5.

---

## 2. Working rules

- **No CI.** Every unit lists its own verification. Run it locally — `MEMORY.md` records that
  GH-hosted test workflows are billing-blocked and PRs show no checks.
- **Commit signing is required.** A signing failure is a blocker to raise, not to bypass.
- **Branch from `origin/main`**, not local `main` (it goes stale).
- **E2e runs serially with system Chrome**, against a backend rebuilt from the branch:
  ```bash
  cd frontend && PLAYWRIGHT_CHANNEL=chrome bunx playwright test tests/summarizer.spec.ts --workers=1
  ```
- **Never mutate staging.** Verification there is read-only.
- **One unit = one PR.** If a unit exceeds ~600 changed lines, split it before starting.
- **Give each worktree its own test database.** `tests/conftest.py` defaults to a single
  `app_test` and truncates the `tg_*` tables after each test — but `localhost:5432` is shared by
  *every* worktree in `.claude/worktrees/` (whichever compose project starts first owns the
  published port). So concurrent agents in different worktrees silently share one test database,
  and a branch carrying a migration the others don't have will stamp `alembic_version` to a
  revision they cannot resolve.

  `conftest.py` supports an override — use it, and never drop `app_test` itself, since another
  worktree may be mid-run against it:

  ```bash
  docker compose exec -T db psql -U postgres -d app -c "CREATE DATABASE app_test_<slug>;"
  cd backend && POSTGRES_DB=app_test_<slug> uv run alembic upgrade head
  TEST_POSTGRES_DB=app_test_<slug> uv run pytest tests/ -q
  ```

  Two failure signatures seen on 2026-08-01, both of which look like real regressions and are not:
  **`734 errors — alembic.util.exc.CommandError: Can't locate revision`** (another worktree's
  migration stamped the shared DB), and **199 failed / 521 passed** alongside a clean
  733-passed run of the same commit (two suites truncating under each other). A run killed
  mid-flight also leaves orphans that make the *next* run **hang** rather than fail —
  `pkill -9 -f pytest` clears it. Same shared-backend hazard as the Playwright `--workers=1`
  rule above.
- **Run `mypy`/`ruff` via `uv run`.** `backend/scripts/lint.sh` invokes them bare, so it only
  works with the venv already on `PATH`.

---

## 3. The backlog

Each unit is independently shippable. **Size**: S ≈ half a day, M ≈ 1–2 days, L ≈ 3–5 days.
Dependencies are noted explicitly and are few by design.

---

### Workstream A — Retire the second data architecture

*Addresses the §3 central finding. The largest single reduction in the plan.*

Sequenced internally (each still ships alone), because callers must move off `repository.ts`
before it can be deleted.

#### A0 — Supersede ADR-003 and Decisions #4/#5 · **S** · ✅ **DONE 2026-08-01**

Documentation only, but it must land **first** so later PRs aren't relitigating a locked ADR.

**Shipped:** `docs/migration/ADR-009-server-authoritative-data.md` — PostgreSQL authoritative,
TanStack Query the only client cache, writes fail loudly, no offline browsing, server state
never in context. It records both alternatives considered (IndexedDB-as-persister behind
react-query; freeze-and-decay) and why each was rejected, plus the A4 one-way-door hazard.

ADR-003 marked superseded with what it got right and keeps; Decisions #4 and #5 annotated in
place, in the summary table, and in the ADR-alignment table. Two further touch-points found
while doing it and updated: the ADR index in `docs/migration/README.md`, and principle 1 of
`IMPLEMENTATION-PLAN.md` (a completed historical doc, so annotated with a forward pointer rather
than rewritten). Historical records — `INVENTORY.md`, `TARGET-ARCHITECTURE.md`,
`REMEDIATION-PLAN.md`, `SECRETS-MATRIX.md` — deliberately left alone.

#### A1 — Move the three remaining bulk post readers onto the server feed · **L** · after A0

The load-bearing unit. Callers of `getPostsByDateRange` that still pull whole date ranges:

| Caller | Replacement |
|---|---|
| `AIContext.tsx:496` (prompt assembly) | ✅ **A1b — done 2026-08-01**, see below |
| `ScraperContext.getScopedPosts` → `lib/posts/scoped-posts.ts` | ✅ **A1c — done 2026-08-01**, see below |
| `lib/commands/search-filters.ts:34` (palette search) | ✅ **A1a — done 2026-08-01**, see below |

Semantic/related search legitimately cannot be reproduced server-side and keeps a client path —
that split already exists and is documented in `ScraperContext`; preserve it.

##### A1a — Palette search moved into SQL · ✅ **DONE 2026-08-01**

**No new endpoint was needed**, contrary to the row above. The feed's existing `keyword` filter is
already the *same predicate*, character for character:

| | |
|---|---|
| `filterPostsByTextQuery` | `text.toLowerCase().includes(q) \|\| channelName.toLowerCase().includes(q)` |
| `post_filters._keyword_clause` | `lower(text) LIKE %q% OR lower(channel_name) LIKE %q%` |

So `searchPostsForPalette` now calls `api.getPostsFeed({ keyword, sort: "time", limit: 50 })`.
It used to fetch **every post in the selected date range on every keystroke** to display at most
fifty rows. Sorting and the cap moved server-side with it — `sort: "time"` is
`timestamp DESC`, which is exactly the client's `(r, l) => r.timestamp - l.timestamp`.

`tests/api/test_palette_search_parity.py` pins the equivalence: substring rather than prefix or
word matching, either field, case-insensitive both ways, newest-first, cap applied in SQL.

**A latent inconsistency found and resolved.** With *no* channels selected the old code did two
different things depending on cache staleness: the IndexedDB branch looped over the channel list
and returned nothing, while the server branch omitted `channelNames` entirely and searched the
**whole corpus**. `searchPostsForPalette` now returns early on an empty selection — searching
everything when the user has selected nothing is the wrong half of that accident to keep.

##### A1b — Auto-regenerate prompt assembly moved server-side · ✅ **DONE 2026-08-01**

`generateBackgroundSummary` fetched **every post in the regenerated window** into the browser,
concatenated them with `formatPostsForPrompt`, and posted the whole string back. It now sends a
scope and lets the backend assemble the block — the same path `handleSummarize` has used since
the `PromptScope` work.

**The plan expected this to be the hard half of A1. It was the easy half.** The row above said
"extend `getPromptPostsInput` to cover the remaining branch", implying auto-regenerate shares the
interactive path's scope. It does not, and must not: auto-regenerate deliberately applies **no
filters at all** beyond `s.channels` and the shifted window — not the current UI filter state, and
not even the saved summary's own `postSearch`. So it needs its own two-field scope, not a share
of `getPromptPostsInput`, and it has no semantic branch to fall back to.

Three call sites of the fetched array had to move with it:

| was | now |
|---|---|
| `posts.length === 0` (nothing to summarise) | `POST /data/posts/counts`, summed |
| `posts.length` (`Summary.postCount`) | the same count |
| `extractCitedPosts(text, posts)` | `lookupPosts(parseCitationRefs(text))` — the interactive path's two-step |

**`AIContext` no longer imports `getPostsByDateRange` at all.** One caller left in the codebase:
`ScraperContext.getScopedPosts` (A1c).

**A pre-existing asymmetry found, characterised, not fixed.** A regenerated summary copies
`postSearch` / `semanticSearchQuery` onto its successor as *metadata*, but has never **applied**
them when regenerating. Making regeneration honour them would be a behaviour change dressed up as
a refactor, so it is recorded in the code comment instead.

`tests/api/test_autoregen_scope_parity.py` (7 tests) pins the substitution: a bare channels+window
scope selects the same posts as the old date-range read, and each defaulted scope field
(`forwarded`, `media`, `maxPerChannel`, `sort`, `seed`) is a **no-op**. Mutation-tested — breaking
the window fails 3, the cap default fails 4, the channel scope fails 1, the forwarded default
fails 1.

> The first round of mutation testing **passed all 7 while the cap was broken**, because I mutated
> the `PromptScope` dataclass default rather than `PromptScopeInput`'s. Only the schema default is
> reachable from the wire, which is the one auto-regenerate actually relies on. The dataclass
> default is dead as far as this path is concerned.

**Verified:** backend **804 passed / 2 skipped**, frontend **715 pass / 0 fail**, mypy strict
clean (128 files), ruff clean, `tsc` clean, biome clean.

##### A1c — `computeScopedPosts` normal branch moved into SQL · ✅ **DONE 2026-08-01**

The last bulk reader. `computeScopedPosts`'s non-semantic branch paged a channel's whole history
into the browser and ran the client filter pipeline over it (`buildFilteredPostsFromRaw`:
keyword → forwarded → media → per-channel cap → sort). It is now **one bounded
`POST /data/posts` call**; every one of those five stages has a server counterpart kept in lockstep
by `app/services/post_filters.py`.

**The read is now bounded, and that is only sound because the server sorts before it limits.**
`limit: SCOPED_POSTS_LIMIT` (200) returns the first 200 of the *same ordering* the client pipeline
produced — not an arbitrary 200. Documented at the constant, because a future reader will otherwise
try to raise it rather than page the feed.

**How much of this branch was actually live turned out to be the interesting part.** Tracing the
callers: `usePostsFeed`, `useScopedPostCounts`, `useCommandRegistry` and `DiscoverView` all call
`getScopedPosts` **only when a semantic/related search is active** — they already had server paths
for everything else. `getPromptPostsInput` likewise. So the unbounded date-range read was reached
from exactly **one** place: `useEntityFlow`'s pick-post pool, which takes `.slice(0, 100)` off it
immediately. A whole-history read to populate a hundred-row picker.

**`channels` is no longer read on this path.** The `unfollowed_forwarded` filter needed the local
channel list to decide what "followed" meant; the server resolves that from `tg_channels`.

**Language detection moved too** (`ScraperContext`, background effect). It was already a *bounded*
read, so not strictly an A1 target, but it went through `repository.getPostsByDateRange` whose only
extra behaviour there was the IndexedDB fallback — which ADR-009 removes. Straight to
`api.getPostsFeed` now.

**`repository.getPostsByDateRange` has zero callers as of this unit.** It is deliberately *not*
deleted here: `repository.posts.test.ts` is the only coverage of `singleFlight`'s de-dup, and A3
is where those assertions get ported to the hook layer. Deleting it now would drop that coverage
with nothing replacing it. It carries a doc comment saying so, and the dead
`getPostsByDateRangeCached` alias (no callers, no tests) is gone.

**Tests rebased, not deleted.** The two normal-path tests asserted client-pipeline parity, which no
longer exists to assert. They now pin the **translation** — that every piece of filter state
reaches the server under the right name — plus a dedicated boundedness test, since a regression to
an unbounded read would not otherwise change any assertion. Mutation-tested: dropping `keyword`
fails 1, unbounding the limit fails 2, zeroing the cap fails 1, hardcoding the sort fails 1,
disabling the semantic branch fails 3.

**Verified:** frontend **717 pass / 0 fail**, `tsc` clean, biome clean.

**A1 is complete.** No `getPostsByDateRange` caller remains outside `lib/cache.ts` (A4) and
`lib/data-transfer/entities/post.ts` (A2).

- **Verify:** `cd backend && uv run pytest tests/ -q`; `bun run --filter tg-summarizer-frontend test:unit`;
  e2e serially. Manually: generate a summary, run a palette search, use semantic search.
- **Risk:** High — touches summary generation. Do this one alone, with nothing else in the PR.
- **Multi-user seam:** put the new search endpoint behind the same `SessionDep`/`CurrentUser`
  deps as `/data/posts`, so row scoping later is a service-layer change only.

#### A2 — Post export reads the server, and pages it · ✅ **DONE 2026-08-01**

The unit's premise held — `entities/post.ts` was the last direct IndexedDB reader outside
`lib/cache.ts` — but the remedy in the plan (*"`GET /data/export` already streams server-side;
route the export UI through it"*) turned out to be about a **different export**. There are two:

| | source | format | consumed by |
|---|---|---|---|
| palette *"Export List of Posts"* | this unit | per-entity JSONL | its own JSONL importer |
| `DatabaseManagement` *"Export DB"* | `workers/dbWorker.ts` → **IndexedDB** | legacy `{type:"store"}` JSONL | its own worker importer |

`GET /data/export` emits a third, unrelated shape (a single version-2 JSON document for
`POST /data/import`) and **has no frontend caller at all**. Routing the palette export through it
would have changed the file format its own importer reads.

**A real bug found and fixed, which is the actual content of this unit.** The online branch called
`api.getPosts({channelNames, startDate, endDate})` with **no `limit`** and treated the result as
the complete corpus. It is not: `PostFeedRequest.limit` defaults to `DEFAULT_POST_PAGE_SIZE`
(**500**). So an operator with more than 500 posts in range got a **silently truncated export
online**, while the IndexedDB branch of the same function wrote every post the browser held. The
two branches disagreed by however many posts the operator had, and nothing in either file recorded
which one produced it.

Now `fetchAllPostsFromServer` pages at `EXPORT_PAGE_SIZE` (5000 = `MAX_POST_PAGE_SIZE`, the largest
the server will serve) until a short page arrives, bounded at `MAX_EXPORT_PAGES`.

**The IndexedDB branch is gone rather than ported.** Under ADR-009 an export assembled from a
possibly-stale local mirror is worse than no export, because nothing in the file says it was stale.
The post commands are disabled while offline instead — the treatment every *import* command already
had. That needed one new field, `DataEntityDef.requiresServer`; channels and summaries do **not**
set it, because their offline source is React state (a view of server data), not a second store.

**Tests.** `backend/tests/api/test_export_paging.py` (5) pins the endpoint behaviour — omitting
`limit` returns one default page, offset paging reaches every row exactly once, a short page ends
the loop, an exact multiple costs one extra request, the page size is capped at 422.
`entities/post.test.ts` (9) pins the loop, with the fetcher injected rather than
`mock.module`-ed (T1's process-wide-mock hazard).

Mutation-tested: removing paging fails 6, stopping on a full page fails 6, freezing the offset
fails 5, per-page progress fails 1 — and removing `MAX_EXPORT_PAGES` **hangs the suite forever**
rather than failing, which is the clearest evidence the bound is load-bearing.

**Carried to A4:** `DatabaseManagement`'s Export/Import DB still round-trips through
`workers/dbWorker.ts` and IndexedDB, and its *import writes nowhere but the browser* — so once A4
deletes the mirror, that import silently becomes a no-op. A4 must repoint both at
`GET /data/export` / `POST /data/import`, and must keep reading the legacy `{type:"store"}` JSONL
so existing backup files still import.

**Verified:** backend **809 passed / 2 skipped**, frontend **726 pass / 0 fail**, mypy strict clean,
ruff clean, `tsc` clean, biome clean.

#### A3 — Collapse `repository.ts` into typed query hooks · **L** · after A1, A2, T1

The remaining ~60 `repository.ts` functions are thin `api` + cache wrappers. Move each caller to
a `hooks/use*.ts` query/mutation. `singleFlight` is subsumed by TanStack Query's request
deduplication (already proven by `lib/repository.test.ts`'s concurrency tests — port those
assertions to the hook layer rather than deleting them).

- Delete `syncMeta`/etag staleness — `staleTime` replaces it.
- Delete the write-fallback handler and its toast in `TgProviders.tsx`.
- **Verify:** full frontend suite + e2e. Grep gate: `grep -rn "lib/repository" frontend/src` → 0.

#### A4 — Delete the IndexedDB layer · **M** · after A3

Remove `lib/cache.ts`, `workers/dbWorker.ts`, `MigrationPrompt.tsx`, `useCachePrune.ts`,
`useBotCredentialMigration.ts`, the `idb` dependency, and the IndexedDB branches of
`DatabaseManagement.tsx`.

- **One-way door.** Any operator who has never logged in since the bot-token migration
  (Decision #2) would lose locally-held tokens. Ship A4 at least one release after A3, and note
  it in the release notes.
- **Verify:** full suites; `grep -rn "idb\|indexedDB" frontend/src` → 0; app boots clean in a fresh profile.

---

### Workstream B — Make the API contract enforceable

*Addresses E1 — the highest-leverage item in the audit, and the prerequisite for E9.*

#### B1 — Declare response models for one resource family, as the pattern · **M** · ✅ **DONE 2026-08-01**

Picked `summaries` — 4 endpoints (not 10 as estimated), well-tested, low blast radius.

**Shipped:** `app/schemas/summaries.py` (`SummaryResponse`, `SummaryListItemResponse`,
`SummaryUpsertRequest`) and `app/schemas/common.py` (`StatusResponse`, extracted because every
family answers a delete with `{"status": "deleted"}`). All four routes annotated; client
regenerated. **Typed responses 26/129 → 30/129.**

**The pattern's one subtlety, now written into `CLAUDE.md`.** A summary is fixed columns plus an
open `extra` JSON blob of UI flags that come and go. The models declare only the always-present
columns and use `ConfigDict(extra="allow")` for the rest. Declaring a *conditional* key —
`promptExcerpt`, present only when there is prompt text — would serialise it as an explicit
`null` wherever it is absent today, silently changing the wire format. So conditional keys are
documented in the model docstring rather than declared. This keeps the payload byte-identical
while the operation still gains a real `$ref`. **Expect the same call in `channels`, `posts` and
`tag-runs`, which all merge an `extra` column.**

**Verified:** backend **733 passed / 1 skipped** (baseline match) with
`tests/api/test_summaries_projection.py` passing **unchanged** — that 264-LOC file is the
wire-compatibility guard, so leaving it untouched is the evidence the payload did not move.
mypy strict clean (106 files), ruff clean, format clean, frontend **686 pass / 0 fail**,
`tsc` clean.

> Two environment notes for later units: `backend/scripts/lint.sh` calls bare `mypy`, so it only
> works with the venv already on `PATH` — use `uv run mypy app` / `uv run ruff check app`
> instead. And a standalone `uv run ty check` reports 31 pre-existing diagnostics from an
> environment-resolution problem; none are in application code, and the pre-commit `ty` hook
> passes.

#### B2 — `channels` family · ✅ **DONE 2026-08-01**

**Shipped:** `app/schemas/channels.py` — `ChannelResponse`, `ChannelStatsResponse`,
`ChannelUpsertRequest`, `SyncMetaEntry`, plus five bulk-operation models
(`BulkReresolveStartIdsResponse`, `BulkResetSyncResponse`, `BulkUpdatedResponse`,
`BulkSettingGroupResponse`, `BulkChannelTagsResponse`). **Typed responses 30/129 → 40/129.**
Every channel-family endpoint is now typed except the SSE `bulk-follow/{id}/events`, which
cannot be.

**The rule got sharper here.** `ChannelResponse` is open (`extra="allow"`) because
`channel_to_camel` merges in group-inherited settings and an optional `stats` block — both
conditional. But the five **bulk** responses are built from dataclasses and literal dicts, so
they are declared **closed**. Passthrough is for payloads that genuinely *are* open, not a
default.

**Wire compatibility is covered by existing tests, not assumed** — and this is what to check
when converting the remaining families:
- `test_stats_logs.py:296` asserts `row["stats"]["count"]` under `includeStats=true` → proves the
  optional `stats` block still passes through.
- `test_setting_groups.py:276` / `test_bulk_sync_settings.py:54` assert `row["regularSyncEnabled"]`
  and `row["autoSyncIntervalMinutes"]` on channel rows → proves group-inherited fields still
  pass through.
- `test_setting_groups.py:232` asserts `PUT` with a group-inherited field still returns **400**
  → proves the permissive `ChannelUpsertRequest` did not turn service-level rejections into 422s.
  **This is the trap to watch for:** a strict request model changes the API's error contract.

**Verified:** backend **733 passed / 1 skipped**, mypy strict clean (107 files), ruff clean,
frontend **686 pass / 0 fail**, `tsc` clean.

#### B3 — `posts` family · ✅ **DONE 2026-08-01**

Split out from the planned `posts` + `discover` unit: together they are 17 endpoints, well past
the ~600-line rule in §2. `discover` becomes B4.

**Shipped:** `app/schemas/posts.py` — `PostResponse`, `BulkUpsertPostsResponse`.
**Typed responses 40/129 → 43/129.**

**`PostResponse` is closed** — no `extra="allow"`. `post_to_camel` emits exactly seventeen keys
and merges nothing conditional. Worth stating plainly: **the open models are the exception in
this codebase, not the pattern.** Only `Summary` and `Channel` carry an open blob.

**One level down, the same trap.** `media` / `links` / `replyTo` stay as loose JSON types even
though `app/schemas/post_media.py` already models the first as `PostMedia`. Media is persisted
via `PostMedia.to_storage_dict()`, which uses `exclude_none=True`, so a stored blob omits its
empty fields — round-tripping it through the declared model on the way out would materialise
those as explicit `null`s for every post with media. `response_model_exclude_none` cannot fix it
either: it applies to the whole response and would strip legitimate nulls from the top-level
fields too. **Declaring a nested model is only safe when the stored shape is complete.**

**Verified:** backend **733 passed / 1 skipped**, mypy strict clean (108 files), ruff clean,
frontend **686 pass / 0 fail**.

#### B4 — `discover` family · ✅ **DONE 2026-08-01**

Twelve endpoints (the earlier note said thirteen; that was a miscount).
**Shipped:** `app/schemas/discover.py` — sixteen models, all **closed**; nothing in this family
merges an open `extra` blob. **Typed responses 42/129 → 53/129.**

**Two models per shape, not one optional field.** `DiscoverCandidateResponse` is what
`compute_discover_candidates` produces; `ReportCandidateResponse` subclasses it and adds `probe`,
the one key a *saved* report resolves at read time. `POST /discover/candidates` does not emit
that key at all, so a single shared model with `probe: X | None = None` would have started
sending `"probe": null` from the stateless aggregate — the same rule that keeps conditional keys
out of `SummaryResponse`, and the reason `DiscoverReportResponse` /
`DiscoverReportListItemResponse` split too.

**This was the first family where declaring the nested shape was safe**, which is the condition
B3 identified: `report_to_camel` reads candidates back out of a JSON column, so a closed model
only works if every persisted row has every key. It does — `_to_candidate` is the single writer,
has had one implementation since it was introduced, and `create_report` is the only constructor
of a `DiscoverReport`. Verify that before declaring a stored blob in later units.

**`requeue_probes` returns `list[str]`, not a count** — caught while writing the model. The
route ships `{"requeued": [...]}`; the UI needs to know *which* rows to repaint as pending.

**New: `tests/api/test_discover_projection.py` (15 tests).** The Discover services are covered
well under `tests/services/`, but those call the service functions directly — response models sit
at the HTTP boundary, so a model that truncates keys or adds `null`s passes every one of them.
This is the first API-level coverage the family has beyond the probe queue. Mutation-tested:
merging `probe` into the base model fails 2 tests, dropping `seenInCount` fails 3.

**Verified:** backend **748 passed / 1 skipped** (733 + 15 new), mypy strict clean (109 files),
ruff clean, frontend **686 pass / 0 fail**, `tsc` clean against the regenerated client.

#### B5 — `logs` + `stats` families · ✅ **DONE 2026-08-01**

Fourteen endpoints. **Shipped:** `app/schemas/logs.py` (five log models + a `LOG_SCHEMAS`
registry that D1 needs) and `app/schemas/stats.py`. **Typed responses 53/129 → 67/129.**

**A log's wire shape is its table.** Every serialiser is `{"id": …, **model_to_camel(row)}`, and
`model_to_camel` camelises whatever columns exist minus `id`/`user_id`/`updated_at`. So these
models are exhaustive by construction, and a new column now fails a test instead of silently
widening an untyped `dict`.

**The trap this unit found — and it bit me.** The wire format is *not* mechanically derived:
`_CAMEL_OVERRIDES` in `services/serialization.py` renames columns explicitly, and two are not
camelisations at all — `model_config_json` ships as **`modelConfig`** and `log_type` ships as
**`type`**. Declaring the obvious alias does not error. It matches nothing on the way in,
defaults the field to `None`, and *renames the key* on the way out: a 200 response that drops a
column's value and emits a key no client has ever seen.

**So the unit also shipped `tests/api/test_schema_aliases.py`**, a package-wide sweep asserting
every declared alias equals `to_camel(field_name)`. New schema modules are covered the moment
they are added. It found B1–B4 clean and one legitimate exemption: `JobsStatusResponse`'s keys
are **job ids** from `JOB_IDS`, not columns, so `auto_sync` is correctly snake_case — the
frontend reads `status.auto_sync?.pauseUntil`. Run this before trusting any future alias.

**Also fixed:** `GET /embedding-logs` declared `dict[str, Any] | list[dict[str, Any]]`, an
untyped `anyOf` in OpenAPI. The service only ever returns a list.

**`PurgeLogsResponse` keeps `total` undeclared.** `DELETE /data/logs` answers three call shapes;
`total` is genuinely absent from two. It travels through `extra` — and because `extra="allow"` is
invisible to mypy, the route builds that response with `model_validate` rather than a keyword.

**Verified:** backend **759 passed / 1 skipped**, mypy strict clean (111 files), ruff clean,
frontend **686 pass / 0 fail**, `tsc` clean.

#### B6 — `jobs` + `telegram` + `network` + `ai` + `rag` · ✅ **DONE 2026-08-01**

Twenty-three endpoints in one PR — the five non-`data` routers, done together because they share
one property: almost every payload here has **conditional keys**.
**Typed responses 67/129 → 89/129.**

**Shipped:** `app/schemas/network.py`, `app/schemas/rag.py`, `app/schemas/telegram_ops.py`,
`app/schemas/ai.py`, and a reworked `app/schemas/jobs.py`.

**Two endpoints gained a schema by deleting code.** `app/ai/models.py` already declared
`CompletionResult` and `EmbeddingResult` as Pydantic models, and `/ai/summary` and
`/ai/embeddings` were calling `.model_dump()` on them *purely* to satisfy a `-> dict[str, Any]`
annotation — throwing the type away on the way out. Returning the model directly is simpler and
correctly typed. Worth checking for this pattern before writing any new model.

**`JobsStatusResponse` was deleted, not used.** It existed, was referenced by nothing, and
wiring it up would have shipped two bugs: it declared **five** jobs against six in `JOB_IDS`
(so `discover_probe` — and every job added later — would have been silently dropped by the
closed model), and its keys are job ids rather than columns, which is why it needed three
exemptions in the alias sweep. `GET /jobs/status` is now `dict[str, JobStatusEntry]`, the shape
it always had. `EXEMPT` is empty again.

**Conditional keys found and left undeclared:** `JobStatusEntry.detail` / `.pauseUntil`,
`TorStatusResponse.autoSpawned`, `TestProxyResponse`'s `ip`/`latency`/`error`. Each would have
emitted a `null` no client has ever received.

**One deliberate behaviour change.** `POST /rag/search` returned a bare `{"results": []}` when
the scope resolved to no channels, but `{results, truncated, scanned}` otherwise — so callers
could not read `truncated` unconditionally. Both branches now return the same key set.

**A type error the models caught:** `telegramChatId` is an `int`, not a string. Declaring it
`str | None` turned `test_telegram_channel_info.py` into a 500 — the existing test caught it.

**And a test of mine that had to be fixed before merge:** the new `/rag/search` case made a live
Gemini call when a key is configured, closing the event loop under the async tests that followed
it. `test_smoke.py::test_rag_search` already skips for exactly this; the new test now does too.
**Any test touching `/rag/search` or `/ai/*` must skip when `GEMINI_API_KEY` is set.**

**Verified:** backend **767 passed / 2 skipped**, mypy strict clean (115 files), ruff clean,
frontend **686 pass / 0 fail** (×3 runs), `tsc` clean. Mutation-tested: declaring `pauseUntil`
fails 2, declaring `autoSpawned` fails 1.

> `legacy.py` re-exports these handlers, so its eleven annotations were propagated to match.
> That module is workstream E's to delete; this only keeps it type-consistent.

> **Two known blind spots in the metric** — it matches `$ref` and `items.$ref` only.
> 1. A precise `dict[str, int]` (e.g. `/posts/counts`) renders as
>    `additionalProperties: {"type": "integer"}` — genuinely typed, not a `$ref`.
> 2. An optional response (`-> Model | None`) renders as `anyOf: [{$ref}, {"type": "null"}]` —
>    also genuinely typed, also not matched. `GET /discover/reports/latest` is the live example.
>
> Don't wrap either in a wrapper model just to move the number. Both mean the real figure runs
> slightly ahead of the reported one.
>
> The pre-B4 baseline is **42/129**, not the 43 recorded when B3 landed; re-measuring `origin/main`
> with the §6 script gave 42. Run that script rather than an ad-hoc one — a script that counts
> `anyOf` differently silently shifts the denominator too.

- **Multi-user seam:** while touching each response model, keep corpus-level artefacts
  (embeddings, clusters, probe results) **user-agnostic** in their schemas, per `MEMORY.md`.
  Scope at read time later; don't bake `user_id` into response shapes now.

#### B6b — The six families the B-series never scheduled · ✅ **DONE 2026-08-01**

**A gap in the plan, not in the execution.** B5/B6 were scoped as "`logs`+`stats`", "`jobs`+
`telegram`+`network`", "`ai`+`rag`" — which quietly left **22 endpoints across six `/data`
families** unassigned to any unit: setting groups, bot credentials, chat destinations, tag runs,
translations, and the settings/import envelopes. B7 surfaced it, because generated types cannot
be re-exported for endpoints still returning `additionalProperties: true`.

**Shipped:** `app/schemas/setting_groups.py`, `credentials.py`, `tag_runs.py`, `vectors.py`, plus
`AppSettingResponse` / `ImportDataResponse` in `common.py`. **Typed responses 81/121 → 104/121.**

**`BotCredentialResponse` is a security boundary, and the test proves it.** It is closed and
carries `hasToken`, never `token`. Demonstrated rather than asserted: making `bot_to_camel` emit
`token` while the model stays closed leaves the test **passing** — the model strips the key.
Opening the model with the same leaky serialiser makes it **fail**. A future serialiser change
therefore cannot leak the token past this model; only editing the model can, which is visible in
review and in the generated client.

**A belief corrected by its own test.** I wrote `channelCount` off as a conditional key
(`setting_group_to_camel` takes `channel_count: int | None = None`). All three call sites supply
it, so it is always on the wire. The model still leaves it undeclared — declaring it with a
default would turn a future omission into `0` rather than an absent key.

**The remaining 17 are genuinely untypeable or metric blind spots:** 5 SSE streams, 3 binary
image routes, 1 streaming export, 3 template utilities, 4 blind spots (`additionalProperties:
$ref` for `sync-meta`/`jobs/status`, `anyOf: [$ref, null]` for `reports/latest`/`translations/one`
— all typed, none counted), and `posts/counts` which is a precise `dict[str, int]`.
**Every domain response now has a declared model.**

**Verified:** backend **791 passed / 2 skipped** (+7 new), mypy strict clean (128 files), ruff
clean, `tsc` clean.

#### B7 — Rebase `types.ts` on the generated client · ✅ **DONE 2026-08-01**

**The plan said "replace with re-exports". Measured, that would have *lost* information in 22 of
24 cases**, in four ways, each verified against the actual types:

1. **Open models erase field names.** `ChannelResponse`/`SummaryResponse` render as a top-level
   `[key: string]: unknown`, so the group-inherited channel settings and summary UI flags — real
   wire fields carried in `extra` — become anonymous.
2. **Nested shapes are loose on purpose.** `TagRun.applyResult`, `Post.media` are `unknown`
   server-side so a prompt or storage change is not a schema migration.
3. **Client-side augmentations.** `ChannelStats.latestId` is written locally after a sync.
4. **Literal-union narrowing.** Four log types know `status` is `"success" | "failed"`; OpenAPI
   says `string`.

**Shipped instead:** the **9 closed** generated types are now the base
(`X = XResponse & <local knowledge>`), so the server's field set can no longer be hand-maintained.
The **6 open** ones stay hand-written — rebasing them produced **190 errors**, because
`Omit<T, K>` over an index signature collapses every named property to `unknown`.

**`src/types.conform.ts` covers those six** — and is a *source* file, not a test, because
`tsconfig.build.json` excludes tests: assertions in a test file would never be type-checked.

**Two bugs in my own guard, both caught by mutation-testing it:**
* The first version could not fail. `never` is assignable to everything, so mapping fields to
  `true | never` and constraining to `Record<string, true>` always passed — both mutations went
  green against it. Collecting the offending *keys* instead is what gives it teeth.
* The second flagged everything, because an open model's index signature puts `string` into
  `keyof`. `DeclaredKeys<T>` strips it.

**Real findings, now recorded in code as exported mismatch sets (→ B7b):** `NetworkLog.status`
and `LLMLog.status` narrow a server `string`; `Post` and `Channel` diverge on the deliberately
loose columns. Hovering the exported type names the offending fields.

**Three genuine type inaccuracies fixed:** `includesQuery` and `resolveFilePath` declared
`string | undefined` for values the server sends as `null` (the runtime already coped — only the
types were wrong), and `PostTranslation.translatedText` is always sent.

**`AlwaysSent<T, K>`** restores fields that a Pydantic default makes *look* optional:
`timestamp: int = 0` is non-required in OpenAPI but always serialised.

**Verified:** `tsc` clean, frontend **695 pass / 0 fail**, biome clean. Mutation-tested: retyping
`Summary.timestamp` server-side fails with `Type '"timestamp"' does not satisfy the constraint
'never'`.

#### B7b — Enforce the remaining four conformance checks · **M** · after B7

Turn `PostMismatches` / `ChannelMismatches` / `LLMLogMismatches` / `NetworkLogMismatches` in
`src/types.conform.ts` into enforced `NoMismatches<…>`. Each needs the hand-written type widened
to the server's looser reality, then the call sites that relied on the narrower one updated.

---

### Workstream C — Split the god-router

*Addresses E2. Fully independent of A and B; can run in parallel.*

#### C1 — `data.py` → one package, one module per resource family · ✅ **DONE 2026-08-01**

Done as **one** unit, not five: the split is only behaviour-preserving if it happens at once —
a half-split module cannot be verified by the OpenAPI diff, which is the whole safety argument.

**Shipped:** `routes/data.py` (1,453 LOC, 73 endpoints, 14 families) → `routes/data/` with
`channels` (425), `discover` (292), `logs` (202), `summaries` (156), `admin` (172), `posts`
(118), `credentials` (99), `vectors` (71), plus `_shared.py` (38) and `__init__.py` (40).
The six inline `BaseModel`s moved to `app/schemas/posts.py` and `app/schemas/discover.py`,
finishing B1's rule — **no route module declares a model any more.**

**The result to check:** `frontend/openapi.json` is **identical order-insensitively** — 304
insertions, 304 deletions, all of it path-key reordering, with the same 129 operations, the same
operation ids and the same component schemas.

**It went wrong first, and quietly.** The initial extraction took each function's span from the
`ast` node's `lineno`, which points at the `def` — so every block boundary orphaned its leading
`@router.…` decorator and **twelve endpoints silently disappeared**, one per extracted range.
They still imported, still type-checked, and 698 of 767 tests still passed. Only the OpenAPI diff
named them. The rewrite addresses functions by name and derives spans from `decorator_list`
upward, and additionally refuses to run if any top-level definition is unassigned.

**So C1 also ships `tests/api/test_route_inventory.py`**, which parses the route modules and
asserts every declared route is mounted, that no module declares routes without being included,
and that the count is still 73. Mutation-tested against both real failure modes: orphaning a
decorator fails 1, dropping an `include_router` fails 3.

> The plan and audit both said "71 endpoints" and "1,438 LOC". Measured: **73** and **1,453**.
> The test asserts the measured number.

**Verified:** backend **770 passed / 2 skipped** (767 + 3 new), mypy strict clean (124 files),
ruff clean, `tsc` clean, OpenAPI diff order-only.

---

### Workstream D — Collapse the ×5 log duplication

*Addresses E3. Independent, but cheaper after B4 (logs response models).*

#### D1 + D2 — One generic log resource · ✅ **DONE 2026-08-01**

Shipped together. D1's aliases existed to let the frontend migrate independently; since this
repo has exactly one frontend and it was migrated in the same change, carrying ten deprecated
paths across a release would have been ceremony rather than safety.

**Backend:** `GET`/`POST /data/logs/{log_type}` replace ten per-type endpoints.
`services/logs.py` gains `LOG_LISTERS` + `list_logs(session, log_type, …)`;
`schemas/logs.py` gains the `LogEntryResponse` union. `routes/data/logs.py` went
**202 → 147 lines**, and **`/data` endpoints 73 → 65**.

**The five tables stay.** A publish log records a destination, a network log records a proxy;
flattening them into one table of mostly-null columns would be a worse database. The genericity
is in the *handling*.

**`LogEntryResponse` is a plain union, not a discriminated one.** The five payloads share no tag
field, and inventing one would change the wire format of all five to serve the type system. The
route already knows `log_type` from the path, so it validates with the exact model and the union
only *describes* the result.

**Frontend:** `api/data.ts` collapses ten functions into `listLogs<T>(type)` /
`createLogs<T>(type, logs)`, with the five named helpers kept as one-line typed sugar.

**What was deliberately *not* done, and why.** The plan also asked for "five `DataContext` fields
→ one record". `DataContext.publishLogs`/`syncLogs`/… feed through `repository.ts` into the
**IndexedDB cache**, which `A3`/`A4` delete outright. Collapsing them now means editing 26 call
sites in 3 components to build something A3 removes. **Deferred to A3**, where those fields are
being reworked anyway. Until then the plan's "~30 files → ~3" payoff is only partly realised.

> **Typed responses went 89/129 → 81/121.** Not a regression: ten typed alias endpoints were
> deleted against two typed ones added. Fewer endpoints, same coverage.

**Verified:** backend **784 passed / 2 skipped** (+19 new), mypy strict clean, ruff clean,
frontend **686 pass / 0 fail**, `tsc` clean. Mutation-tested: pointing the `llm` registry entry
at `EmbeddingLogResponse` fails 3 tests. `test_route_inventory.py`'s count assertion fired on the
+2 and again on the −10, exactly as intended.

---

### Workstream E — Template residue *(decision open)*

*Addresses E8. Blocked on your call — audit §6 is the input.*

The audit's finding: the keep-it argument is easier upstream template re-syncs, but workstream F
deliberately diverges from the template's client config anyway, so that fidelity is being spent
regardless. `users`/auth stays either way — it is load-bearing and multi-user needs it.

- **E1** — delete `items` router + models + `components/Items/` + routes · **S**
- **E2** — delete `routes/legacy.py` (self-declared temporary, non-production only) · **S**
- **E3** — delete `_template_tmp/` · **S**

**Verify:** `uv run pytest tests/ -q`; regenerate client; `bunx tsc --noEmit`; e2e.
Note that `MEMORY.md` records 3 Playwright specs already failing on a pre-existing
`PrivateService` client-generation gap — scope e2e runs to `summarizer.spec.ts` and don't chase those.

---

#### B7b — Enforce all six conformance checks, in the right direction · ✅ **DONE 2026-08-01**

The plan called this "enforce the four remaining checks", assuming they were unfinished work.
**They were not.** Enumerating the mismatch sets — by iteratively `Exclude`-ing each field
TypeScript named, since it reports only the first member of a union — gave exactly eight fields,
and every one is a place where **our type is deliberately narrower than the server's**:

| | server | ours |
|---|---|---|
| `LLMLog.status`, `NetworkLog.status` | `string` | `"success" \| "failed"` |
| `LLMLog.type` | `string` | four known prompt kinds |
| `Post.retrievalPass` | `string \| null` | `"initial" \| "incremental"` |
| `Post.media`, `Post.links` | untyped JSON | `PostMedia`, `PostBodyLink[]` |
| `Channel.tags`, `Channel.discoveredVia` | untyped JSON | shaped |

None is drift, and none is fixable in the original direction: it asks the *server* to declare a
literal union it deliberately does not, or a nested model that `schemas/posts.py` documents at
length why it must not (declaring it changes the wire format — the B3 rule). The mechanical
reading of the plan was to widen our types to match, which would have **thrown away real
knowledge**: those four narrowings are what let a `switch` over log status be exhaustive.

So each model now carries **three** assertions instead of one:

1. `…Conforms` — server fields stay assignable to ours. Catches a **retype**.
2. `…RefinementsHold` — the narrowed fields stay *subtypes* of the server's. Catches a retype
   hiding under a narrowing.
3. `…HasServerFields` — an explicit allowlist of load-bearing columns is still *declared*.

**(3) exists because of a hole found by mutation-testing the guard itself, and the file's own
docstring was asserting the opposite.** It claimed *"Rename `postsCount` … and the corresponding
line stops compiling."* It did not: `MismatchedServerFields` iterates the **intersection** of the
two key sets, so a renamed or dropped column simply leaves the comparison rather than failing it —
silently, guard still green. A mutation renaming a server field compiled clean. This is the same
shape of defect as B7's first draft, which could not fail at all.

**One TypeScript subtlety was load-bearing.** `PostMedia` had to become a `type` alias instead of
an `interface`: TS gives aliases an implicit index signature but withholds one from interfaces, so
only the alias form is assignable to the server's `media?: { [key: string]: unknown }`. Nothing
extends or merges into it, so the forms are otherwise identical.

Mutation-tested (5 drift scenarios): rename a server field ✅, retype a refined field to a number
✅, retype a plain field ✅, change a JSON column's shape ✅. The fifth — **widening *our* type for
an untyped JSON column** — is *not* caught and **cannot be**: the server declares no information to
check against. That limitation is now stated in the file rather than left implicit.

**Verified:** frontend **744 pass / 0 fail**, `tsc` clean, biome clean.

---

### Workstream F — Fix and consolidate the generated client

*Addresses E9. **Must not start before B2–B6** — see audit §6 for why the ordering is forced.*

#### F1a — Drop `@hey-api/schemas` and `asClass` · ✅ **DONE 2026-08-01**

**Shipped:** `schemas.gen.ts` deleted (**5,930 LOC** — it had grown from the audit's 2,986 as
B1–B6 added models) and `asClass: true` removed, so the SDK emits tree-shakeable standalone
functions. The 16 `XService.method()` call sites became `xServiceMethod()`.

> **The audit's bundle claim was wrong, and this unit disproves it.** The audit attributed
> `dist/assets/schemas-*.js` (132.84 kB) to `@hey-api/schemas`. It is not that file. Three
> checks: deleting `schemas.gen.ts` left that chunk **byte-identical** (same content hash); its
> contents are Radix/React helpers, and Vite names the chunk after `src/lib/settings/schema.ts`,
> its entry module; and total assets moved **2204 KB → 2200 KB** across the same 25 chunks.
> `schemas.gen.ts` was never exported from `client/index.ts`, so nothing could import it and it
> was already tree-shaken out.
>
> **The real payoff is repo weight, not bundle size:** 5,930 lines of generated noise that
> regenerated on every API change and buried real diffs. Worth doing — just not for the stated
> reason. §6's metrics table has been corrected.

**Verified:** frontend **686 pass / 0 fail**, `tsc` clean, biome clean, `bun run build` succeeds.

#### F1b — Replace `legacy/axios` with the fetch transport · **M** · *not* S

Split out of F1: the plan sized all three changes as **S** together, which is wrong for this one.
`@hey-api/client-fetch` does not throw — it returns `{data, error, response}` — so the swap
changes error *semantics*, not just wiring:

- `main.tsx` builds its `QueryCache`/`MutationCache` `onError` around `err instanceof ApiError`
- `utils.ts` narrows on both `ApiError` and `AxiosError`
- all 16 call sites currently rely on a throwing client

Plus the `clearStaleSession()` port (the 401/403 redirect from `api/base.ts`), which is the one
behaviour the generated client lacks. Removing the `axios` dependency happens here, not in F1a.

- **Verify:** `tsc`; `bun run lint`; **the e2e login flow specifically** — that is the path the
  error-handling change can silently break, and it is why this needs its own PR.

#### F2 — Move summarizer calls onto the generated client · **L** · after B2–B6 and F1

Replace `api/data.ts` (832 LOC), `api/ai.ts`, `api/jobs.ts`, `api/network.ts`, `api/rag.ts`,
`api/tg.ts` with generated calls. Keep a small hand-written `api/streaming.ts` (~150 LOC) for
the five SSE endpoints and the blob downloads — codegen genuinely cannot express those.

- Supersede **ADR-006** with an ADR recording the corrected rationale: the blocker was never
  SSE (8 endpoints), it was untyped responses (103) — now fixed.
- **Verify:** full frontend suite + e2e. Streaming paths (summary stream, sync SSE, bulk-follow
  SSE) need manual confirmation; they are the least test-covered part of the app.

---

### Workstream T — Build the missing testing seam *(prerequisite)*

*Addresses E11. **Gates A3, G1 and G2** — do not start those without it.*

#### T1 — Add `@testing-library/react` + `renderHook` · **S** · ✅ **DONE 2026-08-01**

The repo had **no** capability to test a hook or a context: 0 of 9 contexts and 2 of 32 hooks
tested, because neither `@testing-library/react` nor `renderHook` existed. Every context/hook
refactor in this plan was otherwise verifiable only through Playwright e2e.

**Shipped:** `@testing-library/react` 16.3.2 + `@happy-dom/global-registrator`, wired through
`frontend/bunfig.toml` → `frontend/test-setup.ts`. No Vitest needed — `bun test` works. Seven
tests on `DataContext` covering the selection-reconciling effect and its localStorage
persistence.

**Two things the work taught, both worth carrying into later units:**

1. **Bun's `mock.module` is process-wide, not file-scoped.** A first draft mocked
   `@/lib/repository` and silently broke `repository.test.ts` once the whole suite ran in one
   process — it hung. The fix is to avoid module mocks in context tests: **seed the react-query
   cache instead.** Only three of `DataContext`'s queries can fetch (the five log queries and
   `dbStats` are `enabled: false`), and seeded entries stay fresh for `SUMMARIZER_STALE_TIME`
   (30 s), so no `queryFn` runs. Use this pattern for `T2` and the `G1` tests.
2. **A global DOM changes existing behaviour.** `repository.posts.test.ts` assigned
   `globalThis.localStorage` unconditionally with the comment *"bun's runtime has no
   localStorage"*; happy-dom now provides one as a **readonly** property, so it threw. Fixed to
   polyfill only when genuinely absent, so the file is correct with or without the preload.

**Verified:** frontend **686 pass / 0 fail** across 99 files (baseline 679/98 — the delta is
exactly the 7 new tests); `tsc -p tsconfig.build.json` clean; biome clean; `bun run build`
succeeds. The new tests were **mutation-tested** — breaking auto-add fails 5, breaking
vanish-removal fails 1, breaking persistence fails 1 — so they have teeth rather than merely
passing.

> Note: `tsconfig.build.json` excludes `src/**/*.test.tsx`, so test files are not typechecked by
> the project's typecheck command. Pre-existing, not introduced here, but it means a type error
> in a test only surfaces at runtime.

#### T2 — Characterisation tests for the sync-job watcher · ✅ **DONE 2026-08-01**

**Not done by mocking the context.** `ScraperContext` imports `@/api`, and two existing test
files import it too — `mock.module` is process-wide, so mocking it would have reproduced exactly
the T1 failure that hung the suite. The repo already has a better pattern, recorded in
`useDiscoverProbeQueue.test.ts`: lift the decision into a pure function and test that.

**Shipped:** `src/lib/sync/job-state.ts` — `isTerminalSyncStatus`, `deriveScrapingChannels`,
`hasRateLimitError`, `shouldFallBackToPolling` — plus 20 characterisation tests.
`ScraperContext` now calls them, so the tests guard the real path rather than a copy.

**This is G1's safety net *and* a down payment on it**: `useSyncJob` extracts these decisions,
and they are now already extracted and covered.

**Two warts characterised, not fixed** (T2's contract): `hasRateLimitError` regexes the error
*string*, so an unrelated error mentioning "rate limit" trips the banner and a plain `HTTP 429`
does not. Both are asserted as-is and labelled `WART:` in the test names.

**One real duplication removed:** `["completed", "failed", "cancelled"]` was written out inline
**three times** in one file — the sync poller, the SSE watcher, and the follow-job watcher. That
is how one of them ends up missing a state after the backend gains a fourth.

**A bug in my own test, found by mutation-testing it.** The first version used
`test.each([...TERMINAL_SYNC_STATUSES])`, which is self-referential: deleting `"cancelled"`
deleted a *test case* rather than failing one, so the suite went from 19 passing to 18 passing
and reported success. The set is now asserted literally; the same mutation fails 2 tests.

**Verified:** frontend **714 pass / 0 fail**, `tsc` clean, biome clean.

---

### Workstream G — Break up `ScraperContext` and thin the provider tree

*Addresses E4. G1 is much cheaper after A1 removes the scoped-posts fetching, and **must not
start before T2** — there is currently no test covering any of this code.*

#### G1 — Split `ScraperContext` by job · ✅ **DONE 2026-08-01**

**1,104 → 632 LOC**, five responsibilities down to two.

| New home | LOC | Takes |
|---|---|---|
| `hooks/usePostFilters.ts` | 185 | the 10 filter/search `useState`s, their 4 `localStorage` effects, both debounces, `postViewOptions` |
| `hooks/useSyncJob.ts` | 281 | `runServerSync`, `waitSyncJob`, `pollSyncJobFallback`, `applySyncJobStatus`, `scrapingChannels`, the failure backoff |
| `hooks/useFollowJob.ts` | 279 | `waitFollowJob`, `followDiscoverChannels` |
| `hooks/usePromptPosts.ts` | 167 | `getScopedPosts`, `getPromptPostsInput` |

What stays in the context is now one thing: **scrape orchestration** — `handleScrapeChannel` and
its siblings, the sync queue, `addNewChannel`, the language-detection effect, and composition.

**Hooks, not a new context — one deviation from the plan, deliberately.** The plan put filter state
in `contexts/PostFilterContext.tsx`. Splitting the *context* means changing every consumer, and the
value of doing so is a re-render optimisation that **G2 is the right place to bank**, once it
decides which providers survive. Doing it here would have made a large mechanical diff whose
correctness rests on the same e2e suite the plan says is not a sufficient net for this refactor.
So the state moved out; where it is *published* did not. `usePostFilters` is a context away when G2
wants it.

**The public surface is byte-identical** — verified by extracting and diffing the provider's
`value={{…}}` block against `origin/main`. **Zero consumer files changed.** That is the property
that made this safe to do in one step: any behaviour change has to be inside a moved function, and
the three riskiest (`waitSyncJob`, `pollSyncJobFallback`, `waitFollowJob`) were diffed
whitespace-insensitively against the original and confirmed **verbatim**.

**Two pieces of dead weight found by moving the code:**

1. **`activeJobRef` was written in four places and read in none.** A ref tracking the in-flight job
   id that nothing consumed. Deleted.
2. **`runServerSync` invalidated the post views twice** — `await handleFilterPosts()` followed by
   `invalidatePostViews()`, where `handleFilterPosts` *is* `invalidatePostViews`. Collapsed to one;
   `handleFilterPosts` survives as the name consumers call.

**A typing bug the move surfaced.** `FollowJobDeps` first restated the five proxy settings by hand
and got two of them wrong — `defaultProxyUrls` / `torProxyUrls` are a newline-or-comma-separated
`string`, not `string[]`. It now `extends ProxySettings`, so the shape cannot drift again. This is
the same class of defect workstream B exists to remove, one layer down.

**Tests: 726 → 744.** `usePromptPosts.test.ts` (7) pins the scope-vs-posts decision — the
load-bearing one, since a scope on the semantic path would silently summarise the *unranked*
corpus. `usePostFilters.test.ts` (11) pins hydration against hostile stored values (a non-numeric
cap must not become `NaN`, an unknown sort must not reach the server as a 422) and pins which four
keys persist. Both use `renderHook` with **injected** dependencies — no `mock.module`, per T1.

Mutation-tested: cap fallback 2 fail, sort fallback 1, dropped persistence 1, semantic→scope 2,
dropped keyword 2.

**Verified:** frontend **744 pass / 0 fail** across 103 files, `tsc` clean, biome clean.

#### G2 — Reduce the provider tree · **M** · after G1 and A3 (so after T1/T2)

11 providers nested 11 deep → ~5. Providers whose entire content is server data
(`DataContext`'s 9 repository-fed fields) become query hooks; only UI-state providers remain.

#### G3 — Extract the settings binding · ✅ **DONE 2026-08-01**

**The premise had already half-happened.** `settings-schema.ts` was *already* driven by
`SETTINGS_CATALOG` — the fold the plan describes was largely done before this programme started.
What remained was exactly what audit §E5 named: the command layer **re-deriving** setters and
clamping.

**Shipped (569 → 538 LOC):**
* `booleanSetter` / `numberSetter` / `stringSetter` → one generic `catalogSetter<T>`. The three
  were byte-identical apart from a cast applied to a value they never inspect.
* `clampInt` / `clampFloat` → one `parseAgainstControl(value, control)`, taking bounds from the
  catalog control rather than re-deriving them with `control.min ?? 0` / `control.max ?? 1`.
* The deprecated `BOOLEAN_SETTINGS` / `NUMERIC_EDITOR_DEFS` exports deleted, and their two tests
  rewritten to assert against the built commands — a test reading a *parallel* list could pass
  while the palette itself was missing the command.

**Those `??` fallbacks were dead code.** All 12 number controls declare `min`, and the single
`step: "any"` control declares both bounds, so no behaviour changed. Verified by enumerating the
catalog rather than assumed.

**The real find: the binding had no tests at all.** Every existing test asserted a command's
*shape* — id, label, badge — and none ever *ran* one. Breaking `catalogSetter`'s name derivation
left all 90 passing. Eight new tests drive the commands through a spying settings proxy; the same
mutation now fails **7**, and clamp/toggle mutations fail 1 each.

**Verified:** frontend **695 pass / 0 fail** (12 consecutive runs), `tsc` clean, biome clean.

> **Known rare flake, unrelated to this unit.** `src/lib/channels/mirror-hydration.test.ts`
> failed twice in roughly twenty full-suite runs across this programme, always with
> `QuotaExceededError` from its localStorage-quota simulation — happy-dom registers `localStorage`
> globally (T1), so quota state is shared across files and the failure depends on execution order.
> It did not reproduce in 12 consecutive runs. Pre-existing; not investigated further here because
> no unit in this plan touches that file. Re-run before believing it.

---

### Workstream H — Tame the sync path

*Addresses E6/E7. Independent of everything else.*

#### H1 + H2 — Decompose the sync-path god-functions · ✅ **DONE 2026-08-01**

| function | before | after |
|---|---|---|
| `_apply_scrape_page` | 258 | **120** |
| `sync_single_channel` | 206 | **110** |
| `import_data` | 211 | **~30** (largest section importer: 63) |

**Named stages, not line slices**, per the rule in `CLAUDE.md`. New functions:
`_reconcile_telegram_chat_id`, `_freeze_channel_for_chat_id_problem`, `_refresh_channel_meta`,
`_persist_page_posts`, `_collect_new_forwards`, `_decide_next_page`, `_fetch_one_page`,
`_walk_channel_pages`, and seven per-section importers.

**`_ChannelWalk` is passed *in*, not returned.** Both `except` handlers in `sync_single_channel`
need `requests_log`/`responses_log` even when the walk raises part-way — returning the state
would lose exactly the diagnostic payload those error logs exist to carry.

**Two subtleties preserved and now documented rather than implicit:** the chat-id *conflict*
branch freezes the channel but **does not** stop the sync, while the *mismatch* branch does; and
the `needs_backfill` transition genuinely appears twice, because an incremental pass can end
either by meeting stored posts or by running out of new ones.

**Tests were not touched** — `git diff --stat -- tests/` is empty, which was the contract.
Backend **784 passed / 2 skipped**, mypy strict clean, ruff clean.

> **The `< 80` target is not met, deliberately.** `_apply_scrape_page` is 120 lines and is now a
> readable sequence of named stages; cutting further would be line-slicing, which the rule
> forbids. And the **largest backend function is now `jobs/retention.py::run_retention_cleanup`
> at 174** — never in H1/H2's scope. If the metric matters, that is the next target, not more
> cuts here.

#### H3 — Write down the service-boundary rule · **S** · ✅ **DONE 2026-08-01**

The cheapest unit in the plan and possibly the highest long-run value. Add to `CLAUDE.md` a
one-paragraph rule for when code becomes its own service module. Then note the modules that
violate it and either merge them or record why they are exceptions.

**Shipped:** a five-kind taxonomy in `CLAUDE.md` (aggregate / read model / integration / pure
transform / orchestrator) plus the anti-rule *never split because a file got long*, and three
recorded exceptions.

**What the analysis changed:** classifying all 44 modules against the rule showed **41 fit
cleanly** — the `discover_*` and `post_*` clusters are principled, not arbitrary. Audit §E7 has
been corrected accordingly. The real defect was the *absence of a rule*, not the module count.
One finding to carry into workstream C: `routes/data.py` writes `AppSetting` directly, which
also violates thin-routes.

---

### Workstream I — Component size outliers

*Addresses E10. **Lowest priority — do not schedule this on its own.***

Split `HistoryView` (962), `SummaryView` (910), `ChannelCard` (823) **only** where G1/A3 already
force changes in them. Splitting a component to reduce a line count is churn that costs review
time and buys little. Included here so it is explicitly deprioritised rather than forgotten.

---

## 3b. What is left, as of 2026-08-01

Everything below is unstarted. Nothing here is blocked except workstream E.

| Unit | Size | Blocked by | Note |
|---|---|---|---|
| **A3** — collapse `repository.ts` into query hooks | **L** | — | 66 exported functions, **47 consumer files**. The largest and riskiest remaining unit: it touches every write path. Port `repository.test.ts`'s `singleFlight` concurrency assertions to the hook layer rather than deleting them, and delete the now-callerless `getPostsByDateRange` here. |
| **A4** — delete the IndexedDB layer | **M** | A3 | **Must also repoint `DatabaseManagement`'s Export/Import DB** at `GET /data/export` / `POST /data/import` — see A2. That import currently writes *nowhere but the browser*, so deleting the mirror without repointing it turns the feature into a silent no-op. Keep reading the legacy `{type:"store"}` JSONL so existing backups still import. One-way door: ship a release after A3. |
| **G2** — reduce the provider tree | **M** | A3 | Also the right place to promote `usePostFilters` to a context, which G1 deliberately deferred. |
| **F1b** — `legacy/axios` → fetch transport | **M** | — | Independent. Changes error *semantics* (`{data, error}` vs throwing); needs the e2e login flow. |
| **F2** — summarizer calls onto the generated client | **L** | F1b | Supersede ADR-006 with the corrected rationale. |
| **E1/E2/E3** — template residue | 3×**S** | **your decision** | Blocks nothing. |
| **I** — component size outliers | — | — | Explicitly deprioritised; only where G1/A3 force changes. |

**Recommended order:** `F1b` (independent, unblocks F2) → `A3` → `A4` + `G2` in parallel → `F2`.

---

## 4. Suggested order

Three tracks that can proceed in parallel; only the arrows are hard dependencies.

```
Track 0 (enabler)    T1 → T2                       ← gates A3, G1, G2. Start this first.
Track 1 (contract)   B1 → B2…B6 → B7 → F2          [F1 anytime]
Track 2 (data path)  A0 → A1 → A3 → A4             [A2 anytime after A0]
Track 3 (structure)  C1…C5 · D1 → D2 · H1 · H2 · H3 · G3
                                                   G1 (after T2, A1) → G2 (after A3)
```

**If you only do four things:** `H3` (write the service-boundary rule — S), `T1` (make hooks and
contexts testable at all — S), `B1` (response-model pattern + convention — M), `A1` (move the
last bulk post readers to the server — L). Those four set the direction; the rest is execution.

**First PRs to open:** `H3` and `A0` (both documentation — they cannot break anything and they
keep everything after them on-course), then `T1` (small, and it unblocks the largest and riskiest
units). Do not start G1 or A3 until T1/T2 have landed: those files currently have **zero** test
coverage, and Playwright is not a substitute for a unit-level safety net during a refactor.

---

## 5. Explicitly not doing

Recorded so they are decisions, not oversights:

- **Not** touching the boundedness guarantees from `architecture-remediation-plan.md` §12. Every
  refactor must preserve them; re-run that section's grep checks before merging A1, A3, C*.
- **Not** implementing multi-user. Seams only (decision #3).
- **Not** reducing test coverage. With CI billing-blocked the suites are the only safety net.
- **Not** restructuring `components/ui/` (43 vendored shadcn primitives) — upstream code.
- **Not** touching the AI provider registry, the parser modules, `queryKeys`, or
  `lib/settings/schema.ts` — audit §5 marks these as load-bearing and already well-shaped.
- **Not** adopting a generated client before response models exist (audit §6 — the ordering is
  forced, and reversing it makes type safety strictly worse).
- **Not** absorbing the robustness backlog from `docs/discover-probe-queue-plan.md` §5 —
  `bulk_follow` job durability (P0), startup reconciliation of `tg_sync_jobs` (P1), retention for
  `tg_summaries`/`tg_tag_runs` (P1), `useSyncQueue` as a `useEffect` work queue (P2), the
  random-cap seed and tie-break drift (P2), the semantic ≤50-post cap (P2), and the
  single-process state inventory (P3). Those are correctness and durability issues, not entropy;
  they stay tracked in that document. Two caveats: the seed/tie-break drift is the same disease
  as E1 and should get easier after workstream B, and **P0 is higher priority than anything in
  this plan** — an unrecoverable job is worse than a messy one.

---

## 6. How we will know it worked

Measurable, re-runnable — same discipline as the remediation plan's §12.

Re-measured **2026-08-01**, after A1a–A1c, A2, B7b and G1.

| Metric | Start | Now | Target |
|---|---|---|---|
| Data-access paths from `components/` | 7 | **6** (`lib/cache` down to 2 files) | 2 |
| Client-side caches / staleness systems | 3 | 3 (A3/A4 remove two) | 1 |
| Generated-client LOC | 10,796 | **4,866** | — |
| `$ref`-typed API responses | 26/129 | **104/121** | all typeable (17 are SSE/binary/blob/template) |
| Hand-written domain types mirroring server tables | 24 | **6**, all now compiler-enforced (B7b) | 0 |
| Largest route module | 1,438 LOC | **425** | < 400 |
| Largest frontend context | 1,103 LOC | **717** (`AIContext`; `ScraperContext` now 632) | < 300 |
| Largest backend function | 257 | **173** (`run_retention_cleanup`, out of H scope) | < 80 |
| Files touched to add a log type | ~30 | **~12** (→ ~3 after A3) | ~3 |
| Contexts with a test | 0/9 | 1/9 (`DataContext`) | ≥ 5/5 (after G2) |
| Hooks with a test | 2/32 | **6/36** | the ones holding logic |
| Frontend LOC (excl. generated) | 59,881 | 61,888 | ≈ 54,000 |
| Frontend tests | 679 | **744** | — |
| Backend tests | 767 | **809** | — |
| Runtime deps removed | — | none yet | `idb`, `axios` |

> **Two metrics have moved the "wrong" way, and both are expected.** Frontend LOC is *up* ~2,000:
> this programme has so far been adding tests, response models and documented seams, while the
> ~5,950-line deletion it promises is concentrated in **A3/A4** (`repository.ts`, `lib/cache.ts`,
> `dbWorker.ts`), which have not run yet. `AIContext` overtaking `ScraperContext` as the largest
> context is likewise arithmetic, not regression — G1 cut the latter by 40%.

Re-run commands:

```bash
# data-access paths
cd frontend/src && for p in '@/api' '@/client' 'lib/repository' 'lib/cache' 'contexts/' 'useQuery'; do
  echo "$p: $(grep -rl "$p" components | wc -l)"; done

# typed responses (heredoc, not -c: a bare $ref gets eaten by shell escaping)
cd frontend && python3 - <<"PY"
import json
d = json.load(open("openapi.json"))
ops = [o for p in d["paths"].values() for o in p.values() if isinstance(o, dict)]
def typed(o):
    s = o.get("responses", {}).get("200", {}).get("content", {}).get("application/json", {}).get("schema", {})
    return bool(s.get("$ref") or (s.get("items") or {}).get("$ref"))
print(f"{sum(map(typed, ops))} / {len(ops)} operations have a $ref-typed 200 response")
PY

# longest backend functions
cd "$(git rev-parse --show-toplevel)" && python3 - <<"PY"
import ast, pathlib
rows = []
for p in pathlib.Path("backend/app").rglob("*.py"):
    if "alembic" in str(p): continue
    try: tree = ast.parse(p.read_text())
    except SyntaxError: continue
    for n in ast.walk(tree):
        if isinstance(n, (ast.FunctionDef, ast.AsyncFunctionDef)) and n.end_lineno:
            rows.append((n.end_lineno - n.lineno, str(p), n.lineno, n.name))
for loc, path, line, name in sorted(rows, reverse=True)[:15]:
    print(f"{loc:5d}  {path}:{line}  {name}")
PY
```
