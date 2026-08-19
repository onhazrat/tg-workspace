# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## What this is

Self-hosted Telegram channel summarizer, migrated from a standalone app (`TG-Summarizer/`, a parity reference, may be absent from some clones) into a FastAPI + React monorepo. See `README.md` and `development.md` for the full operator/setup guide; `docs/migration/` holds the ADRs and locked decisions (`DECISIONS.md`).

## Layout

- `backend/` — FastAPI API, AI providers, scraping, APScheduler jobs, PostgreSQL (SQLModel + Alembic). Managed by **uv as a workspace whose `.venv` lives at the repo root** — run `uv sync` from the root, not from `backend/`.
- `frontend/` — React 19 + Vite, managed by **bun** (root `package.json` declares the `frontend` workspace).
- Root `.env` is authoritative for **both** halves: backend reads it via `app.core.config.Settings`; the frontend reads `VITE_*` vars from the same file (`vite.config.ts` sets `envDir` to the repo root). Do not create `frontend/.env`. `.env.example` documents every tunable.

## Common commands

Backend (native, from repo root unless noted):
```bash
uv sync                                              # install (creates root .venv)
uv run fastapi dev backend/app/main.py --port 8000   # dev server (or: cd backend && uv run fastapi dev app/main.py)
cd backend && uv run pytest tests/ -q                # tests (see isolation note below)
cd backend && uv run pytest tests/api/routes/test_items.py::test_name  # single test
cd backend && bash scripts/lint.sh                   # mypy + ty + ruff check + ruff format --check
cd backend && uv run alembic revision --autogenerate -m "msg"   # new migration after model change
cd backend && uv run alembic upgrade head            # apply migrations
```

Frontend (from repo root or `frontend/`):
```bash
bun install
bun run dev                          # Vite on :5173, proxies /api → :8000
bun run --filter tg-summarizer-frontend test:unit    # bun test src
bun run lint                         # biome check --write (no semicolons, double quotes)
cd frontend && bunx tsc -p tsconfig.build.json --noEmit   # typecheck
cd frontend && bunx playwright test  # e2e; needs backend up (docker compose up -d db prestart backend)
```

Full stack via Docker: `docker compose watch` (frontend :5173, API :8000, Swagger :8000/docs, Adminer :8080). Lint/format everything: `cd backend && uv run prek run --all-files`.

## Backend architecture

- **Two model modules, intentionally split.** `app/models.py` holds only the template auth models (`User`, `Item`). All domain models — channels, posts, summaries, bot credentials, embeddings, logs, sync metadata, and `AppSetting` (JSON settings rows) — live in `app/models_tg.py`. Alembic imports both.
- **Thin routes, fat services.** `app/api/routes/*.py` are thin; business logic lives in `app/services/*.py` (e.g. `routes/data/channels.py` → the `channels.py`/`posts.py`/`credentials.py` services). **`/data` is a package, one module per resource family** (`routes/data/`): it was a single 1,453-line router until C1 split it. The parent router in `data/__init__.py` owns the `/data` prefix and the `data` tag, so operation ids stay `data-<function_name>` — never change a route function's name without expecting the generated client to change with it. `tests/api/test_route_inventory.py` asserts every declared route is actually mounted. `sync_orchestrator.py` drives channel sync (backward pagination, auto-follow); `proxy_pool.py` gives per-proxy lane semaphores; `scraper.py` fetches/parses `t.me`. AI providers are pluggable under `app/ai/providers/` behind a registry (`app/ai/registry.py`).
- **Every route declares a response model.** *Enforced: `tests/api/test_route_module_hygiene.py`.* Request *and* response models live in `app/schemas/<resource>.py` — never inline `BaseModel` in a route module. A route returning `dict[str, Any]` becomes `{"additionalProperties": true}` in OpenAPI and `Record<string, unknown>` in the generated TypeScript, which is why the frontend hand-maintains duplicate domain interfaces that no compiler keeps in step. `app/schemas/summaries.py` is the reference (B1); shapes shared across families (e.g. `StatusResponse` for `{"status": "deleted"}`) go in `app/schemas/common.py`.
  - **A list view must not carry a field only its detail view renders.** Twice now: `/data/summaries` shipped 26 MB a page, and `/data/logs/sync` shipped **56.28 MB for 500 rows, 99.7% of it request/response bodies**, for a viewer that expands one row at a time. The shape both times is *list light + `GET .../{id}` full*, with the text search moved into SQL so the dropped fields stay findable without being sent (`services/summaries.py::_search_clause`, `services/logs.py::LOG_SEARCH_COLUMNS`). Splitting a table is not enough on its own — `tg_sync_log_payloads` had existed for weeks and the list joined it straight back in.
  - **A corpus-sized field does not belong in an open `extra` column.** TOAST is all-or-nothing per value, so reading *one small flag* out of `extra` detoasts everything in it. `Summary.extra` held `citedPosts`/`promptText`/`chatMessages` and a 49-row page cost 26 MB and 2.69 s to return 1.15 MB. They now live in `tg_summary_payloads`; `tg_sync_log_payloads` is the same shape for the same reason. **Pushing the projection into SQL does not fix this** — it was measured at 2.86 s, because the detoast and parse happen server-side either way. Split it into a companion *table*, not a sibling column: a table is fail-closed, a deferred column is one forgotten `defer()` away from the original cost.
  - **Rows with an open `extra` JSON column** (`Summary`, and anything else merging `extra` into its payload) use `model_config = ConfigDict(extra="allow")` and declare only the *always-present* columns. Do **not** declare a conditional key just to be thorough: a declared optional field serialises as an explicit `null` where the key is absent today, which silently changes the wire format. Let conditional keys flow through `extra`, and say so in the model docstring.
  - Migration progress is measurable — count `$ref`-typed 200 responses in `frontend/openapi.json` (see §6 of `docs/architecture-simplification-plan.md`). It was 26/129 before B1.
- **Every service module is one of five kinds.** *Enforced: `tests/services/test_service_kinds.py`, which holds the full per-module inventory — that file, not this list, is the authority.* `app/services/` has 44 modules; without a rule, every new feature re-litigates where its code goes. New code must fit one kind, and say which:
  1. **Aggregate** — owns one table and is the *only* module that writes it (`channels.py`, `posts.py`, `summaries.py`, `discover_reports.py`, `settings_store.py`). A **companion payload table** belongs to its parent's aggregate, not to a module of its own: `logs.py` owns `tg_sync_log_payloads` and `summaries.py` owns `tg_summary_payloads`, because the split is a storage detail the API never sees and only one module should know the row is really two.
  2. **Read model** — read-only aggregation across tables; takes a `Session`, never commits (`discover.py`, `runtime_config.py`). *Not `stats.py`* — this list used to claim it was one, but `clear_table` deletes across every aggregate's table and commits, so it is a declared exception.
  3. **Integration** — owns one external boundary (`scraper.py` → `t.me`, `network.py` → HTTP/proxy, `publish.py` → Bot API, `embeddings.py` → provider).
  4. **Pure transform** — no `Session`, no network, trivially testable (`post_media_parser.py`, `post_reply_parser.py`, `channel_tags.py`, `serialization.py`).
  5. **Orchestrator** — owns one workflow and coordinates the other four (`sync_orchestrator.py`, `bulk_follow.py`, `data_import_export.py`).

  **Never split a module because it got long.** A file extracted only to reduce a line count must fit one of the five kinds or be merged back — decomposing `sync_orchestrator.py` means extracting named *stages*, not slicing lines. Deliberate exceptions live in `EXCEPTIONS` in the test, each with a reason: `async_db.py` is an infrastructure utility that belongs in `core/`, not `services/`; `followed_channels.py` writes `Channel` alongside `channels.py` so the Discover and auto-follow paths share one creation path; `stats.py` is a read model carrying one destructive admin operation. Separately, `AppSetting` has three writers (`settings_store.py`, `jobs/settings.py`, and — against the thin-routes rule — `routes/data/admin.py` directly).
- **Router assembly.** `app/api/main.py` builds the `/api/v1` router; `private` routes mount only when `ENVIRONMENT == "local"`. `app/main.py` adds `APIKeyMiddleware`, CORS (outermost, so preflight beats auth), the lifespan (startup checks → `init_db` → `start_scheduler`), and a middleware that returns **410** for any `/api/*` not under `/api/v1/*` in production.
- **Auth dependencies** (`app/api/deps.py`): `SessionDep`, `CurrentUser` (JWT), `get_current_active_superuser`. **Mode A** (single-operator, hardened) is the deployment model: all AI/RAG/network/telegram/jobs routes require auth; in staging/production a request must carry a JWT **or** `X-API-Key` (fail-closed); raw bot tokens in request bodies are rejected outside `local` (use stored `credentialId`). One superuser owns all data — no per-user row scoping yet.
- **Scheduler runs in-process, single replica** (APScheduler). Do **not** scale the backend horizontally without external job coordination (ADR-004). **This is currently violated in the deployed image**: `backend/Dockerfile:45` is `fastapi run --workers 4`, so four APSchedulers tick in parallel and `has_active_sync_job()` — an in-process dict — cannot deduplicate across them. Measured: four `Auto Sync (scheduler)` jobs per tick, 4x every scheduled job's cost, and 711 rows stranded in `running`. See `docs/scheduler-db-cost-plan.md`.
- **Never hold a session open across `await`ed work.** A transaction left `idle in transaction` pins the xmin horizon, so autovacuum reclaims nothing for as long as it lasts: `run_auto_sync` planned and synced inside one `with Session(engine)` and left `tg_sync_meta` with **10 live rows and 4,743 dead** after 1,062 autovacuums. The symptom is not a slow query — it is single-row updates by primary key that are instant 99% of the time and stall for 21 seconds occasionally, with no I/O and nothing in `pg_blocking_pids`. Read what you need, project it to plain values, close the session, *then* do the slow thing.
- **Sync progress is pushed over SSE**, not polled: `POST /api/v1/jobs/sync` → `GET /api/v1/jobs/sync/{id}/events`. One-shot `GET .../{id}` is the reconnect fallback.
- **Three layers answer "why is this slow", and they are not interchangeable.** See **Finding slow endpoints** in `deployment.md`. Traefik's JSON access log is the only one that sees *transfer* cost (`backend/scripts/slow_endpoints.py` aggregates it, ranked by total time); `app/middleware/timing.py` gives `Server-Timing` plus a slow-request WARNING keyed by route template; `pg_stat_statements` names the query and its I/O. Reach for the edge log first — this project's bottleneck has moved off the backend before and every server-side number said it was fine. **But the edge log cannot see background work at all**, and after two rounds where it named the culprit it was tempting to stop there: with every endpoint under a second, `pg_stat_statements` still showed the auto-sync tick spending **69 minutes of database time per 10 hours** on stats it discarded (`docs/scheduler-db-cost-plan.md`). Nothing in the top ten by total time was a request. When the layers disagree about whether the system is busy, the one counting requests is the one that is blind.
- **A scheduled job pays its cost every tick, forever.** The endpoint rounds were each triggered by someone waiting; a job nobody is watching has no such signal, so the same "compute it for everything, read one field" defect ran for months. Before batching a computation across every row, check what the caller reads and *when it could possibly matter* — `sync_schedule.needs_dynamic_stats` is that check made explicit, and it took 2,077 channels down to six.
- **Compression is Traefik's job, not the app's.** Deployed responses are gzipped by a `compress` middleware declared on the `backend`/`frontend` service labels in `compose.yml` (see `deployment.md`). Do **not** add Starlette's `GZipMiddleware` to `app/main.py`: it would double-encode behind the proxy, and unlike Traefik it buffers, which *would* stall the SSE routes. `uv run fastapi dev` serves uncompressed — that is expected, and it is why payload sizes look different locally than in the browser against staging.

## Frontend architecture

- **Two API clients, split per *call* by contract (ADR-006).** *Enforced: `src/api/client-split.conform.ts`.* Generated `frontend/src/client/` (committed, do not hand-edit) for the admin/user shell **and** every summarizer call whose response type is at least as useful as a hand-written one. Hand-written `frontend/src/api/` for the rest: SSE streams, blob downloads, and calls whose generated type would be a *downgrade* — either an **open** model (`extra="allow"` → a top-level `[key: string]: unknown`, so `extra` keys arrive as `unknown`) or a **closed but all-optional** one (OpenAPI cannot say "has a default, therefore always present"). The split is per call, not per family: `jobs` has five generated and three hand-written. Measure openness with `string extends keyof T`, never by grepping for `[key: string]` — that also counts *nested* index signatures. After backend API changes, regenerate with `bash scripts/generate-client.sh` (runs with `ENVIRONMENT=production`).
- **Server state = TanStack Query, always.** *Enforced (partially): `src/lib/architecture-invariants.test.ts` pins `DataContext`'s field set, so server state cannot be re-added there.* `DataContext` derives from queries and exposes Dispatch-compatible setters as query-cache write-throughs (`hooks/useChannels.ts`, generic helper `lib/applySetStateAction.ts`); query keys in `hooks/queryKeys.ts`. Add new server state through react-query, not context `useState`.
- **PostgreSQL is the only client-side store.** *Enforced: `src/lib/architecture-invariants.test.ts`.* A4 deleted the IndexedDB mirror (−2,491 lines) — no `idb`/`localforage`/`dexie` dependency, no `indexedDB`, no DB worker. The browser keeps settings and the current selection, nothing else.
- **Settings = schema-driven.** All localStorage-backed settings are declared in `frontend/src/lib/settings/schema.ts` (zod: key, default, legacy keys, backend section); `SettingsContext.tsx` is a thin provider over generated setters. Add settings to the schema, not as new `useState` hooks. Theme is owned by `theme-provider` in `main.tsx` (`localStorage: vite-ui-theme`) — do not add a second theme toggle (*that one is enforced*; the schema rule is **not** — be careful).
- **Routing/tabs come from the URL.** TanStack Router. The active summarizer tab is the `?tab=` param on `/summarizer` (not localStorage); settings sub-sections use `?section=`.

## Testing & migrations

- **pytest uses a separate database (`app_test`) always** — `tests/conftest.py` overrides `POSTGRES_DB` to it and each test truncates `tg_*` tables afterward. Never point the dev server at `app_test`, and keep `POSTGRES_DB=app` for dev. One-time: `createdb app_test && cd backend && POSTGRES_DB=app_test uv run alembic upgrade head`.
- After changing any model, generate an Alembic revision and commit it; migrations live in `backend/app/alembic/versions/`.
- Maintenance/backfill scripts live in `backend/scripts/` (run with `uv run python backend/scripts/<name>.py`, usually `--dry-run` first) — see `MEMORY.md`.

## Architecture guards — read this before "simplifying" something

The rules above are not all equal. Some are **enforced** by a compile error or a
failing test; the rest are prose and rely on you. Prose decayed here before: this
file said *"never inline `BaseModel` in a route module"* from B1 onward, and three
modules were violating it when the guards below were written. So when a guard
fires, the answer is almost never to delete the guard.

| Guard | Enforces | Kind |
|---|---|---|
| `frontend/src/types.conform.ts` | hand-written domain types match the server | compile error |
| `frontend/src/api/client-split.conform.ts` | the two-client split, **in both directions** | compile error |
| `frontend/src/lib/architecture-invariants.test.ts` | no browser DB; `DataContext` stays small; one theme owner | test |
| `backend/tests/api/test_route_module_hygiene.py` | no models in route modules; handlers annotate returns | test |
| `backend/tests/services/test_service_kinds.py` | every service module declares one of the five kinds | test |
| `backend/tests/api/test_route_inventory.py` | declared routes are actually mounted | test |
| `backend/tests/api/test_*_projection.py` | response key sets — no invented `null`s | test |
| `backend/tests/services/test_photo_cache_lookup_cost.py` | image-cache lookups don't scan the directory, in **both** twin modules | test |
| `backend/tests/services/test_summary_list_payload_cost.py` | listing summaries never opens the corpus table, **and the detail call does** | test |
| `backend/tests/services/test_log_list_payload_cost.py` | log lists drop the bodies; the detail route keeps them; search still reaches them | test |
| `backend/tests/services/test_sync_schedule_stats_narrowing.py` | the scheduler fetches stats only where they can change its answer — and **still fetches them where they can** | test |
| `backend/tests/services/test_sync_job_flush_cost.py` | job progress rides the flush interval; terminal states still write immediately | test |
| `backend/tests/services/test_sync_meta_commit_cost.py` | the etag moves in the same transaction as the change it announces | test |
| `backend/tests/jobs/test_auto_sync_session_scope.py` | the scheduler closes its planning transaction before syncing | test |
| pre-commit `generate-frontend-sdk` | the committed client matches the backend | hook |

**A fix applied to one of two twin modules is half a fix.** `channel_photos.py` and
`post_thumbnails.py` are the same module twice over (same `_META_SUFFIX`, `_meta_path`,
`_find_image_path`, `has_cached_*`, bounded extension set). The thumb cache was fixed to
probe extensions instead of globbing, with the reasoning in its docstring; the avatar
cache kept the glob for two more months and turned a channel list into 30 seconds. Its
guard is parametrised over *both* modules for that reason — when you fix one of a pair,
guard the pair.

`client-split.conform.ts` is the pattern worth copying. It asserts not only that
the *generated* models stayed closed, but that the *hand-written* ones are still
open — so closing one server-side breaks the build and tells you the call can now
move. **A deliberate exception that nothing checks becomes a leftover nobody dares
touch.** Assert the reason, not just the state.

**Mutation-test every guard before trusting it.** A green suite proves nothing
until you have watched it go red. This caught a false pass in six separate units
of the simplification programme — including one guard that could not fail at all.

## Conventions

- Python: mypy `strict`, `ty check`, ruff (isort, bugbear, no `print` — `T201`). Alembic dir excluded from lint/type-check.
- TS/React: biome, **no semicolons, double quotes**.
- CI test workflows are billing-blocked and never start, so as of 2026-07-30 their `push`/`pull_request` triggers are **commented out** (`grep -rn CI-DISABLED .github/workflows/`; see `.github/workflows/DISABLED.md` for the list and how to re-enable). Expect **no** checks on a PR; run lint/tests locally instead. Only the self-hosted staging deploy runs.
- **Every commit that lands on `main` must be signed** — but that does *not* mean signing every commit. Squash-merging a PR satisfies it automatically: GitHub authors the squash commit and signs it with its own key, so commits on a branch or in a `.claude/worktrees/` worktree need no signature and must never block on one. **Land PRs with squash merge only** — merge-commit mode puts the branch's own commits on `main` as-is, and rebase-merge replays them unsigned. When committing **directly to `main`**, sign locally (1Password); there a signing failure is a blocker to raise, not to bypass with `gpgsign=false`.
- Local `git log %G?` is **not** a valid signature check here — it reports `N` on genuinely SSH-signed commits (`gpg.ssh.allowedSignersFile` is unset) and `E` on GitHub's PGP-signed ones. Audit `main` against GitHub instead: `gh api 'repos/{owner}/{repo}/commits?sha=main&per_page=20' --jq '.[] | select(.commit.verification.verified | not) | .sha'` (empty output = clean).

## graphify

This project has a knowledge graph at graphify-out/ with god nodes, community structure, and cross-file relationships.

Rules:
- For codebase questions, first run `graphify query "<question>"` when graphify-out/graph.json exists. Use `graphify path "<A>" "<B>"` for relationships and `graphify explain "<concept>"` for focused concepts. These return a scoped subgraph, usually much smaller than GRAPH_REPORT.md or raw grep output.
- If graphify-out/wiki/index.md exists, use it for broad navigation instead of raw source browsing.
- Read graphify-out/GRAPH_REPORT.md only for broad architecture review or when query/path/explain do not surface enough context.
- After modifying code, run `graphify update .` to keep the graph current (AST-only, no API cost).
