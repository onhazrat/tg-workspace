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
- **Thin routes, fat services.** `app/api/routes/*.py` are thin; business logic lives in `app/services/*.py` (e.g. `data.py` route → `channels.py`/`posts.py`/`credentials.py` services). `sync_orchestrator.py` drives channel sync (backward pagination, auto-follow); `proxy_pool.py` gives per-proxy lane semaphores; `scraper.py` fetches/parses `t.me`. AI providers are pluggable under `app/ai/providers/` behind a registry (`app/ai/registry.py`).
- **Every service module is one of five kinds.** `app/services/` has 44 modules; without a rule, every new feature re-litigates where its code goes. New code must fit one kind, and say which:
  1. **Aggregate** — owns one table and is the *only* module that writes it (`channels.py`, `posts.py`, `summaries.py`, `discover_reports.py`, `settings_store.py`).
  2. **Read model** — read-only aggregation across tables; takes a `Session`, never commits (`discover.py`, `stats.py`).
  3. **Integration** — owns one external boundary (`scraper.py` → `t.me`, `network.py` → HTTP/proxy, `publish.py` → Bot API, `embeddings.py` → provider).
  4. **Pure transform** — no `Session`, no network, trivially testable (`post_media_parser.py`, `post_reply_parser.py`, `channel_tags.py`, `serialization.py`).
  5. **Orchestrator** — owns one workflow and coordinates the other four (`sync_orchestrator.py`, `bulk_follow.py`, `data_import_export.py`).

  **Never split a module because it got long.** A file extracted only to reduce a line count must fit one of the five kinds or be merged back — decomposing `sync_orchestrator.py` means extracting named *stages*, not slicing lines. Three deliberate exceptions exist today: `async_db.py` is an infrastructure utility that belongs in `core/`, not `services/`; `followed_channels.py` writes `Channel` alongside `channels.py` so the Discover and auto-follow paths share one creation path; and `AppSetting` has three writers (`settings_store.py`, `jobs/settings.py`, and — against the thin-routes rule — `routes/data.py` directly).
- **Router assembly.** `app/api/main.py` builds the `/api/v1` router; `private` routes mount only when `ENVIRONMENT == "local"`. `app/main.py` adds `APIKeyMiddleware`, CORS (outermost, so preflight beats auth), the lifespan (startup checks → `init_db` → `start_scheduler`), and a middleware that returns **410** for any `/api/*` not under `/api/v1/*` in production.
- **Auth dependencies** (`app/api/deps.py`): `SessionDep`, `CurrentUser` (JWT), `get_current_active_superuser`. **Mode A** (single-operator, hardened) is the deployment model: all AI/RAG/network/telegram/jobs routes require auth; in staging/production a request must carry a JWT **or** `X-API-Key` (fail-closed); raw bot tokens in request bodies are rejected outside `local` (use stored `credentialId`). One superuser owns all data — no per-user row scoping yet.
- **Scheduler runs in-process, single replica** (APScheduler). Do **not** scale the backend horizontally without external job coordination (ADR-004).
- **Sync progress is pushed over SSE**, not polled: `POST /api/v1/jobs/sync` → `GET /api/v1/jobs/sync/{id}/events`. One-shot `GET .../{id}` is the reconnect fallback.

## Frontend architecture

- **Two API clients, by design (ADR-006).** Hand-written `frontend/src/api/` for the summarizer (REST + SSE streaming + bulk payloads); generated `frontend/src/client/` (committed, do not hand-edit) for the admin/user shell only. After backend API changes, regenerate with `bash scripts/generate-client.sh` — it runs with `ENVIRONMENT=production` so the committed `frontend/openapi.json` excludes legacy routes.
- **Server state = TanStack Query, always.** `DataContext` derives from queries and exposes Dispatch-compatible setters as query-cache write-throughs (`hooks/useChannels.ts`, generic helper `lib/applySetStateAction.ts`); query keys in `hooks/queryKeys.ts`. Add new server state through react-query, not context `useState`.
- **Settings = schema-driven.** All localStorage-backed settings are declared in `frontend/src/lib/settings/schema.ts` (zod: key, default, legacy keys, backend section); `SettingsContext.tsx` is a thin provider over generated setters. Add settings to the schema, not as new `useState` hooks. Theme is owned by `theme-provider` in `main.tsx` (`localStorage: vite-ui-theme`) — do not add a second theme toggle.
- **Routing/tabs come from the URL.** TanStack Router. The active summarizer tab is the `?tab=` param on `/summarizer` (not localStorage); settings sub-sections use `?section=`.

## Testing & migrations

- **pytest uses a separate database (`app_test`) always** — `tests/conftest.py` overrides `POSTGRES_DB` to it and each test truncates `tg_*` tables afterward. Never point the dev server at `app_test`, and keep `POSTGRES_DB=app` for dev. One-time: `createdb app_test && cd backend && POSTGRES_DB=app_test uv run alembic upgrade head`.
- After changing any model, generate an Alembic revision and commit it; migrations live in `backend/app/alembic/versions/`.
- Maintenance/backfill scripts live in `backend/scripts/` (run with `uv run python backend/scripts/<name>.py`, usually `--dry-run` first) — see `MEMORY.md`.

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
