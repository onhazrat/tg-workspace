# TG Summarizer — Project Memory

> Last synced: 2026-07-15

## Purpose

Self-hosted Telegram channel summarizer. Migrated from browser-heavy `TG-Summarizer/` (React + Express + IndexedDB) to a **FastAPI + React monorepo** with scraping, scheduling, AI, and PostgreSQL on the server. **Migration Phases 0–7 complete (2026-06-08).** **Dynamic channel sync v1 (2026-07-01)** — [dynamic_channel_sync plan](.cursor/plans/dynamic_channel_sync_77e7db50.plan.md). **Tag tab v1 (2026-07-02)** — [tag_tab_v1 plan](.cursor/plans/tag_tab_v1_cea80474.plan.md). **Post media v1 (2026-07-04)**. **Discover tab v1 (2026-07-06)** — [discover_tab_v1 plan](.cursor/plans/discover_tab_v1_f26ed84d.plan.md). **Channel setting groups v1 + UX v2 (2026-07-07)** — [channel_setting_groups plan](.cursor/plans/channel_setting_groups_89fcc8b4.plan.md), [setting_groups_ux_v2 plan](.cursor/plans/setting_groups_ux_v2_fb1c5766.plan.md). **Trim channel selection (2026-07-08)**. **Channel telegram chat ID v1 (2026-07-08/09)** — [channel_telegram_chat_id plan](.cursor/plans/channel_telegram_chat_id_9fdb00fd.plan.md). **Frontend architecture refactor (2026-07-13, PR #6)**. **Recheck restricted channels v2 (2026-07-15)** — [recheck_restricted_channels plan](.cursor/plans/recheck_restricted_channels_82e9ba83.plan.md): four inherited sync permission flags, full channel selection, operation-aware sync gates. **Discover bulk follow (2026-07-15)** — fire-and-forget follow job + chained sync (`sync_mode=bulk`); Discover multi-select + web-view handle links. Run commands: [README.md](README.md), [development.md](development.md).

## Architecture

- **`backend/`** — FastAPI (`app/main.py`), SQLModel (`app/models_tg.py`), Alembic, services (`scraper.py`, `sync_orchestrator.py`, **`sync_schedule.py`**, `channels.py`, **`followed_channels.py`**, **`bulk_follow.py`**, **`channel_setting_groups.py`**, **`channel_tags.py`**, **`tag_runs.py`**, **`post_media_parser.py`**, **`post_thumbnails.py`**, **`telegram_html.py`**, …), APScheduler jobs, pluggable AI (`app/ai/`, Gemini first). Prompts in `backend/app/prompts/`.
- **`frontend/`** — React 19 + Vite + TanStack Router/Query; dual-route UI:
  - **`/_tg/summarizer`** — full-screen TG app (`App.tsx` + `TgProviders`); **command palette** on `main`. Main content uses **`app-shell`** width utility.
  - **`/_layout/*`** — template admin shell (`/`, `/items`, `/admin`, `/settings`).
- **Providers (TG shell):** `Settings → Data → UI → Scraper → Chat → AI → Tag` in [`TgProviders.tsx`](frontend/src/components/TgProviders.tsx).
- **Component decomposition (2026-07-13, PR #6):** `SettingsView`, `LogsView`, `ChannelGrid`, `CommandPalette` split into focused subcomponent dirs + tested `lib/` logic.
- **Settings state (schema-driven, 2026-07-13):** `SettingsContext` over zod schema — [`lib/settings/schema.ts`](frontend/src/lib/settings/schema.ts). **New settings go in the schema, not new `useState`.**
- **Server state (TanStack Query, 2026-07-13):** `DataContext` + [`queryKeys.ts`](frontend/src/hooks/queryKeys.ts); cache write-throughs via [`applySetStateAction.ts`](frontend/src/lib/applySetStateAction.ts).
- **Command palette:** `frontend/src/lib/commands/` — registry, settings-schema, channel ops, **`group-commands.ts`**, **`channel-telegram-chat-id-commands.ts`**, **`recheck-restricted-channels`** action.
- **Post view pipeline:** [`post-view.ts`](frontend/src/lib/posts/post-view.ts); **`filteredPosts` is canonical** for Posts UI, Summary, Chat, Tag, and **Discover**.
- **Discover bulk follow (2026-07-15):** web-view links on Channel + Forwarded-by; multi-select (`discover-selection.ts`); confirm when ≥5; single Follow uses bulk API; created channels added to workspace selection. Backend: in-memory follow jobs with bounded parallel scrapes; shared create helper [`followed_channels.py`](backend/app/services/followed_channels.py).
- **Setting groups:** [`channel_setting_groups.py`](backend/app/services/channel_setting_groups.py) — strict inheritance; frontend [`SettingGroupsPanel.tsx`](frontend/src/components/SettingGroupsPanel.tsx), [`setting-groups.ts`](frontend/src/lib/channels/setting-groups.ts), [`useSettingGroups.ts`](frontend/src/hooks/useSettingGroups.ts). Virtual `group:{name}` tags on cards (read-only).
- **Sync permissions (2026-07-15):** four inherited group flags on `tg_channel_setting_groups`; frontend helper [`sync-permissions.ts`](frontend/src/lib/channels/sync-permissions.ts) (`channelAllows`, `disabledReason`, `filterChannelsForSyncOperation`). Backend helpers `channel_allows_sync_operation`, `channel_allows_reset`, `SyncOperationMode` in `channel_setting_groups.py`. Jobs API `POST /jobs/sync` accepts **`syncMode`**: `sync_all` | `bulk` | `individual` | `recheck_restricted` | `auto`.
- **Channel grid:** [`sort-channels-for-grid.ts`](frontend/src/lib/channels/sort-channels-for-grid.ts), [`trim-selected-channels.ts`](frontend/src/lib/channels/trim-selected-channels.ts). **All channels selectable** including frozen/restricted (2026-07-15).
- **Telegram chat ID:** server-managed `telegramChatId`; extracted from `data-view` on scrape.
- **uv** + **bun**. **Bun unit tests** — `bun run test:unit` (~310 tests). **Playwright E2E** in `frontend/tests/`.
- **CI/CD:** GitHub-hosted tests on push; self-hosted deploy — [deployment.md](deployment.md). **Migrations on deploy:** `prestart` → `alembic upgrade head`.

### Key API surfaces

- Versioned: `/api/v1/telegram/*`, `/network/*`, `/ai/*`, `/data/*`, `/rag/*`, `/jobs/*`
- **Channel sync:** `POST /jobs/sync` with optional `channelIds` + **`syncMode`** → SSE events.
- **Bulk follow:** `POST/GET/SSE/cancel` on `/data/channels/bulk-follow` — fire-and-forget follow job; on success chains one sync job (`sync_mode=bulk`) as `syncJobId`.
- **Channels:** `GET/PUT/DELETE /data/channels/{id}`; bulk endpoints for sync-settings, tags, setting-group.
- **Setting groups:** `GET/POST /data/setting-groups`; `PUT/DELETE /data/setting-groups/{id}` — includes four sync permission fields.
- OpenAPI: `/docs`, `/api/v1/openapi.json`

## Data pipelines

- **Authoritative store:** PostgreSQL; IndexedDB read-through cache ([ADR-003](docs/migration/ADR-003-hybrid-sync.md)).
- **Scrape/sync:** `sync_orchestrator.py`; passes: `initial` / `incremental` / `backfill`. **Partial history** = `historyCompleteToCutoff === false`.
- **Per-channel auto-sync:** `regularSyncEnabled`, `dynamicSyncEnabled`, deadlines inherited from setting group. **Auto-sync scheduling unchanged** — not gated by sync permission flags (2026-07-15).
- **Setting groups:** built-in per scope: `default`, **Slow feed**, **High velocity**, `Frozen`, `Restricted`. Strict inheritance for all group fields including sync permissions.
- **Unavailable web view:** channels in **Restricted** group (`isUnavailableOnWebView`); successful recheck sync or metadata refresh → **auto-promote to default** group (2026-07-15).
- **Jobs:** `auto_sync`, `embeddings`, `auto_summary`, `retention`, `translation_batch`.
- **Post media:** `tg_posts.media` JSON; thumbs on disk under `data/post-thumbs`.

## Analysis conventions

- **Channel identity:** `channel_id` / `name` primary; **`telegramChatId`** supplementary. API camelCase. Timestamps: ms epoch.
- **Summarizer UI:** 8 workspace tabs: channels, posts, summary, tag, discover, chat, history, settings.
- **Channels tab selection (2026-07-15):** all channels selectable; Select All includes frozen/restricted; selection independent of group semantics.
- **Sync permission matrix (inherited from group):**

| Operation | Flag(s) |
|---|---|
| Sync All | `includeInSyncAll` |
| Sync Selected, Fix Partial History, palette Recheck Restricted | `includeInBulkSync` (palette targets all `isUnavailableOnWebView`) |
| Card Sync / palette Sync Channel | `allowIndividualSync` |
| Reset & Sync (card/palette) | `resetSyncEnabled` |
| Bulk Reset All / Fix Partial (reset half) | `includeInBulkSync` **and** `resetSyncEnabled` |

- **Built-in presets:** Restricted = sync-all off, bulk+individual on, reset off. Frozen = sync-all+bulk off, individual+reset on. default/Slow feed/High velocity = all on.
- **UI when denied:** disable control with tooltip citing group + flag name.
- **Command palette:** `Cmd+Shift+P`; includes **Recheck Restricted Channels**; group filter via `channelGroup` URL param.
- **Channels tab group filter chips:** built-in order: default → Slow feed → High velocity → Frozen → Restricted → custom.

## Decisions (stable)

1. **Single-operator (Mode A)** — see [DECISIONS.md](docs/migration/DECISIONS.md).
2. **Data** — Postgres authoritative; IndexedDB cache; API-first writes.
3. **Channel setting groups v1 (2026-07-07)** — strict inheritance; no per-channel overrides for inherited fields.
4. **Channel telegram chat ID v1 (2026-07-08/09)** — username primary; server-managed ID; mismatch → Frozen.
5. **Frontend refactor (2026-07-13, PR #6)** — god-component split; schema-driven settings; TanStack Query data layer.
6. **Sync permission flags v2 (2026-07-15)** — four inherited booleans on setting groups replace hardcoded `isFrozen` sync skips:
   - `includeInSyncAll`, `includeInBulkSync`, `allowIndividualSync`, `resetSyncEnabled`
   - **Backend flags only** — no `forceSync` override; reject/skip per operation type
   - **`isFrozen` / `isUnavailableOnWebView` kept** as semantic badges + auto-group moves, separate from permissions
   - Configurable per group in Settings → Sync permissions section (independent of Frozen/Restricted semantic toggles in v1)
   - Migration `p8q9r0s1t2u3`

### Explicitly rejected / deferred

- **forceSync API override** — rejected; flags are sole gate (2026-07-15).
- **Auto-linking Frozen/Restricted semantic toggles to permission presets** — deferred (2026-07-15).
- **Tying auto-sync to permission flags** — rejected; still `regularSyncEnabled` / `dynamicSyncEnabled` (2026-07-15).
- **Auto-scheduled periodic recheck of Restricted channels** — deferred (2026-07-15).
- Per-channel overrides for setting-group fields, prompt batching for Tag, auto-tagging scheduler, Bot API fallback for unavailable web views.

## User preferences

- Self-hosted single operator; discuss trade-offs before big architectural bets.
- **Ask clarifying questions** for scheduling/product decisions (used for sync permission flag design, 2026-07-15).
- **Only commit when explicitly asked**; verify locally before push to main (2026-07-15 staging flow).
- **Frontend bug fixes** — verify with Playwright when non-trivial; unit tests for pure logic.
- **Bulk APIs for scale** — 2000+ channels.
- **Large refactors** — parallel sub-agents with disjoint file ownership; stable public APIs.
- **Signed commits** — 1Password SSH signing; unlock and retry if `op-ssh-sign` fails.

## Environment & fixes

- **Native dev:** `uv sync` → `alembic upgrade head` → uvicorn :8000; `bun run dev` :5173. **`POSTGRES_DB=app`**.
- **Alembic head:** `p8q9r0s1t2u3` — four sync permission columns on `tg_channel_setting_groups`. Run `alembic upgrade head` before relying on permission flags.
- **Pre-commit (prek):** `cd backend && uv run prek install -f`. Hooks: ruff, mypy, **ty**, biome, typos. `StartSyncJobRequest.resolved_sync_mode` property for mypy narrowing (2026-07-15).
- **Local checks:** `bun run test:unit` (~310 pass), `tsc`, `cd backend && uv run pytest tests/`.
- **CI test fixes (2026-07-15):** sync permission integration tests must `_wait_for_job()` before teardown TRUNCATE (deadlock); `test_sync_job_persists_to_postgres` must `_wait_for_persisted_job_row()` after API shows completed (race on async persist).
- **Local-only failure:** `test_ai_embeddings` in smoke fails with real `GEMINI_API_KEY` when Gemini geo-blocked — env-specific, CI passes.
- **GPG/SSH signing:** unlock 1Password if signing fails.

## Caveats

- **Never commit `.env`** or API keys.
- **Single scheduler instance** — no multi-replica without coordination.
- **Setting group edits** propagate to all member channels.
- **Virtual `group:` tags** — display-only.
- **Sync permission flags** — `!== false` default-true semantics on channels; bulk reset needs both bulk + reset flags.
- **Restricted recheck** — card shows "Recheck" label; reset stays disabled when `resetSyncEnabled=false`; promotion to default on success does not rename channel.
- **`telegramChatId`** — only from message widgets; unavailable channels stay null until scrape with posts.

## Out of scope / roadmap

- Auto-scheduled periodic recheck of Restricted channels.
- Auto-linking Frozen/Restricted semantic toggles to permission presets.
- Telegram chat ID v1.1 (rename cascade, Bot API fallback).
- Auto-tagging scheduler, mobile summarizer.
- CI hardening: pre-commit on push to main, deploy `needs:` test jobs.
