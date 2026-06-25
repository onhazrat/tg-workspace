# TG Summarizer — Project Memory

> Last synced: 2026-06-25 (keyboard UX commit `e803203`)

## Purpose

Self-hosted Telegram channel summarizer. Migrated from browser-heavy `TG-Summarizer/` (React + Express + IndexedDB) to a **FastAPI + React monorepo** with scraping, scheduling, AI, and PostgreSQL on the server. **Migration Phases 0–7 complete (2026-06-08).** **Mode A remediation** largely complete through 2026-06-09 — see [REMEDIATION-PLAN.md](docs/migration/REMEDIATION-PLAN.md). **Pre-feature codebase cleanup complete (2026-06-22)** — all 17 todos in [pre-feature cleanup plan](.cursor/plans/pre-feature_codebase_cleanup_77a87231.plan.md). Run commands: [README.md](README.md), [development.md](development.md).

## Architecture

- **`backend/`** — FastAPI (`app/main.py`), SQLModel (`app/models_tg.py`), Alembic, services (`scraper.py`, `sync_orchestrator.py`, `proxy_pool.py`, `network_settings.py`, `summaries.py`, `embeddings.py`, `bulk_channels.py`, `post_sync_state.py`, `runtime_config.py`, `operator.py`, `credentials.py`, `data_import_export.py`, `data_vectors.py`, `posts.py`, …), APScheduler jobs (`app/jobs/`), pluggable AI (`app/ai/`, Gemini first), shared prompts (`app/prompts/summary.py`).
- **`frontend/`** — React 19 + Vite + TanStack Router/Query; dual-route UI:
  - **`/_tg/summarizer`** — full-screen TG app (`App.tsx` + `TgProviders`); **command palette** (IDEA-001/004/005/006/007, on `main`): `cmdk` + shadcn `command`, `Cmd/Ctrl+Shift+P`, summarizer only — see [IDEA-001](docs/ideas-log/ideas/IDEA-001-command-palette.md), [IDEA-004](docs/ideas-log/ideas/IDEA-004-command-palette-data-transfer.md), [IDEA-005](docs/ideas-log/ideas/IDEA-005-command-palette-channel-ops-search.md), [IDEA-006](docs/ideas-log/ideas/IDEA-006-command-palette-extended.md), [IDEA-007](docs/ideas-log/ideas/IDEA-007-command-palette-keyboard-ux.md).
  - **`/_layout/*`** — template admin shell (`/`, `/items`, `/admin`, `/settings`)
- **Command palette (frontend):** `CommandPalette*.tsx`, `CommandConfirmDialog.tsx`, `PaletteKeyboardChrome.tsx`; hooks `useCommandPalette`, `useCommandRegistry`, `useCommandSearchAffinity`, `useRecentCommands`, `useJobToggles`, `usePaletteListSelection`; registry in `frontend/src/lib/commands/` (settings, navigate, channel-entities, channel-ops, data-commands, extended-commands, `filter-channels.ts`, `search-filters.ts`); data transfer in `frontend/src/lib/data-transfer/` (21 copy/export/import commands); channel CRUD helpers in `frontend/src/lib/channels/` (`add-channel.ts`, `delete-channel.ts`).
- **API clients (ADR-006):** hand-written `frontend/src/api/` (summarizer); generated `frontend/src/client/` (admin/auth). Regenerate: `bash scripts/generate-client.sh` (default `ENVIRONMENT=production` — no legacy routes in committed SDK; override `ENVIRONMENT=local` for Playwright/private routes).
- **Data layer (frontend):** `repository.ts` API-first → `cache.ts` (IndexedDB). **`db.ts` removed** (was deprecated re-export).
- **Data API routes:** `backend/app/api/routes/data.py` (~565 lines, down from ~1,222). Handlers thin; business logic in services. Shared serializers in `serialization.py`; request bodies in `schemas/data.py`.
- **Tunables:** `backend/app/core/config.py` (`Settings`) + `frontend/src/lib/env.ts` (`VITE_*`); documented in `.env.example` (incl. `VITE_COMMAND_PALETTE_RECENT_COUNT`, default 5).
- **Proxy lane pool (`proxy_pool.py`):** per-proxy `asyncio.Semaphore` + reused `httpx.AsyncClient` (`build_lane_client`, limits aligned to slots). Least-loaded dispatch; cooldown proxies skipped. All proxied `fetch_with_retry` gated through pool; **direct** and **`test_proxy`** bypass pool. Wired in sync, scrape, publish, auto-summary.
- **`TG-Summarizer/`** — Original reference; keep indefinitely; not deployed (still has legacy global auto-follow code).
- **`docs/ideas-log/`** — Backlog for deferred product/engineering ideas (`IDEA-NNN` ids, detail files under `ideas/`). Index: [docs/README.md](docs/README.md). Master table: [IDEAS-LOG.md](docs/ideas-log/IDEAS-LOG.md).
- **`_template_tmp/`** — Optional local clone of [Full Stack FastAPI Template](https://github.com/fastapi/full-stack-fastapi-template); reference for tooling conventions. **Not** tracked as a git submodule (broken gitlink removed 2026-06-22).
- **uv workspace** — `.venv` at repo root; **bun** for frontend.
- **Quality gates (template-aligned, 2026-06-22):** `.pre-commit-config.yaml` (ruff, mypy, ty, Biome, typos, zizmor, `generate-frontend-sdk` hook). Local: `uv run prek run --all-files`, `bash scripts/lint.sh`, `bun run lint` (Biome). **Vitest removed** — Playwright E2E only (**~94 tests** in `frontend/tests/`; palette keyboard K1–K17 in `summarizer.spec.ts`).
- **CI (GitHub-hosted, push to `main`):** `zizmor.yml`, `test-backend.yml`, `test-docker-compose.yml`, `playwright.yml`. **Private repo:** workflows need `permissions: contents: read`; artifact jobs need `actions: write`. Docker CI copies `.env.example` → `.env`. Zizmor: `advanced-security: false`, `annotations: true` (no SARIF without GHAS). Playwright CI: `ENVIRONMENT=local` client gen, `fetch-depth: 0` on paths-filter job.
- **pre-commit.yml** — runs on **pull_request only** (`opened`/`synchronize`), **not** on push to `main`. Optional `PRE_COMMIT` secret (PAT) for auto-fix commits on PR branches.
- **CD (self-hosted):** `deploy-staging.yml` on push to `main` (runner labels `self-hosted` + `staging`); `deploy-production.yml` on release published (`production` label). Uses `compose.yml` only + GitHub Environment secrets — see [deployment.md](deployment.md).
- **TLS / Traefik:** `compose.traefik.yml` — shared reverse proxy; Let's Encrypt **DNS-01** via Cloudflare (`CF_DNS_API_TOKEN`). App services in `compose.yml` expose `api.`, `dashboard.`, `adminer.` under `${DOMAIN}` with `certresolver=le`. See [deployment.md](deployment.md).
- **Local Docker:** `compose.override.yml` adds HTTP-only `proxy` (port 80, no ACME). `docker compose watch` auto-merges override → **no HTTPS**.

### Key API surfaces

- Versioned: `/api/v1/telegram/*`, `/network/*`, `/ai/*`, `/data/*`, `/rag/*`, `/jobs/*`
- **AI summary:** `POST /api/v1/ai/summary` (generate), `POST /api/v1/ai/summary/stream`, **`POST /api/v1/ai/summary/prompt`** (server-built prompt only — no LLM call; used by Copy Prompt)
- **Legacy `/api/*`:** served in `local` only; **410 Gone in production** (`main.py` middleware).
- **Channel sync:** `POST /api/v1/jobs/sync` → progress via **SSE** `GET /api/v1/jobs/sync/{jobId}/events` (fallback poll: `GET .../sync/{jobId}`).
- **Runtime diagnostics:** `GET /api/v1/jobs/runtime-config` — effective sync/scraper/network/job/retention settings + optional `activeSyncJob` (`allowedConcurrency`, `concurrencyInUse`, `effectiveProxyCapacity`, `proxyLanes`, …). Secrets/proxy creds redacted.
- **Bulk re-backfill:** `POST /api/v1/data/channels/bulk-reset-sync` (`confirm: true`). `bulk-reresolve-start-ids` is **deprecated no-op** (backward-sync era).
- OpenAPI: `/docs`, `/api/v1/openapi.json`

### Sync job model

- **In-process APScheduler** + per-job **`asyncio.Semaphore`** (`syncConcurrency`); not a separate worker queue ([ADR-004](docs/migration/ADR-004-job-runner.md)).
- **Auto-sync** trickles channels over time; for **2000+ channels** avoid **Sync All** in one shot (huge SSE/DB persist, default 30 min frontend timeout may cancel). Prefer auto-sync, **Sync Selected** batches, or bulk reset-sync.
- **Producer-consumer / Postgres job queue** deferred (would pair with job chunking for very large syncs).

## Data pipelines

- **Authoritative store:** PostgreSQL; client IndexedDB is read-through cache ([ADR-003](docs/migration/ADR-003-hybrid-sync.md)).
- **Scrape/sync (backward-sync era, 2026-06-10):** `sync_orchestrator.py` paginates **backward** via `scrape_channel_page()` (`?before=`). Stop bound: `compute_scrape_cutoff_ms()` = **max(retention window, Default Channel Start Time)**; when `postRetentionDays=0`, global start time is the bound. **Initial** sync walks back until oldest page post &lt; cutoff; **incremental** walks back until first existing DB post. **Lazy migration** — existing channels only deep-backfill after **Reset & Sync** or bulk reset-sync.
- **Coverage model:** `Post.is_anchor` = newest visible post with `timestamp < scrapeCutoff` (one per channel; **retention job exempts anchors**). `Channel.history_complete_to_cutoff`, `anchor_post_id`, `oldest_stored_post_timestamp`. Gaps in `tg_post_sync_state` (`confirmed_gap` between visible neighbors on overlapping page fetches) — **not** fake rows in `tg_posts`.
- **Post retrieval metadata (first save only):** `retrieved_at`, `retrieval_job_id`, `retrieval_pass` (`initial`|`incremental`), `retrieval_source`.
- **Auto-follow forwarded:** During sync, if **`Channel.auto_follow_forwarded`** is true, `_maybe_add_forwarded_channel()` adds unseen `forwardedFrom` sources with `discovered_via` payload. **Per-channel only** (not global). New/auto-discovered channels default `false`; existing rows migrated `false`.
- **Embeddings/RAG:** Server Gemini backfill; **skip `is_anchor` posts**. pgvector deferred ([ADR-005](docs/migration/ADR-005-vector-search.md)).
- **Jobs** (APScheduler): `auto_sync`, `embeddings`, `auto_summary`, `retention`, `translation_batch`. Default **enabled** flags from env `JOBS_*_ENABLED_DEFAULT` until persisted in AppSetting `jobs` row.
- **Alembic:** backward-sync `e7f8a9b0c1d2_backward_sync_fields.py`; per-channel auto-follow `f8a9b0c1d2e3_add_channel_auto_follow_forwarded.py`.

## Analysis conventions

- **Channel identity:** `channel_id` / `name`; API camelCase (`channelName`, `startId`, `startTime`, `autoFollowForwarded`, `historyCompleteToCutoff`, `discoveredVia`, …).
- **Timestamps:** ms since epoch (BIGINT in Postgres).
- **Default Channel Start Time** (Settings → Scraping & Sync): `globalStartTimeMode` (`retention` | `relative` | `absolute`) + `globalStartTimeValue`; mirrored in `compute_effective_global_start_time_ms()` / `compute_scrape_cutoff_ms()` (`jobs/settings.py`).
- **Sync concurrency** (Settings → **Scraping & Sync**, not Network): `syncConcurrency` — free numeric input (min 1; UI warns &gt;50). Drives job semaphore; when proxies active, **capped by** `compute_proxy_pool_capacity()` (sum of per-proxy slots).
- **Proxy concurrency** (Settings → **Network**, advanced): `proxyDefaultConcurrency` (default 1, clamp 1–20; env `PROXY_DEFAULT_CONCURRENCY_DEFAULT`) + `proxyConcurrencyOverrides` (normalized URL → slots). Tune **both** proxy slots and `syncConcurrency` for throughput; check `runtime-config` for `effectiveProxyCapacity` / `proxyLanes`.
- **Auto-follow UI:** Toggle on each **ChannelCard** (not global Settings). Distinct from **Auto-Followed** badge (`discoveredVia` set) = channel was discovered via another channel's forward.
- **Channel normalization:** `frontend/src/lib/channelNormalize.ts`.
- **Proxy resolution:** Per-user `proxyUrls` in Postgres `AppSetting`; `DEFAULT_PROXY_URLS` env is fallback only ([DECISIONS #11](docs/migration/DECISIONS.md)).
- **Summarizer UI:** URL tabs `/summarizer?tab=`; settings `?tab=settings&section=` (`useSettingsSection`). **Post-login redirect:** `/summarizer` (not template dashboard `/`). Guided tour auto-starts when no channels — E2E sets `localStorage.hasSeenTour=true`. Summary toolbar: **Generate Summary** + **Copy Prompt** (`SummaryConfig.tsx`).
- **Command palette:** `Cmd+Shift+P` / `Ctrl+Shift+P` + header icon; `CommandPaletteProvider` in `TgProviders`. Settings + job toggles + navigate + channel entity flows + channel ops + data transfer + extended commands + in-palette search. Recents when search empty; query→command affinity (`localStorage`); `VITE_COMMAND_PALETTE_RECENT_COUNT` (default 5). Entity sub-flows: `closeOnPick: false` for select/deselect/freeze/unfreeze/toggle-auto-follow (multi-pick stays open; `aria-live` polite announcement). Tag search: `tag:` / `#` prefix via `filter-channels.ts`. Post/summary search: in-palette `search-results` mode (cap 50); empty query clears filter; post search clears semantic. Entity input refocus via `requestAnimationFrame`. `requiresConfirmation` on bulk freeze/unfreeze, delete channel, import, clear cache. **Keyboard UX (IDEA-007):** `usePaletteListSelection` controlled cmdk in `commands` | `entity` | `search-results` with `loop={true}`; `PaletteSubViewHeader` / `PaletteFooterHints`; root Enter + **Cmd/Ctrl+Enter** run highlighted command (`selectedCommandId`, not always top rank); confirm — Cancel autofocus, Enter/arrows; editor Enter/⌃↵ apply + `isEditorApplying` async guard; dialog X `tabIndex={-1}` in list modes. Chained editors (add-tag) render via `getChainedEditorField`. Import after confirm still needs native file picker. E2E: keyboard-only **K1–K17** in `summarizer.spec.ts`. Detail: [IDEA-007](docs/ideas-log/ideas/IDEA-007-command-palette-keyboard-ux.md).
- **External AI summary flow:** Copy Prompt → clipboard + **pending** history entry (same metadata as generate: channels, date range, post count, language, model). Pending state in `Summary.extra`: `status: "pending"` + `promptText`. User completes via **`PasteSummaryModal`** on that history item (Summary view CTA or History list) — **no global paste toolbar button**. Completed: `source: "pasted"`; model `"external"` (`PASTED_SUMMARY_MODEL`) or optional user-typed name; **no LLM log**. Re-paste blocked once completed; pending persists until completed or deleted. `summaries.py` upsert: **`null` extra fields remove keys** (clears `status` on completion).
- **Theme:** `theme-provider` (`vite-ui-theme`); not `SettingsContext`.
- **Sync logs:** `full_request` / `full_response` on log models accept **dict or list** (per-page backward scrape telemetry).

## Decisions (stable)

Locked [DECISIONS.md](docs/migration/DECISIONS.md) + **Mode A hardened single-operator (2026-06-09)** + **backward sync (2026-06-10)** + **per-channel auto-follow (2026-06-10)** + **Cloudflare DNS TLS (2026-06-16)** + **proxy-bound worker pool (2026-06-22, IDEA-003)** + **external AI summary workflow (2026-06-22)** + **template tooling alignment (2026-06-22)** + **command palette (2026-06-24–25, IDEA-001/004/005/006/007)**:

1. **Single-operator (Mode A)** — Production: `API_KEY`, `TOKEN_ENCRYPTION_KEY`, strong `SECRET_KEY`, `USERS_OPEN_REGISTRATION=false`. Reads unscoped; `user_id` columns are forward-compatible metadata. Mode B multi-user deferred.
2. **Auth** — JWT + optional `X-API-Key`; fail-closed on sensitive routes in non-local.
3. **Data** — Postgres authoritative; IndexedDB cache; API-first writes with visible fallback toast.
4. **Jobs** — APScheduler in-process; single replica ([ADR-004](docs/migration/ADR-004-job-runner.md)).
5. **Bot tokens** — Fernet `TOKEN_ENCRYPTION_KEY`; `credentialId` for publish; no raw tokens outside `local`.
6. **Scheduler defaults (env)** — `JOBS_EMBEDDINGS_ENABLED_DEFAULT=false`, `JOBS_TRANSLATION_BATCH_ENABLED_DEFAULT=false`; others default true.
7. **Embeddings toggle** — AI “Enable Embeddings & RAG” hydrates from `GET /jobs/status` and pushes `PUT /jobs/embeddings` (server job).
8. **Sync progress** — SSE with throttled DB persist (`SYNC_JOB_*` env); not 1 Hz polling.
9. **Test isolation** — pytest uses `POSTGRES_DB=app_test` only; per-test `tg_*` truncate; dev data in `app`.
10. **Do not edit** `.cursor/plans/tg-summarizer_migration_study_707614fc.plan.md`.
11. **Backward scrape bound** — `max(retentionCutoff, globalStartTime)`; anchor post kept as real `Post` row; gaps in `post_sync_state` only (rejected: invisible placeholder posts in `tg_posts`).
12. **`start_id` resolve** — no longer on main sync path; columns kept for compat / manual UI. Use reset-sync for full re-backfill.
13. **Auto-follow forwarded** — `Channel.auto_follow_forwarded` (DB/API `autoFollowForwarded`); decided per source channel during sync. **Removed** global `sync.autoFollowForwarded` from defaults, runtime-config, and Settings UI. Migration: all existing channels `false` (user choice; no copy from old global).
14. **Let's Encrypt via Cloudflare DNS-01** — `compose.traefik.yml` uses `dnschallenge.provider=cloudflare` + `CF_DNS_API_TOKEN` (Zone:Read + DNS:Edit). **Rejected TLS-01** (breaks behind orange-cloud proxy). DNS challenge does not require the server to be publicly reachable on :443.
15. **Proxy-bound worker pool** — Per-proxy lane semaphores + reused httpx clients gate proxied HTTP; least-loaded dispatch; `syncConcurrency` capped by pool capacity when proxies active. `test_proxy` and direct fetches bypass pool. Detail: [IDEA-003](docs/ideas-log/ideas/IDEA-003-proxy-bound-worker-pool.md).
16. **External AI summary workflow** — `POST /api/v1/ai/summary/prompt` returns server-built prompt (`app/prompts/summary.py`). Copy Prompt creates pending history entry; paste completes **that item** via modal. Optional external model name; default display **External**. No `saveLLMLog` for pasted completions. Tested: `backend/tests/api/test_ai_summary.py`.
17. **Template tooling (pre-feature cleanup)** — Align with Full Stack FastAPI Template (`_template_tmp/`): prek/pre-commit at repo root (not separate `lint.yml` CI), Biome frontend lint, zizmor workflow + hook, `[tool.typos]` in root `pyproject.toml`. OpenAPI/client regen excludes legacy routes by default (`ENVIRONMENT=production`). **Vitest removed**; E2E via Playwright only. `data.py` decomposed into services/schemas/serialization; optional future split to ~300 lines if handlers still feel heavy.
18. **CI hardening (2026-06-22)** — Private-repo checkout fix (`contents: read`). Flaky `test_cancel_sync_job`: `_row_to_state` sets `cancel_event` when DB status is `cancelled`. Linux CI: lowercase shadcn UI filenames (`button.tsx`, etc.). `frontend/src/lib/env.ts` guards `import.meta` for Playwright Node runner. Playwright tests aligned to TG app (login→`/summarizer`, `toPlaywrightAppUrl()` for reset-password emails).
19. **Command palette core (IDEA-001)** — `cmdk` + shadcn on `/_tg/summarizer` only. **`Cmd+Shift+P` / `Ctrl+Shift+P`** (rejected `Cmd/Ctrl+K`). All `SettingsContext` mutables + 5 job toggles via `useJobToggles`; Publishing CRUD excluded. Boolean commands: Toggle/Enable/Disable + ON/OFF badge; enums flat; free-form via in-palette editor; `requiresConfirmation` on bulk freeze/unfreeze + clear cache + import (not sync). Recents + search-affinity ranking (`rank-commands.ts`). Entity sub-flows: Backspace-on-empty / Escape / Back returns to root. NL assistant + open-post: stubs only.
20. **Palette data transfer (IDEA-004)** — `frontend/src/lib/data-transfer/`: entity JSONL envelope (`header` + `record` lines, schema v1); **21 commands** (copy/export/import × channels/posts/summaries). Channels: all/selected/frozen filters; posts/summaries: all/selected; **selected** posts/summaries intersect `selectedChannels`. Import merge-by-id with confirm dialog.
21. **Palette channel ops & search (IDEA-005)** — Add/delete/sync channel; search posts/summaries. **In-palette search** (`search-results` mode), not navigate-only. Add channel: `closeOnApply: false` (palette stays open). Delete/sync entity pickers include **all channels** (incl. frozen); sync uses `ignoreFrozen: true`. Empty search clears filter; post search clears semantic. **Rename channel rejected.**
22. **Palette keyboard UX (IDEA-007, 2026-06-25)** — Raycast/VS Code-style keyboard for all palette modes. Shared `usePaletteListSelection`; `loop={true}`; confirm autofocus Cancel + Enter/arrows; root Cmd/Ctrl+Enter alias; `aria-live` on stay-open picks; chained editor apply fix (add-tag). E2E K1–K17 keyboard-only (`docker compose build playwright` when test source changes). Import after confirm still requires native file picker (documented exception). Manual keyboard matrix (trackpad off) not yet run.

### Explicitly rejected / deferred

- Mode B full per-user query scoping (unless chosen later).
- Celery/Redis, pgvector, deleting `TG-Summarizer/`.
- WebSocket-unified transport (SSE + REST kept).
- `bulk_reresolve_start_ids` as primary fix (deprecated; use bulk reset-sync).
- Invisible gap rows in `tg_posts` (use `post_sync_state`).
- **Global `autoFollowForwarded`** in AppSetting `sync` (replaced by per-channel flag; stale DB keys ignored).
- **TLS-01 ACME challenge** for production Traefik (replaced by DNS-01).
- **mkcert** as default local TLS path (optional alternative; prod-like local uses real LE + Cloudflare).
- **Producer-consumer sync queue** — deferred; current model is semaphore-limited in-process jobs.
- **Proxy pool v2** — weighted proxy pick, full circuit breaker, `http2=True` on lane clients ([IDEA-003 follow-ups](docs/ideas-log/ideas/IDEA-003-proxy-bound-worker-pool.md)).
- **Global "Paste AI Response" toolbar button** — replaced by history-linked pending flow.
- **Overwrite current summary on paste** — paste updates the pending entry in place, not the loaded summary.
- **One-click clipboard paste** without review modal.
- **In-app `selectedModel` dropdown** for pasted summary attribution (optional free-text field instead).
- **Separate `lint.yml` CI workflow** — pre-commit/prek workflow covers backend + frontend (template pattern).
- **`Cmd/Ctrl+K` command palette shortcut** — use `Cmd/Ctrl+Shift+P` (VS Code style).
- **Publishing bot/destination CRUD in palette** — excluded from v1.
- **NL assistant execution inside palette** — stub only; Chat tab stays separate.
- **Open post by ID in palette** — deferred (stub `entity-root`).
- **Admin template shell palette** (`/_layout/*`) — summarizer only.
- **Rename channel in palette** — explicitly rejected by user.

## User preferences

- Self-hosted single operator; discuss trade-offs before big architectural bets.
- Per-user proxy URLs in UI (not env-only); tune `proxyDefaultConcurrency` / overrides **and** `syncConcurrency` together; verify via `runtime-config`.
- Centralize tunables in `.env` / `.env.example`.
- Only commit when explicitly asked; do not edit locked plan files.
- **Ideas log** — Capture “work on later” items in `docs/ideas-log/IDEAS-LOG.md` (not migration ADRs). Start agent sessions with *"Work on IDEA-NNN from the ideas log."* Detail specs live in `docs/ideas-log/ideas/`.
- **Sync concurrency** in Scraping & Sync with arbitrary numeric choice (not capped slider).
- **Auto-follow migration:** existing channels default off; enable per channel as needed.
- **Single root `.env`** for Traefik + app when both compose files run from repo root; no separate Traefik env file unless split deploy layout.
- **External AI:** prefer explicit user review before saving pasted responses (modal, not one-click).
- **Tooling:** follow Full Stack FastAPI Template conventions where possible; document TG-specific deviations (legacy OpenAPI exclusion, dual API clients).
- **Command palette:** brainstorm with explicit AskQuestion choices before implementing; **no assumptions** on shortcuts, phasing, or UX without user confirmation. **Rename channel** explicitly rejected.

## Environment & fixes

- **Native dev:** `uv sync` → `cd backend && uv run alembic upgrade head` (on `app`) → uvicorn :8000; `bun run dev` :5173. **`POSTGRES_DB=app`** for API; never point dev server at `app_test`.
- **Pre-commit:** `cd backend && uv run prek install -f`; run all hooks: `uv run prek run --all-files`. PR-only CI: `pre-commit.yml` (won't run if you push straight to `main`).
- **Playwright (CI-parity):** `ENVIRONMENT=local bash scripts/generate-client.sh` → `docker compose build playwright` → `docker compose run --rm playwright bunx playwright test --fail-on-flaky-tests`. **Rebuild playwright image** after changing test source (image does not mount live source). Faster loop: stack up + `cd frontend && bunx playwright install chromium && bunx playwright test` (see [development.md](development.md)). **Local port conflicts:** optional `PLAYWRIGHT_API_URL` (vite proxy only, not `VITE_API_URL`) + alternate dev port in `playwright.config.ts` when `:8000` is taken. Optional `PLAYWRIGHT_CHANNEL=chrome` for system Chrome. **Cursor agent sandbox:** `playwright install chromium` may hang at zip extraction — use Docker or `~/Library/Caches/ms-playwright`.
- **`relation "user" does not exist`** — run Alembic on `app` (empty DB volume).
- **pytest:** `cd backend && uv run pytest tests/ -q` (uses `app_test`).
- **Bootstrap superuser:** `FIRST_SUPERUSER` / `FIRST_SUPERUSER_PASSWORD` in `.env`; auto-created on lifespan.
- **`GEMINI_API_KEY`** — required for AI/embeddings/RAG.
- **Operator data fix** — `uv run python backend/scripts/backfill_user_id.py --reassign-all` after migration/import.
- **2000+ channels** — avoid **Sync All** in one shot; prefer auto-sync trickle, **Sync Selected** batches, or bulk reset-sync. Leave **Auto-Follow** off on channels that don't need forward discovery.
- **Web-unavailable channels** — `t.me/s/{ch}` → 302 to `t.me/{ch}` with no post widgets → frozen (`is_unavailable_on_web_view`); skipped on future syncs.
- **Traefik env (`.env.example` Traefik section):** `DOMAIN`, `CF_DNS_API_TOKEN`, `EMAIL`, `USERNAME`, `HASHED_PASSWORD`. **`HASHED_PASSWORD`** must be a pre-computed `openssl passwd -apr1` hash; escape `$` as `$$` in `.env` for Docker Compose. **One canonical `DOMAIN`** — duplicate keys in `.env` cause silent wrong host routing.
- **Local prod-like HTTPS:** `docker network create traefik-public` (once), then `docker compose -f compose.yml -f compose.traefik.yml up -d` — **not** `docker compose watch` (override = HTTP-only). Set `FRONTEND_HOST` and `BACKEND_CORS_ORIGINS` to `https://dashboard.${DOMAIN}` / `https://api.${DOMAIN}`. `/etc/hosts` or DNS must resolve subdomains to the machine.
- **ACME retry after failure:** delete stale `_acme-challenge.*` TXT records in Cloudflare, then `docker compose … restart traefik`. Until LE succeeds, Traefik serves its **default self-signed cert** (browser warning).
- **Bulk re-backfill / auto-follow docs:** `development.md` updated — `bulk-reset-sync` API, per-channel `autoFollowForwarded` on ChannelCard; `bulk_reresolve_start_ids.py` deprecated.
- **Palette bugs fixed (2026-06-23/25):** query reset on `jobToggles` dep (use stable `refreshJobStatus` only); cmdk arrow/hover desync; entity sub-view input focus (`requestAnimationFrame`); deselect multi-pick `closeOnPick: false`; editor value wipe on context refresh (init on `editorCommand.id` only); Enter-to-apply on editor; chained editor panel empty for add-tag (`getChainedEditorField`); root Enter must respect arrow-highlighted command not just top rank; Playwright clipboard/download fallbacks for `navigator.webdriver`.

### Maintenance scripts (`backend/scripts/`)

| Script | Purpose |
|--------|---------|
| `backfill_user_id.py` | Assign operator `user_id` to TG rows (`--reassign-all` for stale IDs) |
| `cleanup_test_channels.py` | Remove pytest channel pollution from dev `app` |
| `cleanup_auto_follow_channels.py` | Freeze/delete `discoveredVia` channels (`--auto-follow-only`) |
| `bulk_reresolve_start_ids.py` | **Deprecated** — use bulk reset-sync instead |

## Caveats

- **Never commit `.env`** or expose API keys.
- **Single scheduler instance** — no multi-replica without coordination.
- **`concurrencyInUse` vs `allowedConcurrency`:** `allowedConcurrency` = configured semaphore (may be pool-capped); `concurrencyInUse` = channels in `running` status now (snapshot). Large jobs (2000+ channels) throttle via sync `touch_job` persisting full channel JSON, blocking ORM in async, proxy latency.
- **DB engine** (`app/core/db.py`) uses default SQLAlchemy pool (no custom `pool_size`); sync orchestrator DB offload audit done in cleanup — remaining `Session(engine)` blocks classified; further pool tuning deferred unless profiling shows need.
- **Proxies** — lane pool default 1 slot/proxy; raising slots without enough proxies still caps at pool sum; cooldown excludes lane from acquire.
- **AppSetting `jobs` row** overrides env job defaults once saved in UI.
- **Auto-follow** can explode channel count; only channels with `autoFollowForwarded` enabled discover forwards; auto-followed channels get DB row only (no automatic first sync queued).
- **`data.py`** still above ~300-line aspirational target (~565 lines); optional further domain splits if adding heavy data API features.
- **`docker compose watch`** — HTTP-only Traefik proxy; no port 443, no Let's Encrypt.
- **Deploy to Staging queued** — not a code failure; needs an online self-hosted runner with labels `self-hosted` and `staging`.
- **PAT push to workflows** — changing `.github/workflows/*` requires GitHub token with `workflow` scope.
- **Command palette (IDEA-001–007)** — committed on `main` (keyboard UX `e803203`, 2026-06-25). CI Playwright should cover palette + K1–K17; verify after push if workflow fails.

## Out of scope / roadmap

- Mode B multi-user tenancy.
- pgvector, Celery/Redis.
- React context flattening (8 → 4 contexts).
- Optional further `data.py` route split (~300 lines).
- Hover translation server-side (deferred).
- Sync job chunking / lighter SSE for 2000+ channel jobs.
- Template workflows not yet adopted: `smokeshow.yml` coverage badge, `guard-dependencies.yml`.
- **Ideas backlog** — [IDEAS-LOG.md](docs/ideas-log/IDEAS-LOG.md): **IDEA-001/004/005/006/007 implemented on `main`**; IDEA-007 manual keyboard matrix still optional before calling fully shipped; [IDEA-002](docs/ideas-log/ideas/IDEA-002-tanstack-devtools.md) TanStack devtools (dev-only); [ui polish audit plan](.cursor/plans/ui_polish_audit.plan.md) in progress locally (not committed).
