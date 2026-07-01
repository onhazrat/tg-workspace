# TG Summarizer — Project Memory

> Last synced: 2026-06-30

## Purpose

Self-hosted Telegram channel summarizer. Migrated from browser-heavy `TG-Summarizer/` (React + Express + IndexedDB) to a **FastAPI + React monorepo** with scraping, scheduling, AI, and PostgreSQL on the server. **Migration Phases 0–7 complete (2026-06-08).** **Mode A remediation** largely complete through 2026-06-09 — see [REMEDIATION-PLAN.md](docs/migration/REMEDIATION-PLAN.md). **Pre-feature codebase cleanup complete (2026-06-22).** **UI polish Phases A–G complete (2026-06-25)** — [ui polish audit plan](.cursor/plans/ui_polish_audit.plan.md). Run commands: [README.md](README.md), [development.md](development.md).

## Architecture

- **`backend/`** — FastAPI (`app/main.py`), SQLModel (`app/models_tg.py`), Alembic, services (`scraper.py`, `sync_orchestrator.py`, `proxy_pool.py`, `channels.py`, …), APScheduler jobs, pluggable AI (`app/ai/`, Gemini first).
- **`frontend/`** — React 19 + Vite + TanStack Router/Query; dual-route UI:
  - **`/_tg/summarizer`** — full-screen TG app (`App.tsx` + `TgProviders`); **command palette** on `main`; **keyboard shortcuts dialog** (`?` + header button). Main content uses **`app-shell`** width utility.
  - **`/_layout/*`** — template admin shell (`/`, `/items`, `/admin`, `/settings`); inner outlet also **`app-shell`**.
- **Command palette:** `CommandPalette*.tsx`, `CommandConfirmDialog.tsx`, `PaletteKeyboardChrome.tsx`; hooks `useCommandPalette`, `useCommandRegistry`, `useCommandSearchAffinity`, `useRecentCommands`, `useJobToggles`, `usePaletteListSelection`; registry in `frontend/src/lib/commands/` (**`settings-schema.ts`** — numeric two-step editors + badges); data transfer in `frontend/src/lib/data-transfer/`; channel ops in `frontend/src/lib/channels/` (`reset-sync.ts`, **`backfill-sync.ts`**, add/delete, tags).
- **Post view pipeline:** [`frontend/src/lib/posts/post-view.ts`](frontend/src/lib/posts/post-view.ts) — cap per channel, sort order, `buildFilteredPostsFromRaw`, `formatPostsForPrompt`. Consumed by `ScraperContext`, `AIContext`, `ChatContext`.
- **Modals (TG shell):** shadcn/Radix `Dialog` only — **`Modal.tsx` removed** (2026-06-25). Confirm flows in `ChannelGrid`, `HistoryView`, `PasteSummaryModal`, `DatabaseManagement`, `MigrationPrompt`.
- **API clients (ADR-006):** hand-written `frontend/src/api/` (summarizer); generated `frontend/src/client/` (admin/auth). Regenerate: `bash scripts/generate-client.sh` (default `ENVIRONMENT=production`; override `ENVIRONMENT=local` for Playwright/private routes).
- **Data layer (frontend):** `repository.ts` API-first → `cache.ts` (IndexedDB). **`db.ts` removed**.
- **Tunables:** `backend/app/core/config.py` + `frontend/src/lib/env.ts` (`VITE_*`); `.env.example`. Frontend-only clamps in `frontend/src/constants.ts` (e.g. auto-sync interval min/max).
- **`TG-Summarizer/`** — Original reference; not deployed.
- **`docs/ideas-log/`** — Backlog (`IDEA-NNN`); index [IDEAS-LOG.md](docs/ideas-log/IDEAS-LOG.md).
- **uv workspace** + **bun** frontend. **Playwright E2E only** (~98 tests; palette K1–K18 + summarizer UI in `summarizer.spec.ts`).
- **CI/CD:** GitHub-hosted tests on push; self-hosted deploy via `deploy-staging.yml` / `deploy-production.yml` — [deployment.md](deployment.md).
- **Static shell meta (2026-06-30):** `frontend/index.html` — description, theme-color, favicons, `site.webmanifest`. **No `og:*` / Twitter tags yet** — full share-preview plan deferred ([open_graph_meta plan](.cursor/plans/open_graph_meta_a62edbee.plan.md)).

### Key API surfaces

- Versioned: `/api/v1/telegram/*`, `/network/*`, `/ai/*`, `/data/*`, `/rag/*`, `/jobs/*`
- **AI summary:** generate, stream, **`POST /api/v1/ai/summary/prompt`** (Copy Prompt; no LLM call)
- **Legacy `/api/*`:** `local` only; **410 Gone in production**
- **Channel sync:** `POST /api/v1/jobs/sync` → SSE `GET .../events` (orchestrator auto-detects initial / incremental / backfill)
- **Channels + stats:** `GET /api/v1/data/channels?includeStats=true` — batched SQL aggregates + velocity (`channels.py`); composite index `ix_tg_posts_channel_name_timestamp`
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
- **Auto-sync partial pickup:** `auto_sync.py` queues stale channels **plus** fresh partial channels (round-robin via `autoSyncPartialCursor` / `autoSyncPartialBatchSize` in sync AppSetting; default batch 1). Staleness threshold = `autoSyncInterval` minutes (backend accepts any int; frontend clamps **5–1440**).
- **Destructive re-scrape:** Reset & Sync / `bulk-reset-sync` still clears posts — use only when data is corrupt or policy changes; **not** the default partial-history fix.
- **Auto-follow forwarded:** Per-channel `autoFollowForwarded` only (not global).
- **Embeddings/RAG:** Server Gemini; skip anchors; pgvector deferred ([ADR-005](docs/migration/ADR-005-vector-search.md)).
- **Jobs:** `auto_sync`, `embeddings`, `auto_summary`, `retention`, `translation_batch`.
- **Retention defaults:** post **90** days, log **30** days (`RETENTION_*_DEFAULT` / `VITE_RETENTION_*`); **`0` = never purge** (UI badge **Never**); any non-negative integer (no preset list).

## Analysis conventions

- **Channel identity:** `channel_id` / `name`; API camelCase.
- **Timestamps:** ms since epoch.
- **Channel stats:** `count`, `minId`, `maxId`, `velocity` (EMA on last 100 post timestamps per channel). Velocity helper: `_velocity_from_timestamps` in `channels.py`.
- **Default Channel Start Time / sync concurrency / proxy slots:** Settings → Scraping & Sync / Network; verify via `runtime-config`.
- **Auto-follow UI:** Toggle on each **ChannelCard** (rounded pill). Distinct from **Auto-Followed** badge (`discoveredVia`).
- **Partial history UI:** Amber **Partial history** badge on `ChannelCard` when `historyCompleteToCutoff === false`; tooltip: "History does not reach retention window".
- **Summarizer UI:** URL tabs `/summarizer?tab=` — **6 workspace tabs** (channels, posts, summary, chat, history, **settings**); settings sub-sections `?tab=settings&section=`. **Post-login redirect:** `/summarizer`. Guided tour when no channels. Summary toolbar: Generate + Copy Prompt.
- **Posts tab — view filters (2026-06-30):** **Post limit & order** row in `PostFilter.tsx`. **Max per channel:** `0` = **Unlimited** (label in UI); when &gt; 0, **Latest** (newest N per channel) or **Random** (seeded shuffle per channel). **Sort:** **By time** (global newest first, default) or **By channel** (groups A→Z by `channelName`, newest first within group). Persisted: `postFilter_maxPerChannel`, `postFilter_maxPerChannelMode`, `postFilter_sortOrder`. **`filteredPosts` order is canonical** for PostFeed, Copy Prompt, in-app summary stream, and standard chat — pipeline: keyword → forwarded → cap → sort. Clear via palette **Clear post filters** (resets view options to defaults). Plan: [post_view_filters](.cursor/plans/post_view_filters_42f18987.plan.md) (**complete**).
- **Command palette:** `Cmd+Shift+P` / `Ctrl+Shift+P` + header icon; settings + jobs + navigate + channel ops + data transfer + in-palette search. Keyboard UX (IDEA-007): `usePaletteListSelection`, K1–K18 E2E. **Fix Partial History (Channel)** — entity picker, `closeOnPick: false`, non-destructive backfill queue. **Fix All Partial History** — bulk backfill via `POST /api/v1/jobs/sync`. **Numeric settings** — two-step editor (pick setting → number input) with live **current-value badges**; retention `0` shows **Never**. Detail: [IDEA-007](docs/ideas-log/ideas/IDEA-007-command-palette-keyboard-ux.md), [numeric settings plan](.cursor/plans/numeric_settings_ux.plan.md).
- **Keyboard shortcuts reference:** `?` (non-editable contexts) + header keyboard button → dialog listing shortcuts.
- **External AI summary flow:** Copy Prompt → pending history entry; complete via **`PasteSummaryModal`** on that item. Completed: `source: "pasted"`. Pending view has explicit paste instructions. **Preferred pattern for ad-hoc AI tasks** (e.g. channel tagging): shape data in Posts tab → Copy Prompt → edit/run externally — not necessarily a new in-app AI subsystem.
- **Channel tags:** manual per-card + bulk add/remove on selection; palette add/remove/select-by-tag. **No in-app AI auto-tagging yet.** For auto-follow cleanup: `discoveredVia` provenance, bulk tag, `cleanup_auto_follow_channels.py`.
- **Theme:** `theme-provider` (`vite-ui-theme`); TG app root uses `app-*` tokens + `tg-wcag-floor` class for metadata typography floor. **Layout width:** `@utility app-shell` in `index.css` — `--max-width-app` 80rem (1280px), scales to 90rem at `xl`, 100rem at `2xl`; tune via `@theme` tokens only.
- **Numeric settings UI:** `<input type="number">` in Settings / DatabaseManagement / ChannelGrid (sliders and fixed retention day selects removed). Palette mirrors same clamps via `NUMERIC_EDITOR_DEFS` in `settings-schema.ts`.
- **Initial load UX:** skeleton placeholders in `ChannelGrid` / `PostFeed` (`isInitialChannelsLoading`, `isInitialPostLoadPending`). **Summarizer scroll shell:** `App.tsx` uses `h-svh overflow-hidden` + `min-h-0` flex chain so `data-testid="workspace-scroll"` is the real scroll container (not window scroll). **Infinite scroll:** `useScrollLoadMore` hook (`frontend/src/hooks/useScrollLoadMore.ts`) — callback-ref sentinel + `IntersectionObserver` with `root: scrollContainerRef`; used by `ChannelGrid` (20 cards/page).
- **PostCard:** long posts collapse with Show More / Collapse; action bar visible on hover **and** `focus-within`.
- **Channel grid:** `md:2 / lg:3 / xl:4` columns; shadcn `Select` for filters/sort; filtered count “Showing X of Y”; bulk freeze/unfreeze always confirms (matches palette); **Revert selection** action.
- **Appearance toggles:** incl. `showChannelStartId` (default **false**) — gates Start ID field on ChannelCard.
- **Telegram publish:** SummaryView warns when content exceeds **4096** chars.

## Decisions (stable)

Locked [DECISIONS.md](docs/migration/DECISIONS.md) + items through command palette (IDEA-001–007) + **UI polish audit (2026-06-25)** + **resume backfill (2026-06-28)** + **numeric settings UX (2026-06-28)** + **channel stats perf (2026-06-30)** + **post view filters (2026-06-30)**:

1. **Single-operator (Mode A)** — Production: `API_KEY`, `TOKEN_ENCRYPTION_KEY`, strong `SECRET_KEY`, `USERS_OPEN_REGISTRATION=false`. Mode B deferred.
2. **Auth** — JWT + optional `X-API-Key`; fail-closed on sensitive routes in non-local.
3. **Data** — Postgres authoritative; IndexedDB cache; API-first writes.
4. **Jobs** — APScheduler in-process; single replica ([ADR-004](docs/migration/ADR-004-job-runner.md)).
5. **Backward scrape / per-channel auto-follow / Cloudflare DNS TLS / proxy pool (IDEA-003) / external AI paste flow / template tooling / command palette IDEA-001–007** — see [DECISIONS.md](docs/migration/DECISIONS.md) and idea detail files.
6. **UI polish — desktop-only** — Summarizer workspace targets desktop; mobile tab overflow / responsive stats **out of scope** (Q1, 2026-06-25).
7. **UI polish — WCAG 2.1 AA** — Card actions via `focus-within`; typography floor (`tg-wcag-floor` + component fixes); skip-nav; shadcn `Dialog` for all TG modals (`Modal.tsx` removed).
8. **UI polish — Settings tab** — Settings is a **labeled workspace tab** (gear icon removed).
9. **UI polish — channel grid** — `md:2 / lg:3 / xl:4`; shadcn `Select`; filtered count; bulk freeze/unfreeze always confirms.
10. **UI polish — deferred** — `SettingsView.tsx` per-section split; mobile responsive polish.
11. **Resume backfill for partial history (2026-06-28)** — Bounded pages per job + resume across runs. Orchestrator `backfill` pass from oldest stored post; auto-sync round-robins partial channels. Palette **Fix Partial History** commands queue backfill (no post wipe). Reset & Sync remains separate destructive path.
12. **Numeric settings UX (2026-06-28)** — Number inputs (not sliders/fixed day lists) for retention, auto-sync interval, Tor threshold, AI temperature, etc. Retention: any non-negative integer; `0` = never purge (**Never** badge). Defaults post **90** / log **30** days via env. `GET /settings/{key}` merges defaults for structured keys. Palette: two-step numeric editor + current-value badges. Tests: `settings-schema.test.ts` (8), `test_settings_defaults.py` (4).
13. **App shell layout width (2026-06-28)** — Single `app-shell` utility + `@theme` max-width tokens in `index.css`. Responsive: 80rem → 90rem (`xl`) → 100rem (`2xl`).
14. **Auto-sync interval UI bounds (2026-06-30)** — Frontend clamps **5–1440 minutes** (1 day) via `AUTO_SYNC_INTERVAL_MIN_MINUTES` / `AUTO_SYNC_INTERVAL_MAX_MINUTES` in `constants.ts`; shared by SettingsView, ChannelGrid, palette editor. **Backend has no max** — accepts any integer via API.
15. **Channel stats batch SQL (2026-06-30)** — `compute_channel_stats_batch` uses two batched queries (aggregates + top-100 timestamps per channel), not per-channel full post scans. Composite index on `(channel_name, timestamp DESC)`. Plan: [fix_channel_stats_perf](.cursor/plans/fix_channel_stats_perf_5abf4a1d.plan.md). Tests: `tests/services/test_channel_stats.py`.
16. **Summarizer viewport scroll (2026-06-30)** — TG shell height-constrained (`h-svh` + `min-h-0` on flex children); workspace tab content scrolls inside `workspace-scroll`. IntersectionObserver infinite-scroll must use that element as `root`, not the viewport. Reusable hook: `useScrollLoadMore`.
17. **Post view filters (2026-06-30)** — Shared pure pipeline in `post-view.ts`; `ScraperContext.filteredPosts` is the single ordered list for UI + AI prompts (no client re-sort in AIContext/ChatContext). Defaults unchanged: unlimited, latest mode inactive, global time desc. Random mode uses seeded shuffle per channel (stable for same date range + limit). Pre-sync refetch uses `buildFilteredPostsFromRaw` so forwarded filter + view options apply. Tests: `post-view.test.ts` (7). Plan complete: [post_view_filters](.cursor/plans/post_view_filters_42f18987.plan.md).

### Explicitly rejected / deferred

- Mode B, Celery/Redis, pgvector, deleting `TG-Summarizer/`, global auto-follow, TLS-01, producer-consumer queue, global paste toolbar, `Cmd/Ctrl+K` palette shortcut, admin-shell palette, rename channel in palette.
- **Mobile-first summarizer UI** — desktop-only by user choice (2026-06-25).
- **SettingsView.tsx refactor** — defer until next heavy settings work.
- **Unlimited backfill in one sync job** — rejected; use per-run `SCRAPER_ITERATION_LIMIT` + multi-pass resume.
- **Reset & Sync as default partial-history fix** — rejected; replaced by non-destructive backfill queue.
- **Flat `max-w-screen-2xl` / Tailwind `container` for shell** — rejected in favor of custom `@theme` tokens + `app-shell`.
- **Sliders / fixed retention day select lists** — replaced by number inputs (2026-06-28).
- **120-minute auto-sync cap** — bumped to **1440 minutes (1 day)** on frontend only (2026-06-30); backend unchanged.
- **In-app AI channel auto-tagging** — rejected for now (2026-06-30). User prefers **Posts tab filters + Copy Prompt + external AI** for bulk channel tagging; hybrid vocabulary / review-queue UX deferred. Quick organization without AI: `discoveredVia` filters, bulk tag, provenance tags.
- **Integrated tagging platform** (vocabulary CMS, review queue, background suggest jobs) — rejected in favor of simpler external-AI workflow above.

## User preferences

- Self-hosted single operator; discuss trade-offs before big architectural bets.
- Per-user proxy URLs; tune proxy slots + `syncConcurrency` together; verify via `runtime-config`.
- Centralize tunables in `.env` / `.env.example`.
- **Only commit when explicitly asked**; plan files may be checkbox-updated when user requests.
- **Frontend bug fixes** — verify with Playwright on the exact user reproduction path; add regression test when behavior is non-trivial; don't assume fixed until test + build pass.
- **Ideas log** — deferred work in `docs/ideas-log/`; start sessions with *"Work on IDEA-NNN."*
- **Command palette / UI polish:** use AskQuestion for product decisions; no assumptions on shortcuts, phasing, or mobile scope.
- **Numeric settings:** integers in UI for int settings; floats allow decimals (`aiTemperature`); palette two-step editor + current-value hints like booleans.
- **Rename channel in palette** — rejected.
- **Prefer simpler flows over new subsystems** — e.g. extend Copy Prompt + Posts filters rather than built-in AI wizards when the task is occasional (channel tagging discussed 2026-06-30).

## Environment & fixes

- **Native dev:** `uv sync` → alembic on `app` → uvicorn :8000; `bun run dev` :5173. **`POSTGRES_DB=app`** for API.
- **Pre-commit:** `uv run prek run --all-files`; `bun run lint` (Biome).
- **Playwright:** `ENVIRONMENT=local bash scripts/generate-client.sh` → Docker image or local Chrome. **`frontend/tests/utils/privateApi.ts`** sets `OpenAPI.BASE` fallback chain: `VITE_API_URL` → `PLAYWRIGHT_API_URL` → `http://localhost:8000`. **`PLAYWRIGHT_CHANNEL=chrome`** when cached `chromium_headless_shell` install fails (Cursor sandbox extraction hang). Summarizer-only verify: `PLAYWRIGHT_CHANNEL=chrome bun run test tests/summarizer.spec.ts`.
- **Testing frontend bug fixes (workflow):**
  1. **Reproduce the reported path** — e.g. cold navigation to `/summarizer?tab=channels` (not tab-switch workaround). Confirm backend up (`docker compose up -d db prestart backend` or native uvicorn).
  2. **Add or extend a Playwright test** in `frontend/tests/summarizer.spec.ts` (or relevant spec) that asserts the fixed behavior; use `data-testid` hooks (`workspace-scroll`, `channel-grid-load-more`) and API seed helpers (`seedBulkChannels` in `tests/utils/seed-channel.ts`) when data setup is needed.
  3. **Run targeted test before claiming done:** `cd frontend && PLAYWRIGHT_CHANNEL=chrome bunx playwright test summarizer.spec.ts -g "<test name>" --project=chromium` (needs auth setup + `.env` `FIRST_SUPERUSER*`).
  4. **Build check:** `cd frontend && bun run build` (catches missing imports / TS errors that CI deploy will hit).
  5. **Scroll/intersection bugs:** verify `workspace-scroll` is actually scrollable (`scrollHeight > clientHeight`) and observer `root` matches that element — flex layouts without `min-h-0` cause window scroll instead.
  6. **Staging:** deploy frontend then re-test the original URL; local pass ≠ staging until deployed.
- **pytest:** `cd backend && uv run pytest tests/ -q` (`app_test`). Backfill: `tests/api/test_sync_jobs.py`, `tests/api/test_scheduler_jobs.py`. Settings defaults: `tests/api/test_settings_defaults.py`. Channel stats: `tests/services/test_channel_stats.py`.
- **Frontend unit tests:** `cd frontend && bun test src/lib/commands/settings-schema.test.ts src/lib/posts/post-view.test.ts`.
- **CI frontend build:** Docker `bun run build` runs `tsc` — missing imports (e.g. dropping `addChannelByName` when editing `ChannelGrid.tsx`) fail Playwright, test-docker-compose, and deploy workflows.
- **Scraper tunables:** `SCRAPER_ITERATION_LIMIT=50` (default); `SCRAPER_MAX_POSTS_PER_CHANNEL=300` applies to legacy forward `scrape_channel()` only, not orchestrator or Posts-tab view limit.
- **Retention tunables:** `RETENTION_POST_DAYS_DEFAULT=90`, `RETENTION_LOG_DAYS_DEFAULT=30`; mirror in `VITE_RETENTION_*` for frontend defaults.
- **Auto-sync tunables:** `AUTO_SYNC_INTERVAL_MINUTES_DEFAULT=60` (backend); frontend UI max **1440** min in `constants.ts` only.
- **2000+ channels** — avoid Sync All; prefer auto-sync / Sync Selected; bulk reset-sync only for policy-wide destructive re-scrape.
- **Partial history in staging** — fix via palette backfill commands or wait for auto-sync partial pickup; expect multi-pass for busy feeds.
- **Channel grid infinite scroll (fixed 2026-06-30)** — first-visit scroll failed because (a) page scrolled on window, not `workspace-scroll`, and (b) observer sentinel absent during skeleton load. Fixed via `h-svh`/`min-h-0` layout + `useScrollLoadMore`. Regression test: `channel grid loads more cards on first visit when scrolling` in `summarizer.spec.ts`.
- **Traefik / deploy** — see [deployment.md](deployment.md); staging needs self-hosted runner labels.

## Caveats

- **Never commit `.env`** or API keys.
- **Single scheduler instance** — no multi-replica without coordination.
- **AppSetting `jobs` row** overrides env job defaults once saved.
- **Auto-follow** can explode channel count; default off on existing channels.
- **`SettingsView.tsx`** still ~2000 lines (refactor deferred).
- **Deploy to Staging** — needs online self-hosted runner.
- **Playwright in Cursor agent sandbox** — browser zip extraction may hang; use Docker or system Chrome channel.
- **Partial history + high post volume** — one sync run may not clear the badge; re-run fix command or rely on auto-sync until `historyCompleteToCutoff` is true.
- **`autoSyncPartialBatchSize`** — sync AppSetting JSON only (not `.env`); default 1 partial channel per auto-sync tick.
- **Frontend vs backend numeric bounds** — auto-sync max (1440 min), Tor threshold (5–50), etc. are UI/palette clamps only; API may accept values outside UI range.
- **Posts-tab max-per-channel ≠ scraper `SCRAPER_MAX_POSTS_PER_CHANNEL`** — view filter is client-side on `filteredPosts` only; does not change sync behavior.
- **RAG/history chat + auto_summary job** — do not use Posts-tab view filters; only standard date-range path + `filteredPosts` consumers are aligned.
- **Wider app shell on ultrawide** — prose-heavy views may need internal column/grid constraints if line length becomes uncomfortable (not done yet).
- **Flex + `overflow-y-auto` scroll containers** — without `min-h-0` on flex ancestors, content expands and window scrolls; `IntersectionObserver` with a scroll-root ref will not fire on user scroll. Same pattern may affect `PostFeed` / `HistoryView` (not yet migrated to `useScrollLoadMore`).

## Out of scope / roadmap

- Mode B multi-user tenancy, pgvector, Celery/Redis, hover translation server-side.
- React context flattening (8 → 4 contexts); optional further `data.py` split.
- **SettingsView.tsx** component split (deferred).
- **Mobile responsive summarizer** (explicitly out of scope per UI polish Q1).
- **Dedicated backfill scheduler job** — deferred; auto-sync partial pickup covers v1.
- **E2E palette test for numeric editor apply path** — optional follow-up from numeric settings plan.
- **In-app AI channel tagging** — deferred; optional future: Paste Tags modal mirroring PasteSummaryModal.
- **Open Graph / shareable summary links** — plan drafted ([open_graph_meta](.cursor/plans/open_graph_meta_a62edbee.plan.md)); only static description/favicons/manifest landed (2026-06-30). Phases: build-time OG tags, share-link API, crawler HTML, dynamic OG images — **not started**.
- **Ideas backlog:** IDEA-001/004/005/006/007 **implemented**; IDEA-007 manual keyboard matrix optional; [IDEA-002](docs/ideas-log/ideas/IDEA-002-tanstack-devtools.md) TanStack devtools (dev-only).
