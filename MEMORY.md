# TG Summarizer — Project Memory

> Last synced: 2026-07-18

## Purpose

Self-hosted Telegram channel summarizer. Migrated from browser-heavy `TG-Summarizer/` (React + Express + IndexedDB) to a **FastAPI + React monorepo** with scraping, scheduling, AI, and PostgreSQL on the server. **Migration Phases 0–7 complete (2026-06-08).** Major features since: dynamic channel sync, Tag tab, post media, Discover tab (+ bulk follow), channel setting groups + UX v2, telegram chat ID, frontend god-component refactor (PR #6), sync permission flags v2, **TG UI primitives (`148a56c`) + polish (`b27e5c8`)**, **VS Code–style Settings Hub (`56f16d4`)** + TOC twisties / Tools split (`2b2ceaf`) — plans: [tg_ui_primitives](.cursor/plans/tg_ui_primitives_a165813d.plan.md), [tg_ui_polish](.cursor/plans/tg_ui_polish_11c8be27.plan.md), [vs_code_settings_hub](.cursor/plans/vs_code_settings_hub_1f298968.plan.md). Docs: [`frontend/docs/tg-ui.md`](frontend/docs/tg-ui.md), [`frontend/docs/settings-catalog.md`](frontend/docs/settings-catalog.md). Run: [README.md](README.md), [development.md](development.md).

## Architecture

- **`backend/`** — FastAPI (`app/main.py`), SQLModel (`app/models_tg.py`), Alembic, services (`scraper.py`, `sync_orchestrator.py`, **`sync_schedule.py`**, `channels.py`, **`followed_channels.py`**, **`bulk_follow.py`**, **`channel_setting_groups.py`**, **`channel_tags.py`**, **`tag_runs.py`**, **`post_media_parser.py`**, **`post_thumbnails.py`**, **`telegram_html.py`**, …), APScheduler jobs, pluggable AI (`app/ai/`, Gemini first). Prompts in `backend/app/prompts/`.
- **`frontend/`** — React 19 + Vite + TanStack Router/Query; dual-route UI:
  - **`/_tg/summarizer`** — full-screen TG app (`App.tsx` + `TgProviders`); **command palette** on `main`. Main content uses **`app-shell`** width utility.
  - **`/_layout/*`** — template admin shell (`/`, `/admin`, `/settings`).
- **Providers (TG shell):** `Settings → Data → UI → Scraper → Chat → AI → Tag` in [`TgProviders.tsx`](frontend/src/components/TgProviders.tsx).
- **TG UI primitives:** `tg-*` under [`frontend/src/components/ui/`](frontend/src/components/ui/) — **not** shadcn admin controls. Policy: [`frontend/docs/tg-ui.md`](frontend/docs/tg-ui.md).
- **Settings persistence:** zod [`lib/settings/schema.ts`](frontend/src/lib/settings/schema.ts) (+ network/theme/jobs stores). **New values go in schema/store, not ad-hoc `useState`.**
- **Settings Hub (VS Code–style):** catalog [`lib/settings/catalog.ts`](frontend/src/lib/settings/catalog.ts) feeds UI rows + flatten search + palette. TOC [`lib/settings/toc.ts`](frontend/src/lib/settings/toc.ts) + twisties in [`SettingsTocNav.tsx`](frontend/src/components/settings/SettingsTocNav.tsx). Search seam [`lib/settings/search.ts`](frontend/src/lib/settings/search.ts) (local ranking; embeddings later). Deep-link anchors: [`SettingRow`](frontend/src/components/settings/SettingRow.tsx) / [`SettingAnchor`](frontend/src/components/settings/SettingAnchor.tsx). Docs: [`frontend/docs/settings-catalog.md`](frontend/docs/settings-catalog.md).
- **Panel splits:** Network → Proxy/Tor; Publishing → credentials/destinations/quick-message; Data → retention/table-sizes/transfer/query/danger; Tools → **diagnostics** (logs) vs **network-telemetry** vs runtime-config (separately searchable).
- **Server state:** TanStack Query via `DataContext` + [`queryKeys.ts`](frontend/src/hooks/queryKeys.ts).
- **Command palette:** `frontend/src/lib/commands/` — settings commands **generated from catalog** (`LEGACY_SETTING_COMMAND_IDS` gate).
- **uv** + **bun**. Unit: `bun run test:unit` (~396). Left-behind: **`bun run test:tg-ui`**. Playwright: `settings-hub.spec.ts`, `tg-ui-primitives.spec.ts`, `summarizer.spec.ts`.

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
- **Settings URLs:** `?tab=settings&section=<tocId>`; deep-link `?setting=<catalogId>`; `settingGroup` for groups panel.
- **TOC aliases:** `sync`→`channels-sync`, `db`→`data`, `telemetry`→`network-telemetry`. Default section: `commonly-used`.
- **TOC twisties:** chevron expands/collapses children without changing selection; row label navigates. Expand state: `localStorage` key `settings-toc-expanded`.
- **Sync permission matrix** — Sync All / bulk / individual / reset flags inherited from setting groups (see prior docs; unchanged).

## Decisions (stable)

1. **Single-operator (Mode A)** — [DECISIONS.md](docs/migration/DECISIONS.md).
2. **Data** — Postgres authoritative; IndexedDB cache; API-first writes.
3. **Channel setting groups v1** — strict inheritance; no per-channel overrides for inherited fields.
4. **Channel telegram chat ID v1** — username primary; server-managed ID; mismatch → Frozen.
5. **Frontend refactor (PR #6)** — god-component split; schema-driven settings; TanStack Query.
6. **Sync permission flags v2** — four inherited booleans; no `forceSync`; migration `p8q9r0s1t2u3`.
7. **TG UI primitives + polish (2026-07-18)** — TG-native; do **not** force TG onto admin/shadcn. Confirms = `TgConfirmDialog`.
8. **Settings Hub catalog (2026-07-18)** — catalog owns presentation/search/command generation; persistence stays split. Flatten search when query non-empty. Setting Groups = TOC leaf under Channels & Sync. Static Commonly Used v1. **Advanced Mode removed** (ignore leftover localStorage). Operators: `@modified`, `@feature:`, `@id:`. Local string search via provider seam. Preserve palette command ids (minus Advanced Mode). Full Network/Publishing/Data panel splits in same effort.
9. **Settings TOC UX (2026-07-18)** — VS Code–style twisties; Diagnostics vs Network Telemetry are separate Tools leaves / panel catalog entries (search “LLM logs” vs “network telemetry”).

### Explicitly rejected / deferred

- **forceSync**; tying auto-sync to permission flags — rejected.
- Forcing TG onto shadcn Button/Input/Card; ChannelCard body / PostFeed / palette chrome extractions — rejected.
- Deferred raw UX: LogFilterBar density filters, Chat mode toggles, ChannelCard checkbox / dashed Add Tag.
- User/Workspace scopes; affinity-ranked Commonly Used.
- **AI/embeddings/TF-IDF settings search** — deferred (intentional); keep `SettingsSearchProvider` seam; catalog text is future corpus.
- Deep-link highlight for knobs behind collapsed parents (off proxy/tor/etc.) — navigate to section only until parent enabled.

## User preferences

- Self-hosted single operator; discuss trade-offs before big architectural bets.
- **Ask clarifying questions** for scheduling/product decisions.
- **Only commit when explicitly asked**; verify locally before push to main.
- **Frontend** — Playwright for non-trivial UI; unit tests for pure logic; colocated `*.test.tsx`.
- **Signed commits** — 1Password SSH signing.

## Environment & fixes

- **Native dev:** `uv sync` → `alembic upgrade head` → uvicorn :8000; `bun run dev` :5173. **`POSTGRES_DB=app`**.
- **Alembic head:** `p8q9r0s1t2u3`.
- **Local checks:** `bun run test:unit`, **`bun run test:tg-ui`**, `tsc`, `cd backend && uv run pytest tests/`.
- **Playwright CI:** [`.github/workflows/playwright.yml`](.github/workflows/playwright.yml) — **2 shards**, job **timeout 30m** (`09f2653`); merge skips when no blob reports. Prefer `PLAYWRIGHT_CHANNEL=chrome` locally if bundled Chromium fails.
- **Flaky backend timing:** dynamic-sync `nextDynamicSyncAt` asserts allow **≤5s** wall-clock drift (`test_bulk_sync_settings` / `test_data`) — velocity uses `datetime.utcnow()` (`f2aed85`).
- **UI footguns:** `tg-tooltip` `asChild` must preserve child `data-slot`; missing `queryFn`s in lazy tab prefetch → false 401.

## Caveats

- **Never commit `.env`** or API keys.
- **TG UI** — do not reintroduce orphan class recipes; prefer extending primitives over `tg-ui-allow`.
- **Settings command parity** — treat `LEGACY_SETTING_COMMAND_IDS` as a gate when editing the catalog.
- Setting group edits propagate to all members; virtual `group:` tags are display-only.

## Out of scope / roadmap

- Auto-scheduled Restricted recheck; Telegram chat ID v1.1; auto-tagging scheduler; mobile summarizer.
- Admin `/_layout` migration onto TG primitives.
- Semantic / embeddings settings search (seam ready).
- Affinity-ranked Commonly Used.

## Session log

- **2026-07-18** — Settings Hub on `main` (`56f16d4`); CI Playwright shard/timeout (`09f2653`); TOC twisties + diagnostics/telemetry split (`2b2ceaf`); dynamic-sync test drift 5s (`f2aed85`).
