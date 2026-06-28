# TG Summarizer — Project Memory

> Last synced: 2026-06-25 (UI polish commit `58550dd`)

## Purpose

Self-hosted Telegram channel summarizer. Migrated from browser-heavy `TG-Summarizer/` (React + Express + IndexedDB) to a **FastAPI + React monorepo** with scraping, scheduling, AI, and PostgreSQL on the server. **Migration Phases 0–7 complete (2026-06-08).** **Mode A remediation** largely complete through 2026-06-09 — see [REMEDIATION-PLAN.md](docs/migration/REMEDIATION-PLAN.md). **Pre-feature codebase cleanup complete (2026-06-22).** **UI polish Phases A–G complete (2026-06-25)** — [ui polish audit plan](.cursor/plans/ui_polish_audit.plan.md). Run commands: [README.md](README.md), [development.md](development.md).

## Architecture

- **`backend/`** — FastAPI (`app/main.py`), SQLModel (`app/models_tg.py`), Alembic, services (`scraper.py`, `sync_orchestrator.py`, `proxy_pool.py`, …), APScheduler jobs, pluggable AI (`app/ai/`, Gemini first).
- **`frontend/`** — React 19 + Vite + TanStack Router/Query; dual-route UI:
  - **`/_tg/summarizer`** — full-screen TG app (`App.tsx` + `TgProviders`); **command palette** on `main`; **keyboard shortcuts dialog** (`?` + header button).
  - **`/_layout/*`** — template admin shell (`/`, `/items`, `/admin`, `/settings`)
- **Command palette:** `CommandPalette*.tsx`, `CommandConfirmDialog.tsx`, `PaletteKeyboardChrome.tsx`; hooks `useCommandPalette`, `useCommandRegistry`, `useCommandSearchAffinity`, `useRecentCommands`, `useJobToggles`, `usePaletteListSelection`; registry in `frontend/src/lib/commands/`; data transfer in `frontend/src/lib/data-transfer/` (21 commands); channel CRUD in `frontend/src/lib/channels/`.
- **Modals (TG shell):** shadcn/Radix `Dialog` only — **`Modal.tsx` removed** (2026-06-25). Confirm flows in `ChannelGrid`, `HistoryView`, `PasteSummaryModal`, `DatabaseManagement`, `MigrationPrompt`.
- **API clients (ADR-006):** hand-written `frontend/src/api/` (summarizer); generated `frontend/src/client/` (admin/auth). Regenerate: `bash scripts/generate-client.sh` (default `ENVIRONMENT=production`; override `ENVIRONMENT=local` for Playwright/private routes).
- **Data layer (frontend):** `repository.ts` API-first → `cache.ts` (IndexedDB). **`db.ts` removed**.
- **Tunables:** `backend/app/core/config.py` + `frontend/src/lib/env.ts` (`VITE_*`); `.env.example`.
- **`TG-Summarizer/`** — Original reference; not deployed.
- **`docs/ideas-log/`** — Backlog (`IDEA-NNN`); index [IDEAS-LOG.md](docs/ideas-log/IDEAS-LOG.md).
- **uv workspace** + **bun** frontend. **Playwright E2E only** (~94 tests; palette K1–K17 + summarizer UI in `summarizer.spec.ts`).
- **CI/CD:** GitHub-hosted tests on push; self-hosted deploy via `deploy-staging.yml` / `deploy-production.yml` — [deployment.md](deployment.md).

### Key API surfaces

- Versioned: `/api/v1/telegram/*`, `/network/*`, `/ai/*`, `/data/*`, `/rag/*`, `/jobs/*`
- **AI summary:** generate, stream, **`POST /api/v1/ai/summary/prompt`** (Copy Prompt; no LLM call)
- **Legacy `/api/*`:** `local` only; **410 Gone in production**
- **Channel sync:** `POST /api/v1/jobs/sync` → SSE `GET .../events`
- **Runtime diagnostics:** `GET /api/v1/jobs/runtime-config`
- OpenAPI: `/docs`, `/api/v1/openapi.json`

## Data pipelines

- **Authoritative store:** PostgreSQL; IndexedDB read-through cache ([ADR-003](docs/migration/ADR-003-hybrid-sync.md)).
- **Scrape/sync (backward-sync era):** `sync_orchestrator.py`; cutoff via `compute_scrape_cutoff_ms()`. **Lazy migration** — deep backfill after Reset & Sync or bulk reset-sync.
- **Coverage:** `Post.is_anchor`, `Channel.history_complete_to_cutoff`, gaps in `tg_post_sync_state`.
- **Auto-follow forwarded:** Per-channel `autoFollowForwarded` only (not global).
- **Embeddings/RAG:** Server Gemini; skip anchors; pgvector deferred ([ADR-005](docs/migration/ADR-005-vector-search.md)).
- **Jobs:** `auto_sync`, `embeddings`, `auto_summary`, `retention`, `translation_batch`.

## Analysis conventions

- **Channel identity:** `channel_id` / `name`; API camelCase.
- **Timestamps:** ms since epoch.
- **Default Channel Start Time / sync concurrency / proxy slots:** Settings → Scraping & Sync / Network; verify via `runtime-config`.
- **Auto-follow UI:** Toggle on each **ChannelCard** (rounded pill). Distinct from **Auto-Followed** badge (`discoveredVia`).
- **Summarizer UI:** URL tabs `/summarizer?tab=` — **6 workspace tabs** (channels, posts, summary, chat, history, **settings**); settings sub-sections `?tab=settings&section=`. **Post-login redirect:** `/summarizer`. Guided tour when no channels. Summary toolbar: Generate + Copy Prompt.
- **Command palette:** `Cmd+Shift+P` / `Ctrl+Shift+P` + header icon; settings + jobs + navigate + channel ops + data transfer + in-palette search. Keyboard UX (IDEA-007): `usePaletteListSelection`, K1–K17 E2E. Detail: [IDEA-007](docs/ideas-log/ideas/IDEA-007-command-palette-keyboard-ux.md).
- **Keyboard shortcuts reference:** `?` (non-editable contexts) + header keyboard button → dialog listing shortcuts.
- **External AI summary flow:** Copy Prompt → pending history entry; complete via **`PasteSummaryModal`** on that item. Completed: `source: "pasted"`. Pending view has explicit paste instructions.
- **Theme:** `theme-provider` (`vite-ui-theme`); TG app root uses `app-*` tokens + `tg-wcag-floor` class for metadata typography floor.
- **Initial load UX:** skeleton placeholders in `ChannelGrid` / `PostFeed` (`isInitialChannelsLoading`, `isInitialPostLoadPending`).
- **PostCard:** long posts collapse with Show More / Collapse; action bar visible on hover **and** `focus-within`.
- **Channel grid:** `md:2 / lg:3 / xl:4` columns; shadcn `Select` for filters/sort; filtered count “Showing X of Y”; bulk freeze/unfreeze always confirms (matches palette).
- **Appearance toggles:** incl. `showChannelStartId` (default **false**) — gates Start ID field on ChannelCard.
- **Telegram publish:** SummaryView warns when content exceeds **4096** chars.

## Decisions (stable)

Locked [DECISIONS.md](docs/migration/DECISIONS.md) + items through command palette (IDEA-001–007) + **UI polish audit (2026-06-25, commit `58550dd`)**:

1. **Single-operator (Mode A)** — Production: `API_KEY`, `TOKEN_ENCRYPTION_KEY`, strong `SECRET_KEY`, `USERS_OPEN_REGISTRATION=false`. Mode B deferred.
2. **Auth** — JWT + optional `X-API-Key`; fail-closed on sensitive routes in non-local.
3. **Data** — Postgres authoritative; IndexedDB cache; API-first writes.
4. **Jobs** — APScheduler in-process; single replica ([ADR-004](docs/migration/ADR-004-job-runner.md)).
5. **Backward scrape / per-channel auto-follow / Cloudflare DNS TLS / proxy pool (IDEA-003) / external AI paste flow / template tooling / command palette IDEA-001–007** — see [DECISIONS.md](docs/migration/DECISIONS.md) and idea detail files; keyboard UX on `main` (`e803203` then UI polish `58550dd`).
6. **UI polish — desktop-only** — Summarizer workspace targets desktop; mobile tab overflow / responsive stats **out of scope** (Q1, 2026-06-25).
7. **UI polish — WCAG 2.1 AA** — Card actions via `focus-within`; typography floor (`tg-wcag-floor` + component fixes); skip-nav; shadcn `Dialog` for all TG modals (`Modal.tsx` removed).
8. **UI polish — Settings tab** — Settings is a **labeled workspace tab** (gear icon removed).
9. **UI polish — channel grid** — `md:2 / lg:3 / xl:4`; shadcn `Select`; filtered count; bulk freeze/unfreeze always confirms.
10. **UI polish — deferred** — `SettingsView.tsx` per-section split; mobile responsive polish.

### Explicitly rejected / deferred

- Mode B, Celery/Redis, pgvector, deleting `TG-Summarizer/`, global auto-follow, TLS-01, producer-consumer queue, global paste toolbar, `Cmd/Ctrl+K` palette shortcut, admin-shell palette, rename channel in palette.
- **Mobile-first summarizer UI** — desktop-only by user choice (2026-06-25).
- **SettingsView.tsx refactor** — defer until next heavy settings work.

## User preferences

- Self-hosted single operator; discuss trade-offs before big architectural bets.
- Per-user proxy URLs; tune proxy slots + `syncConcurrency` together; verify via `runtime-config`.
- Centralize tunables in `.env` / `.env.example`.
- **Only commit when explicitly asked**; plan files may be checkbox-updated when user requests.
- **Ideas log** — deferred work in `docs/ideas-log/`; start sessions with *"Work on IDEA-NNN."*
- **Command palette / UI polish:** use AskQuestion for product decisions; no assumptions on shortcuts, phasing, or mobile scope.
- **Rename channel in palette** — rejected.

## Environment & fixes

- **Native dev:** `uv sync` → alembic on `app` → uvicorn :8000; `bun run dev` :5173. **`POSTGRES_DB=app`** for API.
- **Pre-commit:** `uv run prek run --all-files`; `bun run lint` (Biome).
- **Playwright:** `ENVIRONMENT=local bash scripts/generate-client.sh` → Docker image or local Chrome. **`frontend/tests/utils/privateApi.ts`** sets `OpenAPI.BASE` fallback chain: `VITE_API_URL` → `PLAYWRIGHT_API_URL` → `http://localhost:8000` (fixes empty `VITE_API_URL` → `Invalid URL` in Node helpers). **`PLAYWRIGHT_CHANNEL=chrome`** when cached `chromium_headless_shell` install fails (Cursor sandbox extraction hang). Rebuild playwright Docker image after test source changes. Summarizer-only verify: `PLAYWRIGHT_CHANNEL=chrome bun run test tests/summarizer.spec.ts` (34 tests, 2026-06-25).
- **pytest:** `cd backend && uv run pytest tests/ -q` (`app_test`).
- **2000+ channels** — avoid Sync All; prefer auto-sync / Sync Selected / bulk reset-sync.
- **Traefik / deploy** — see [deployment.md](deployment.md); staging needs self-hosted runner labels.

## Caveats

- **Never commit `.env`** or API keys.
- **Single scheduler instance** — no multi-replica without coordination.
- **AppSetting `jobs` row** overrides env job defaults once saved.
- **Auto-follow** can explode channel count; default off on existing channels.
- **`SettingsView.tsx`** still ~2000 lines (refactor deferred).
- **Deploy to Staging queued** — needs online self-hosted runner.
- **Playwright in Cursor agent sandbox** — browser zip extraction may hang; use Docker or system Chrome channel.

## Out of scope / roadmap

- Mode B multi-user tenancy, pgvector, Celery/Redis, hover translation server-side, sync job chunking.
- React context flattening (8 → 4 contexts); optional further `data.py` split.
- **SettingsView.tsx** component split (deferred).
- **Mobile responsive summarizer** (explicitly out of scope per UI polish Q1).
- **Ideas backlog:** IDEA-001/004/005/006/007 **implemented**; IDEA-007 manual keyboard matrix optional; [IDEA-002](docs/ideas-log/ideas/IDEA-002-tanstack-devtools.md) TanStack devtools (dev-only).
