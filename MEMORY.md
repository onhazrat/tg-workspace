# TG Summarizer — Project Memory

> Last synced: 2026-06-10

## Purpose

Self-hosted Telegram channel summarizer. Migrated from browser-heavy `TG-Summarizer/` (React + Express + IndexedDB) to a **FastAPI + React monorepo** with scraping, scheduling, AI, and PostgreSQL on the server. **Migration Phases 0–7 complete (2026-06-08).** **Mode A remediation** largely complete through 2026-06-09 — see [REMEDIATION-PLAN.md](docs/migration/REMEDIATION-PLAN.md). Run commands: [README.md](README.md), [development.md](development.md).

## Architecture

- **`backend/`** — FastAPI (`app/main.py`), SQLModel (`app/models_tg.py`), Alembic, services (`scraper.py`, `sync_orchestrator.py`, `embeddings.py`, `bulk_channels.py`, `post_sync_state.py`, `runtime_config.py`, `operator.py`, …), APScheduler jobs (`app/jobs/`), pluggable AI (`app/ai/`, Gemini first).
- **`frontend/`** — React 19 + Vite + TanStack Router/Query; dual-route UI:
  - **`/_tg/summarizer`** — full-screen TG app (`App.tsx` + `TgProviders`)
  - **`/_layout/*`** — template admin shell (`/`, `/items`, `/admin`, `/settings`)
- **API clients (ADR-006):** hand-written `frontend/src/api/` (summarizer); generated `frontend/src/client/` (admin/auth). Regenerate: `bash scripts/generate-client.sh`.
- **Data layer (frontend):** `repository.ts` API-first → `cache.ts` (IndexedDB). **`db.ts` removed** (was deprecated re-export).
- **Tunables:** `backend/app/core/config.py` (`Settings`) + `frontend/src/lib/env.ts` (`VITE_*`); documented in `.env.example`.
- **`TG-Summarizer/`** — Original reference; keep indefinitely; not deployed (still has legacy global auto-follow code).
- **`docs/ideas-log/`** — Backlog for deferred product/engineering ideas (`IDEA-NNN` ids, detail files under `ideas/`). Index: [docs/README.md](docs/README.md). Master table: [IDEAS-LOG.md](docs/ideas-log/IDEAS-LOG.md).
- **uv workspace** — `.venv` at repo root; **bun** for frontend.

### Key API surfaces

- Versioned: `/api/v1/telegram/*`, `/network/*`, `/ai/*`, `/data/*`, `/rag/*`, `/jobs/*`
- **Legacy `/api/*`:** served in `local` only; **410 Gone in production** (`main.py` middleware).
- **Channel sync:** `POST /api/v1/jobs/sync` → progress via **SSE** `GET /api/v1/jobs/sync/{jobId}/events` (fallback poll: `GET .../sync/{jobId}`).
- **Runtime diagnostics:** `GET /api/v1/jobs/runtime-config` — effective sync/scraper/network/job/retention settings + optional `activeSyncJob` (`allowedConcurrency`, `concurrencyInUse`, …). Secrets/proxy creds redacted.
- **Bulk re-backfill:** `POST /api/v1/data/channels/bulk-reset-sync` (`confirm: true`). `bulk-reresolve-start-ids` is **deprecated no-op** (backward-sync era).
- OpenAPI: `/docs`, `/api/v1/openapi.json`

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
- **Sync concurrency** (Settings → **Scraping & Sync**, not Network): `syncConcurrency` — free numeric input (min 1; UI warns &gt;50). Drives `asyncio.Semaphore` in `run_sync_job`; **not** 1:1 with proxy count (proxies are a shared random pool per HTTP request).
- **Auto-follow UI:** Toggle on each **ChannelCard** (not global Settings). Distinct from **Auto-Followed** badge (`discoveredVia` set) = channel was discovered via another channel's forward.
- **Channel normalization:** `frontend/src/lib/channelNormalize.ts`.
- **Proxy resolution:** Per-user `proxyUrls` in Postgres `AppSetting`; `DEFAULT_PROXY_URLS` env is fallback only ([DECISIONS #11](docs/migration/DECISIONS.md)).
- **Summarizer UI:** URL tabs `/summarizer?tab=`; settings `?tab=settings&section=` (`useSettingsSection`).
- **Theme:** `theme-provider` (`vite-ui-theme`); not `SettingsContext`.
- **Sync logs:** `full_request` / `full_response` on log models accept **dict or list** (per-page backward scrape telemetry).

## Decisions (stable)

Locked [DECISIONS.md](docs/migration/DECISIONS.md) + **Mode A hardened single-operator (2026-06-09)** + **backward sync (2026-06-10)** + **per-channel auto-follow (2026-06-10)**:

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

### Explicitly rejected / deferred

- Mode B full per-user query scoping (unless chosen later).
- Celery/Redis, pgvector, deleting `TG-Summarizer/`.
- WebSocket-unified transport (SSE + REST kept).
- `bulk_reresolve_start_ids` as primary fix (deprecated; use bulk reset-sync).
- Invisible gap rows in `tg_posts` (use `post_sync_state`).
- **Global `autoFollowForwarded`** in AppSetting `sync` (replaced by per-channel flag; stale DB keys ignored).

## User preferences

- Self-hosted single operator; discuss trade-offs before big architectural bets.
- Per-user proxy URLs in UI (not env-only); many proxies + higher `syncConcurrency` for faster scraping (raise both; tune via `runtime-config`).
- Centralize tunables in `.env` / `.env.example`.
- Only commit when explicitly asked; do not edit locked plan files.
- **Ideas log** — Capture “work on later” items in `docs/ideas-log/IDEAS-LOG.md` (not migration ADRs). Start agent sessions with *"Work on IDEA-NNN from the ideas log."* Detail specs live in `docs/ideas-log/ideas/`.
- **Sync concurrency** in Scraping & Sync with arbitrary numeric choice (not capped slider).
- **Auto-follow migration:** existing channels default off; enable per channel as needed.

## Environment & fixes

- **Native dev:** `uv sync` → `cd backend && uv run alembic upgrade head` (on `app`) → uvicorn :8000; `bun run dev` :5173. **`POSTGRES_DB=app`** for API; never point dev server at `app_test`.
- **`relation "user" does not exist`** — run Alembic on `app` (empty DB volume).
- **pytest:** `cd backend && uv run pytest tests/ -q` (uses `app_test`).
- **Bootstrap superuser:** `FIRST_SUPERUSER` / `FIRST_SUPERUSER_PASSWORD` in `.env`; auto-created on lifespan.
- **`GEMINI_API_KEY`** — required for AI/embeddings/RAG.
- **Operator data fix** — `uv run python backend/scripts/backfill_user_id.py --reassign-all` after migration/import.
- **2000+ channels** — avoid **Sync All** in one shot (single 2000+ channel job, huge SSE/DB persist, default **30 min** frontend `VITE_SYNC_JOB_TIMEOUT_MS` may cancel job). Prefer auto-sync trickle, **Sync Selected** batches, or bulk reset-sync. Leave **Auto-Follow** off on channels that don't need forward discovery.
- **Web-unavailable channels** — `t.me/s/{ch}` → 302 to `t.me/{ch}` with no post widgets → frozen (`is_unavailable_on_web_view`); skipped on future syncs.

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
- **`concurrencyInUse` vs `allowedConcurrency`:** `allowedConcurrency` = configured semaphore; `concurrencyInUse` = channels in `running` status now (snapshot). Gap does not automatically mean DB pool — `running` is set before `Session()`; large jobs (2000+ channels) throttle via sync `touch_job` persisting full channel JSON, blocking ORM in async, proxy latency.
- **DB engine** (`app/core/db.py`) uses default SQLAlchemy pool (no custom `pool_size`); long-held `Session` per channel during sync may limit throughput — not proven cap on `running` count.
- **Proxies** — random pick per request from shared pool; not pinned per channel.
- **AppSetting `jobs` row** overrides env job defaults once saved in UI.
- **Auto-follow** can explode channel count; only channels with `autoFollowForwarded` enabled discover forwards; auto-followed channels get DB row only (no automatic first sync queued).
- **`development.md`** — bulk-reresolve and global auto-follow Settings instructions may be stale; use per-channel toggle on ChannelCard and **bulk-reset-sync**.

## Out of scope / roadmap

- Mode B multi-user tenancy.
- pgvector, Celery/Redis.
- Provider flattening (≤4 React contexts), Playwright in CI, full `data.py` thin-handler refactor.
- Hover translation server-side (deferred).
- Sync job chunking / lighter SSE for 2000+ channel jobs (not implemented).
- **Ideas backlog** — [docs/ideas-log/IDEAS-LOG.md](docs/ideas-log/IDEAS-LOG.md). Current items:
  - [IDEA-001](docs/ideas-log/ideas/IDEA-001-command-palette.md) — global command palette (`Cmd/Ctrl+K`), fuzzy find, central command registry wired to existing contexts; v1 navigation + theme, v2 mutating actions. Not NL chat; not replacing post/channel search.
