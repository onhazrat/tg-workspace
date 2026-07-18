# TG Summarizer — Project Memory

> Last synced: 2026-07-18

## Purpose

Self-hosted Telegram channel summarizer. Migrated from browser-heavy `TG-Summarizer/` (React + Express + IndexedDB) to a **FastAPI + React monorepo** with scraping, scheduling, AI, and PostgreSQL on the server. **Migration Phases 0–7 complete (2026-06-08).** Major features since: dynamic channel sync, Tag tab, post media, Discover tab (+ bulk follow), channel setting groups + UX v2, telegram chat ID, frontend god-component refactor (PR #6), sync permission flags v2, **TG UI primitives (`148a56c`) + adjacent polish (`b27e5c8`) on main (2026-07-18)** — [tg_ui_primitives](.cursor/plans/tg_ui_primitives_a165813d.plan.md), [tg_ui_polish](.cursor/plans/tg_ui_polish_11c8be27.plan.md). **VS Code–style Settings Hub** (catalog + flatten search + hierarchical TOC; Advanced Mode removed). Catalog: [`frontend/docs/tg-ui.md`](frontend/docs/tg-ui.md), [`frontend/docs/settings-catalog.md`](frontend/docs/settings-catalog.md). Run: [README.md](README.md), [development.md](development.md).

## Architecture

- **`backend/`** — FastAPI (`app/main.py`), SQLModel (`app/models_tg.py`), Alembic, services (`scraper.py`, `sync_orchestrator.py`, **`sync_schedule.py`**, `channels.py`, **`followed_channels.py`**, **`bulk_follow.py`**, **`channel_setting_groups.py`**, **`channel_tags.py`**, **`tag_runs.py`**, **`post_media_parser.py`**, **`post_thumbnails.py`**, **`telegram_html.py`**, …), APScheduler jobs, pluggable AI (`app/ai/`, Gemini first). Prompts in `backend/app/prompts/`.
- **`frontend/`** — React 19 + Vite + TanStack Router/Query; dual-route UI:
  - **`/_tg/summarizer`** — full-screen TG app (`App.tsx` + `TgProviders`); **command palette** on `main`. Main content uses **`app-shell`** width utility.
  - **`/_layout/*`** — template admin shell (`/`, `/items`, `/admin`, `/settings`).
- **Providers (TG shell):** `Settings → Data → UI → Scraper → Chat → AI → Tag` in [`TgProviders.tsx`](frontend/src/components/TgProviders.tsx).
- **TG UI primitives:** TG-token components under [`frontend/src/components/ui/tg-*.tsx`](frontend/src/components/ui/) — **not** shadcn admin `Button`/`Input`/`LoadingButton`. Full catalog + loading/`tg-ui-allow` policy: [`frontend/docs/tg-ui.md`](frontend/docs/tg-ui.md).
- **Settings state:** zod schema — [`lib/settings/schema.ts`](frontend/src/lib/settings/schema.ts). **New settings go in the schema, not new `useState`.**
- **Settings hub (VS Code–style):** catalog [`lib/settings/catalog.ts`](frontend/src/lib/settings/catalog.ts) feeds UI + flatten search + palette. TOC [`lib/settings/toc.ts`](frontend/src/lib/settings/toc.ts). Search seam [`lib/settings/search.ts`](frontend/src/lib/settings/search.ts) (local string ranking; embeddings later). Docs: [`frontend/docs/settings-catalog.md`](frontend/docs/settings-catalog.md).
- **Server state:** TanStack Query via `DataContext` + [`queryKeys.ts`](frontend/src/hooks/queryKeys.ts).
- **Command palette:** `frontend/src/lib/commands/` — settings commands generated from catalog.
- **uv** + **bun**. Unit: `bun run test:unit`. Left-behind gate: **`bun run test:tg-ui`**. Playwright: [`tg-ui-primitives.spec.ts`](frontend/tests/tg-ui-primitives.spec.ts).

### Key API surfaces

- Versioned: `/api/v1/telegram/*`, `/network/*`, `/ai/*`, `/data/*`, `/rag/*`, `/jobs/*`
- **Channel sync:** `POST /jobs/sync` + optional `channelIds` + **`syncMode`** → SSE.
- OpenAPI: `/docs`, `/api/v1/openapi.json`

## Data pipelines

- **Authoritative store:** PostgreSQL; IndexedDB read-through ([ADR-003](docs/migration/ADR-003-hybrid-sync.md)).
- **Auto-sync:** `regularSyncEnabled` / `dynamicSyncEnabled` — **not** gated by sync permission flags.
- **Setting groups:** default, Slow feed, High velocity, Frozen, Restricted (+ custom); strict inheritance.
- **Jobs:** `auto_sync`, `embeddings`, `auto_summary`, `retention`, `translation_batch`.

## Analysis conventions

- **Summarizer UI:** 8 tabs — channels, posts, summary, tag, discover, chat, history, settings.
- **Command palette:** `Cmd+Shift+P`; `channelGroup` URL param.
- **Settings URLs:** `?tab=settings&section=<tocId>`; deep-link `?setting=<catalogId>`; `settingGroup` for groups panel. Aliases: `sync`→`channels-sync`, `db`→`data`.

## Decisions (stable)

1. **Single-operator (Mode A)** — [DECISIONS.md](docs/migration/DECISIONS.md).
2. **Data** — Postgres authoritative; IndexedDB cache; API-first writes.
3. **Channel setting groups v1** — strict inheritance; no per-channel overrides for inherited fields.
4. **Channel telegram chat ID v1** — username primary; server-managed ID; mismatch → Frozen.
5. **Frontend refactor (PR #6)** — god-component split; schema-driven settings; TanStack Query.
6. **Sync permission flags v2** — four inherited booleans; no `forceSync`; migration `p8q9r0s1t2u3`.
7. **TG UI primitives + polish (2026-07-18)** — TG-native; do **not** force TG onto admin/shadcn. Confirms = `TgConfirmDialog`. See [`frontend/docs/tg-ui.md`](frontend/docs/tg-ui.md).
8. **Settings Hub catalog (2026-07-18)** — catalog owns presentation/search/command generation; persistence stays split (app/network/theme/jobs). Flatten search when query non-empty. Setting Groups = TOC leaf under Channels & Sync. Static Commonly Used v1. **Advanced Mode removed** (ignore leftover localStorage). Operators: `@modified`, `@feature:`, `@id:`. Local string search via provider seam (embeddings later). Preserve palette command ids (minus Advanced Mode triples).

### Explicitly rejected / deferred

- **forceSync**; tying auto-sync to permission flags — rejected.
- Forcing TG onto shadcn Button/Input/Card; ChannelCard body / PostFeed / palette chrome extractions — rejected.
- Deferred raw UX: LogFilterBar density filters, Chat mode toggles, ChannelCard checkbox / dashed Add Tag.
- User/Workspace scopes; affinity-ranked Commonly Used; AI/embeddings settings search (planned later behind provider seam).

## User preferences

- Self-hosted single operator; discuss trade-offs before big architectural bets.
- **Only commit when explicitly asked**; verify locally before push to main.
- **Frontend** — Playwright for non-trivial UI; unit tests for pure logic.
- **Signed commits** — 1Password SSH signing.

## Environment & fixes

- **Native dev:** `uv sync` → `alembic upgrade head` → uvicorn :8000; `bun run dev` :5173. **`POSTGRES_DB=app`**.
- **Alembic head:** `p8q9r0s1t2u3`.
- **Local checks:** `bun run test:unit`, **`bun run test:tg-ui`**, `tsc`, `cd backend && uv run pytest tests/`.
- **UI footguns:** `tg-tooltip` `asChild` must preserve child `data-slot`; missing `queryFn`s in lazy tab prefetch → false 401.

## Caveats

- **Never commit `.env`** or API keys.
- **TG UI** — do not reintroduce orphan class recipes; prefer extending primitives over `tg-ui-allow`.
- **Settings command parity** — treat `LEGACY_SETTING_COMMAND_IDS` as a gate when editing the catalog.

## Out of scope / roadmap

- Auto-scheduled Restricted recheck; Telegram chat ID v1.1; auto-tagging scheduler; mobile summarizer.
- Admin `/_layout` migration onto TG primitives.
- Semantic / embeddings / TF-IDF settings search (provider seam already exists).

## Session log

- **2026-07-18** — Primitives `148a56c` + polish `b27e5c8` on `main`. Staging smoke via deploy pipeline.
- **2026-07-18** — Settings Hub catalog/TOC/search + Advanced Mode removal; Network/Publishing/Data panel splits. Docs: `frontend/docs/settings-catalog.md`.
