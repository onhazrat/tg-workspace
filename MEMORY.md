# TG Summarizer — Project Memory

> Last synced: 2026-07-01

## Purpose

Self-hosted Telegram channel summarizer. Migrated from browser-heavy `TG-Summarizer/` (React + Express + IndexedDB) to a **FastAPI + React monorepo** with scraping, scheduling, AI, and PostgreSQL on the server. **Migration Phases 0–7 complete (2026-06-08).** **Mode A remediation** largely complete through 2026-06-09 — see [REMEDIATION-PLAN.md](docs/migration/REMEDIATION-PLAN.md). **Pre-feature codebase cleanup complete (2026-06-22).** **UI polish Phases A–G complete (2026-06-25)** — [ui polish audit plan](.cursor/plans/ui_polish_audit.plan.md). **Dynamic channel sync v1 complete (2026-07-01)** — [dynamic_channel_sync plan](.cursor/plans/dynamic_channel_sync_77e7db50.plan.md). Run commands: [README.md](README.md), [development.md](development.md).

## Architecture

- **`backend/`** — FastAPI (`app/main.py`), SQLModel (`app/models_tg.py`), Alembic, services (`scraper.py`, `sync_orchestrator.py`, **`sync_schedule.py`**, `proxy_pool.py`, `channels.py`, …), APScheduler jobs, pluggable AI (`app/ai/`, Gemini first).
- **`frontend/`** — React 19 + Vite + TanStack Router/Query; dual-route UI:
  - **`/_tg/summarizer`** — full-screen TG app (`App.tsx` + `TgProviders`); **command palette** on `main`; **keyboard shortcuts dialog** (`?` + header button). Main content uses **`app-shell`** width utility.
  - **`/_layout/*`** — template admin shell (`/`, `/items`, `/admin`, `/settings`); inner outlet also **`app-shell`**.
- **Command palette:** `CommandPalette*.tsx`, `CommandConfirmDialog.tsx`, `PaletteKeyboardChrome.tsx`; hooks `useCommandPalette`, `useCommandRegistry`, `useCommandSearchAffinity`, `useRecentCommands`, `useJobToggles`, `usePaletteListSelection`; registry in `frontend/src/lib/commands/` (**`settings-schema.ts`** — numeric two-step editors + badges); data transfer in `frontend/src/lib/data-transfer/`; channel ops in `frontend/src/lib/channels/` (`reset-sync.ts`, **`backfill-sync.ts`**, add/delete, tags).
- **Post view pipeline:** [`frontend/src/lib/posts/post-view.ts`](frontend/src/lib/posts/post-view.ts) — cap per channel, sort order, `buildFilteredPostsFromRaw`, `formatPostsForPrompt`. Consumed by `ScraperContext`, `AIContext`, `ChatContext`.
- **Modals (TG shell):** shadcn/Radix `Dialog` only — **`Modal.tsx` removed** (2026-06-25). Confirm flows in `ChannelGrid`, `HistoryView`, `PasteSummaryModal`, `DatabaseManagement`, `MigrationPrompt`.
- **API clients (ADR-006):** hand-written `frontend/src/api/` (summarizer); generated `frontend/src/client/` (admin/auth). Regenerate: `bash scripts/generate-client.sh` (default `ENVIRONMENT=production`; override `ENVIRONMENT=local` for Playwright/private routes).
- **Data layer (frontend):** `repository.ts` API-first → `cache.ts` (IndexedDB). **`db.ts` removed**.
- **Tunables:** `backend/app/core/config.py` + `frontend/src/lib/env.ts` (`VITE_*`); `.env.example`. Frontend-only clamps in `frontend/src/constants.ts` (e.g. regular sync interval min/max).
- **`TG-Summarizer/`** — Original reference; not deployed.
- **`docs/ideas-log/`** — Backlog (`IDEA-NNN`); index [IDEAS-LOG.md](docs/ideas-log/IDEAS-LOG.md).
- **uv workspace** + **bun** frontend. **Playwright E2E only** (~98 tests; palette K1–K18 + summarizer UI in `summarizer.spec.ts`).
- **CI/CD:** GitHub-hosted tests on push; self-hosted deploy via `deploy-staging.yml` / `deploy-production.yml` — [deployment.md](deployment.md). **Migrations on deploy:** `prestart` container runs `alembic upgrade head` before `backend` starts — no manual alembic on runner for normal CD.
- **Static shell meta (2026-06-30):** `frontend/index.html` — description, theme-color, favicons, `site.webmanifest`. **No `og:*` / Twitter tags yet** — full share-preview plan deferred ([open_graph_meta plan](.cursor/plans/open_graph_meta_a62edbee.plan.md)).

### Key API surfaces

- Versioned: `/api/v1/telegram/*`, `/network/*`, `/ai/*`, `/data/*`, `/rag/*`, `/jobs/*`
- **AI summary:** generate, stream, **`POST /api/v1/ai/summary/prompt`** (Copy Prompt; no LLM call)
- **Legacy `/api/*`:** `local` only; **410 Gone in production**
- **Channel sync:** `POST /api/v1/jobs/sync` → SSE `GET .../events` (orchestrator auto-detects initial / incremental / backfill)
- **Channels + stats:** `GET /api/v1/data/channels?includeStats=true` — batched SQL aggregates + velocity (`channels.py`); composite index `ix_tg_posts_channel_name_timestamp`
- **Bulk sync settings:** `PATCH /api/v1/data/channels/bulk-sync-settings` — apply `regularSyncEnabled`, `dynamicSyncEnabled`, `autoSyncIntervalMinutes`, `dynamicSyncExpectedPosts` to all or selected channels
- **Settings:** `GET /api/v1/data/settings/{key}` merges env defaults for `retention`, `sync`, `translation`, `jobs` when DB row missing/partial (`_SETTING_LOADERS` in `data.py`)
- **Runtime diagnostics:** `GET /api/v1/jobs/runtime-config`
- OpenAPI: `/docs`, `/api/v1/openapi.json`

## Data pipelines

- **Authoritative store:** PostgreSQL; IndexedDB read-through cache ([ADR-003](docs/migration/ADR-003-hybrid-sync.md)).
- **Scrape/sync:** `sync_orchestrator.py`; cutoff via `compute_scrape_cutoff_ms()` = `max(retentionCutoff, globalStartTime)`.
- **Retrieval passes** (per channel per sync job):
  - **`initial`** — no posts in DB; paginate backward from latest until cutoff, exhaustion, or iteration limit.
  - **`incremental`** — complete history; fetch latest page only; stop on first existing post.
  - **`backfill`** — posts exist and `history_complete_to_cutoff === false`; after incremental head fetch, resume backward from `min(stored post_id)` until cutoff or per-run limit. Skips existing posts without stopping (unlike incremental).
- **Coverage:** `Post.is_anchor`, `Channel.history_complete_to_cutoff`, gaps in `tg_post_sync_state`. **Partial history** = `historyCompleteToCutoff === false` (oldest stored post newer than cutoff).
- **Per-run cap:** `SCRAPER_ITERATION_LIMIT` (default **50** pages ≈ ~750–1000 posts). High-volume channels need **multiple sync runs**; iteration budget is shared across incremental + backfill in one job.
- **Per-channel auto-sync scheduling (v1, 2026-07-01):** Channel fields are **source of truth** — `regularSyncEnabled`, `dynamicSyncEnabled`, `autoSyncIntervalMinutes`, `dynamicSyncExpectedPosts`, `nextRegularSyncAt`, `nextDynamicSyncAt`. Global `sync` AppSetting keys (`regularSyncIntervalMinutes`, `dynamicSyncEnabledDefault`, `dynamicSyncExpectedPostsDefault`) **seed new channels only**; bulk/palette/Settings apply to existing via bulk API. **`sync.autoSyncEnabled` removed** — pause via `jobs.auto_sync` or palette **"Disable regular sync on all channels"**. Due when either enabled schedule is due (`sync_schedule.py`). **Regular:** `nextRegular = now + interval`. **Dynamic:** `nextDynamic = now + (expectedPosts / velocity)` — velocity is **float** internally; dynamic only when channel **has posts** and `velocity > 0`; default expected posts **15**; **no dynamic max cap** (use long regular interval as backup). Recomputed on **every** successful sync (including manual). **Scheduler failure backoff:** +5 min on due schedule(s) only, `job.source` = auto-sync. Manual sync always works. `auto_sync.py` still round-robins partial-history channels alongside due channels; **no per-tick cap**.
- **Destructive re-scrape:** Reset & Sync / `bulk-reset-sync` still clears posts — use only when data is corrupt or policy changes; **not** the default partial-history fix.
- **Auto-follow forwarded:** Per-channel `autoFollowForwarded` only (not global).
- **Embeddings/RAG:** Server Gemini; skip anchors; pgvector deferred ([ADR-005](docs/migration/ADR-005-vector-search.md)).
- **Jobs:** `auto_sync`, `embeddings`, `auto_summary`, `retention`, `translation_batch`.
- **Retention defaults:** post **90** days, log **30** days (`RETENTION_*_DEFAULT` / `VITE_RETENTION_*`); **`0` = never purge** (UI badge **Never**); any non-negative integer (no preset list).

## Analysis conventions

- **Channel identity:** `channel_id` / `name`; API camelCase.
- **Timestamps:** ms since epoch.
- **Channel stats:** `count`, `minId`, `maxId`, `velocity` (EMA on last 100 post timestamps per channel, **float** posts/hour). Velocity helper: `_velocity_from_timestamps` in `channels.py`; UI may round for display.
- **Default Channel Start Time / sync concurrency / proxy slots:** Settings → Scraping & Sync / Network; verify via `runtime-config`.
- **Auto-follow UI:** Toggle on each **ChannelCard** (rounded pill). Distinct from **Auto-Followed** badge (`discoveredVia`).
- **Per-channel sync UI (2026-07-01):** Inline on **ChannelCard** — regular/dynamic toggles, interval, expected posts, next deadline hints; manual sync tooltip: *"Manual sync resets auto-sync timers"*. Bulk actions in **ChannelGrid** + palette + Settings apply via bulk API.
- **Partial history UI:** Amber **Partial history** badge on `ChannelCard` when `historyCompleteToCutoff === false`; tooltip: "History does not reach retention window".
- **Summarizer UI:** URL tabs `/summarizer?tab=` — **6 workspace tabs** (channels, posts, summary, chat, history, **settings**); settings sub-sections `?tab=settings&section=`. **Post-login redirect:** `/summarizer`. Guided tour when no channels. Summary toolbar: Generate + Copy Prompt.
- **Posts tab — view filters (2026-06-30):** **Post limit & order** row in `PostFilter.tsx`. **Max per channel:** `0` = **Unlimited**; when &gt; 0, **Latest** or **Random** (seeded per channel). **Sort:** **By time** (default) or **By channel**. Persisted: `postFilter_*`. **`filteredPosts` order is canonical** for PostFeed, Copy Prompt, summary stream, standard chat. Plan: [post_view_filters](.cursor/plans/post_view_filters_42f18987.plan.md) (**complete**).
- **Command palette:** `Cmd+Shift+P` / `Ctrl+Shift+P` + header icon; settings + jobs + navigate + channel ops + data transfer + bulk sync commands. **Fix Partial History** — entity picker backfill queue. **Numeric settings** — two-step editor + badges. Detail: [IDEA-007](docs/ideas-log/ideas/IDEA-007-command-palette-keyboard-ux.md).
- **External AI summary flow:** Copy Prompt → pending history → **`PasteSummaryModal`**. Preferred for ad-hoc tasks (e.g. channel tagging).
- **Channel tags:** manual per-card + bulk; palette tag ops. **No in-app AI auto-tagging.**
- **Theme / layout:** `app-shell` width utility; `tg-wcag-floor` typography floor.
- **Numeric settings UI:** `<input type="number">`; palette mirrors clamps via `NUMERIC_EDITOR_DEFS`.
- **Channel grid:** `md:2 / lg:3 / xl:4`; infinite scroll via `useScrollLoadMore` on `workspace-scroll`.

## Decisions (stable)

Locked [DECISIONS.md](docs/migration/DECISIONS.md) + items through **dynamic channel sync v1 (2026-07-01)**:

1. **Single-operator (Mode A)** — Production: `API_KEY`, `TOKEN_ENCRYPTION_KEY`, strong `SECRET_KEY`, `USERS_OPEN_REGISTRATION=false`. Mode B deferred.
2. **Auth** — JWT + optional `X-API-Key`; fail-closed on sensitive routes in non-local.
3. **Data** — Postgres authoritative; IndexedDB cache; API-first writes.
4. **Jobs** — APScheduler in-process; single replica ([ADR-004](docs/migration/ADR-004-job-runner.md)).
5. **Backward scrape / per-channel auto-follow / proxy pool / external AI paste / command palette IDEA-001–007** — see [DECISIONS.md](docs/migration/DECISIONS.md).
6. **UI polish — desktop-only** — Summarizer workspace targets desktop; mobile **out of scope** (2026-06-25).
7. **Resume backfill for partial history (2026-06-28)** — Bounded pages per job + resume; palette backfill commands; Reset & Sync destructive only.
8. **Numeric settings UX (2026-06-28)** — Number inputs; retention `0` = **Never**; palette two-step editor.
9. **Channel stats batch SQL (2026-06-30)** — Two batched queries + composite index on `(channel_name, timestamp DESC)`.
10. **Post view filters (2026-06-30)** — Shared `post-view.ts` pipeline; `filteredPosts` canonical for UI + AI.
11. **Dynamic channel sync v1 (2026-07-01)** — Per-channel `regularSyncEnabled` + `dynamicSyncEnabled` with `nextRegularSyncAt` / `nextDynamicSyncAt`; channel fields source of truth; global settings seed **new channels only**; `regularSyncIntervalMinutes` replaces legacy `autoSyncInterval` in AppSetting (auto-migrated on load); **`sync.autoSyncEnabled` removed**; dynamic default **OFF**; dynamic-only channels allowed; no per-tick cap; full orchestrator (incremental + backfill same run). Plan: [dynamic_channel_sync](.cursor/plans/dynamic_channel_sync_77e7db50.plan.md) (**complete**).

### Explicitly rejected / deferred

- Mode B, Celery/Redis, pgvector, global auto-follow, `Cmd/Ctrl+K` palette shortcut, in-app AI channel auto-tagging.
- **Dynamic sync max cap** — rejected; use long regular interval as backup.
- **Global `sync.autoSyncEnabled` kill switch** — removed; use `jobs.auto_sync` + palette bulk disable.
- **Two-pass backfill priority** (incremental-only due pass vs separate low-priority backfill) — **v1.1**; see dynamic sync plan.
- **`sync_mode` orchestrator flag** — **v1.1**.
- **Open Graph / shareable summary links** — plan drafted; static meta only landed ([open_graph_meta](.cursor/plans/open_graph_meta_a62edbee.plan.md)).

## User preferences

- Self-hosted single operator; discuss trade-offs before big architectural bets.
- **Ask clarifying questions** for scheduling/product decisions — do not assume (dynamic sync design used multi-round AskQuestion).
- Per-user proxy URLs; tune proxy slots + `syncConcurrency` together; verify via `runtime-config`.
- Centralize tunables in `.env` / `.env.example`.
- **Only commit when explicitly asked**; plan files updated when user requests.
- **Frontend bug fixes** — verify with Playwright on reproduction path; add regression test when non-trivial.
- **Prefer simpler flows over new subsystems** — e.g. Copy Prompt + Posts filters over built-in AI wizards.

## Environment & fixes

- **Native dev:** `uv sync` → `alembic upgrade head` → uvicorn :8000; `bun run dev` :5173. **`POSTGRES_DB=app`** for API.
- **Deploy:** `docker compose up -d` runs `prestart` → `alembic upgrade head` automatically ([`compose.yml`](compose.yml), [`prestart.sh`](backend/scripts/prestart.sh)).
- **Pre-commit:** `uv run prek run --all-files`; `bun run lint` (Biome).
- **pytest (dynamic sync):** `tests/services/test_sync_schedule.py`, `test_sync_orchestrator.py`, `test_bulk_sync_settings.py`, `test_scheduler_jobs.py`, `test_settings_defaults.py`.
- **Frontend unit tests:** `settings-schema.test.ts` (10 tests after dynamic sync).
- **Alembic head (2026-07-01):** `h1i2j3k4l5m6` — dynamic channel sync columns on `tg_channels`.
- **2000+ channels** — avoid Sync All; use auto-sync / Sync Selected; bulk sync settings via PATCH bulk API.
- **Traefik / deploy** — see [deployment.md](deployment.md); staging needs self-hosted runner labels.

## Caveats

- **Never commit `.env`** or API keys.
- **Single scheduler instance** — no multi-replica without coordination.
- **Per-channel sync settings** — changing global template in Settings does **not** auto-update existing channels; use bulk apply.
- **Manual sync resets** `nextRegularSyncAt` / `nextDynamicSyncAt` — channel may look "up to date" but not be due for auto-sync until next deadline.
- **Dynamic sync** skipped when channel has no posts or `velocity <= 0`.
- **Partial history + high post volume** — one sync run may not clear badge; re-run backfill or wait for auto-sync.
- **`SettingsView.tsx`** still large (refactor deferred).
- **Playwright in Cursor sandbox** — use Docker or `PLAYWRIGHT_CHANNEL=chrome`.

## Out of scope / roadmap

- Mode B multi-user tenancy, pgvector, Celery/Redis, mobile responsive summarizer.
- **Dynamic sync v1.1** — two-pass backfill priority + `sync_mode` orchestrator flag.
- **Open Graph** — share-link API, crawler HTML, dynamic OG images ([open_graph_meta](.cursor/plans/open_graph_meta_a62edbee.plan.md)).
- **SettingsView.tsx** component split (deferred).
- **E2E tests for new ChannelCard sync controls** — optional follow-up.
