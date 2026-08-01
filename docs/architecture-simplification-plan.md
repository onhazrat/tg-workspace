# Architecture simplification plan

**Date:** 2026-07-31
**Status:** In progress — execution started 2026-08-01. Landed: `H3`, `A0`, `T1`, `B1`–`B6`, `F1a`.
Typed responses **89/129** (was 26). Contexts with a test **1/9** (was 0).
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
| `AIContext.tsx:496` (prompt assembly) | already has a server path — `getPromptPostsInput` returns a `PromptScope`; extend it to cover the remaining branch |
| `ScraperContext.getScopedPosts` → `lib/posts/scoped-posts.ts` | server-side filter+sort, as `usePostsView` already does |
| `lib/commands/search-filters.ts:34` (palette search) | a bounded server search endpoint |

Semantic/related search legitimately cannot be reproduced server-side and keeps a client path —
that split already exists and is documented in `ScraperContext`; preserve it.

- **Verify:** `cd backend && uv run pytest tests/ -q`; `bun run --filter tg-summarizer-frontend test:unit`;
  e2e serially. Manually: generate a summary, run a palette search, use semantic search.
- **Risk:** High — touches summary generation. Do this one alone, with nothing else in the PR.
- **Multi-user seam:** put the new search endpoint behind the same `SessionDep`/`CurrentUser`
  deps as `/data/posts`, so row scoping later is a service-layer change only.

#### A2 — Move export to stream from the server · **M** · independent of A1

`lib/data-transfer/entities/post.ts:76` reads IndexedDB directly — the one place that bypasses
both stacks. `GET /data/export` already streams server-side; route the export UI through it.

- **Verify:** export a dataset, re-import it, compare row counts (`tests/api/test_data.py` covers the endpoint).

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

#### B7 — Retire `types.ts` server mirrors · **M** · after B2–B6

Replace the 24 hand-written domain interfaces with re-exports of generated types. Keep
UI-only types (`TabType`, `SyncQueueItem`, `ChatMessage`) in `types.ts`.

- **Verify:** `bunx tsc -p tsconfig.build.json --noEmit` is the test. Expect real breakage here —
  that is the point: each error is a place where the frontend's belief about the server was
  already wrong.

---

### Workstream C — Split the god-router

*Addresses E2. Fully independent of A and B; can run in parallel.*

#### C1–C5 — `data.py` → one module per resource family · **M each** · no dependencies

1,438 LOC / 73 endpoints / 14 families → `routes/channels.py`, `routes/posts.py`,
`routes/discover.py`, `routes/summaries.py`, `routes/logs.py`, `routes/settings.py`,
`routes/admin.py`. Move the 6 inline `BaseModel`s into `app/schemas/` as you go (B1's rule).

- **Keep every URL path identical.** This is a pure file-move: same `prefix="/data"`, same
  operation ids, so the generated client and all frontend callers are unaffected.
- **Verify:** `uv run pytest tests/ -q`; then diff the OpenAPI before/after —
  `bash scripts/generate-client.sh && git diff --stat frontend/openapi.json` should show
  **no path changes**. That diff is the proof the move was behaviour-preserving.
- **Risk:** Low — mechanical, and the OpenAPI diff catches mistakes.

---

### Workstream D — Collapse the ×5 log duplication

*Addresses E3. Independent, but cheaper after B4 (logs response models).*

#### D1 — One generic log resource on the backend · **M**

`services/logs.py` already has `_list_logs_page[LogModel]`. Extend the genericity outward: a
registry mapping `log_type → (model, schema)`, and **two** endpoints
(`GET /logs/{log_type}`, `POST /logs/{log_type}`) replacing ten.

- Keep the five tables — they have different columns and that is legitimate. Genericise the
  *handling*, not the storage.
- **Compatibility:** keep the ten old paths as thin aliases for one release so the frontend can
  migrate in D2 independently.
- **Verify:** `tests/api/test_stats_logs.py` must pass unchanged against the alias paths.

#### D2 — One log hook and one log type on the frontend · **S** · after D1

Five query hooks → one parameterised `useLogsQuery(logType)`; five `DataContext` fields → one
record. Then drop the aliases from D1.

- **Payoff to state in the PR:** adding a sixth log type goes from ~30 files to ~3.

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

#### T2 — Characterisation tests for `ScraperContext` · **M** · after T1, before G1

Pin current behaviour of the five responsibilities *before* splitting them — especially
`handleScrapeChannel` (lines 608–853) and the SSE/fallback-poll logic. These tests are the
safety net G1 will otherwise not have.

- Write them against today's behaviour, warts included; do not fix bugs in this PR.
- **Verify:** tests pass on unmodified `main`. If one doesn't, it is describing a bug — record
  it, don't paper over it.

---

### Workstream G — Break up `ScraperContext` and thin the provider tree

*Addresses E4. G1 is much cheaper after A1 removes the scoped-posts fetching, and **must not
start before T2** — there is currently no test covering any of this code.*

#### G1 — Split `ScraperContext` by job · **L** · after T2; best after A1

1,103 LOC / 14 `useState` / 5 responsibilities →

| New home | Takes |
|---|---|
| `contexts/PostFilterContext.tsx` | filter/sort UI state (7 `useState`) — genuinely UI state, stays a context |
| `hooks/useSyncJob.ts` | `runServerSync`, `waitSyncJob`, `pollSyncJobFallback`, SSE |
| `hooks/useFollowJob.ts` | `waitFollowJob`, `followDiscoverChannels` |
| `hooks/usePromptPosts.ts` | `getPromptPostsInput` |
| *(deleted by A1)* | `getScopedPosts` |

- **Verify:** frontend suite + e2e. `handleScrapeChannel` (lines 608–853) is the risky part —
  read it fully before moving it.

#### G2 — Reduce the provider tree · **M** · after G1 and A3 (so after T1/T2)

11 providers nested 11 deep → ~5. Providers whose entire content is server data
(`DataContext`'s 9 repository-fed fields) become query hooks; only UI-state providers remain.

#### G3 — Extract `useCommandRegistry` settings binding · **S** · independent

Fold `lib/commands/settings-schema.ts` (569 LOC) into a generic binding over
`SETTINGS_CATALOG`, so a setting's parse/clamp/setter is declared once (E5). Leaves two
settings systems (persistence + presentation), which is a defensible split — three is not.

---

### Workstream H — Tame the sync path

*Addresses E6/E7. Independent of everything else.*

#### H1 — Decompose `_apply_scrape_page` · **M**

257 LOC at `sync_orchestrator.py:484`, the hardest function in the backend. Extract the
distinct stages (parse → dedupe → persist → telemetry → follow-detection) into named functions.

- **Verify:** `tests/api/test_sync_jobs.py` (779 LOC) must pass **unchanged** — do not edit tests
  in this PR. If a test needs changing, the refactor changed behaviour: stop and reconsider.

#### H2 — Decompose `sync_single_channel` (205 LOC) and `import_data` (210 LOC) · **M**

Same discipline. `import_data` is covered by `test_data.py`.

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

| Metric | Today | Target |
|---|---|---|
| Data-access paths from `components/` | 7 | 2 |
| Client-side caches / staleness systems | 3 | 1 |
| Generated-client LOC | 10,796 → **4,866** | — |
| `$ref`-typed API responses | 26/129 → **89/129** | 129/129 |
| Hand-written domain types mirroring server tables | 24 | 0 |
| Largest route module | 1,438 LOC | < 400 |
| Largest frontend context | 1,103 LOC | < 300 |
| Largest backend function | 257 LOC | < 80 |
| Files touched to add a log type | ~30 | ~3 |
| Contexts with a test | 0/9 | ≥ 5/5 (after G2 consolidation) |
| Hooks with a test | 2/32 | the ones holding logic |
| Frontend LOC (excl. generated) | 59,881 | ≈ 54,000 |
| Runtime deps removed | — | `idb`, `axios` |

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
