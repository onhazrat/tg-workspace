# Architecture simplification plan

**Date:** 2026-07-31
**Status:** In progress — execution started 2026-08-01. Landed: `H3`.
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

---

## 3. The backlog

Each unit is independently shippable. **Size**: S ≈ half a day, M ≈ 1–2 days, L ≈ 3–5 days.
Dependencies are noted explicitly and are few by design.

---

### Workstream A — Retire the second data architecture

*Addresses the §3 central finding. The largest single reduction in the plan.*

Sequenced internally (each still ships alone), because callers must move off `repository.ts`
before it can be deleted.

#### A0 — Supersede ADR-003 and Decisions #4/#5 · **S** · no dependencies

Documentation only, but it must land **first** so later PRs aren't relitigating a locked ADR.

- Add `docs/migration/ADR-009-server-authoritative-data.md`: server is the single source of
  truth; TanStack Query is the only client cache; no offline browsing.
- Mark ADR-003 `Superseded by ADR-009`; annotate Decisions #4 and #5 in `DECISIONS.md` with the
  date, the reason (feed already server-only; multi-user roadmap), and a link.
- **Verify:** links resolve; no code touched.

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

#### B1 — Declare response models for one resource family, as the pattern · **M** · no dependencies

Pick `summaries` (10 endpoints, well-tested, low blast radius). Add response models to
`app/schemas/`, annotate the routes, regenerate the client, and **write the convention down** in
`CLAUDE.md`: *every route declares a response model; every request and response model lives in
`app/schemas/<resource>.py`; no inline `BaseModel` in route modules.*

- **Verify:** `cd backend && bash scripts/lint.sh` (mypy strict + ty + ruff); `uv run pytest tests/ -q`;
  `bash scripts/generate-client.sh`; `cd frontend && bunx tsc -p tsconfig.build.json --noEmit`.
- **Deliverable beyond code:** the convention paragraph. Without it this decays.

#### B2–B6 — Roll response models across the remaining families · **M each** · after B1

One PR per family: `channels` · `posts` + `discover` · `logs` + `stats` · `jobs` + `telegram` +
`network` · `ai` + `rag`. Each independently mergeable; each moves the 26/129 typed-response
count up. Track it — the number is a clean progress metric.

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

#### F1 — Fix the codegen config · **S** · independent of B

Three changes, each independently valuable and safe today:

- drop `@hey-api/schemas` → removes `schemas.gen.ts`, **2,986 unused LOC**
- drop `asClass: true` → restores tree-shaking
- replace `legacy/axios` with the fetch transport → removes the second HTTP stack and the
  `axios` dependency (`utils.ts` is the only non-generated consumer)

Port `clearStaleSession()` (the 401/403 redirect from `api/base.ts`) onto the generated client
as an interceptor — it is the one behaviour the generated client lacks.

- **Verify:** `bunx tsc --noEmit`; `bun run lint`; e2e login flow. Check the built bundle shrinks.

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

#### T1 — Add `@testing-library/react` + `renderHook` · **S** · no dependencies

The repo has **no** capability to test a hook or a context: 0 of 9 contexts and 2 of 32 hooks
are tested, because neither `@testing-library/react` nor `renderHook` exists in
`frontend/package.json`. Every context/hook refactor in this plan is otherwise verifiable only
through Playwright e2e — slow, serial-only, and needing a rebuilt backend.

- Add the dependency; confirm it runs under `bun test` (the repo uses `bun test src`, not Vitest —
  check compatibility early, and fall back to Vitest for component tests if needed).
- Land one real test as proof: `DataContext` (393 LOC, the simplest and the one whose
  react-query-derived shape is the model for the others).
- **Verify:** `bun run --filter tg-summarizer-frontend test:unit` green, new test included.

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
| `$ref`-typed API responses | 26/129 | 129/129 |
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
