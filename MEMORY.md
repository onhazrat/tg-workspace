# TG Summarizer — Project Memory

> Last synced: 2026-07-18

## Purpose

Self-hosted Telegram channel summarizer. Migrated from browser-heavy `TG-Summarizer/` (React + Express + IndexedDB) to a **FastAPI + React monorepo** with scraping, scheduling, AI, and PostgreSQL on the server. **Migration Phases 0–7 complete (2026-06-08).** Major features since: dynamic channel sync, Tag tab, post media, Discover tab (+ bulk follow), channel setting groups + UX v2, telegram chat ID, frontend god-component refactor (PR #6), sync permission flags v2, **TG UI primitives standardization (2026-07-18, `148a56c` on main)** — [tg_ui_primitives plan](.cursor/plans/tg_ui_primitives_a165813d.plan.md). Run commands: [README.md](README.md), [development.md](development.md).

## Architecture

- **`backend/`** — FastAPI (`app/main.py`), SQLModel (`app/models_tg.py`), Alembic, services (`scraper.py`, `sync_orchestrator.py`, **`sync_schedule.py`**, `channels.py`, **`followed_channels.py`**, **`bulk_follow.py`**, **`channel_setting_groups.py`**, **`channel_tags.py`**, **`tag_runs.py`**, **`post_media_parser.py`**, **`post_thumbnails.py`**, **`telegram_html.py`**, …), APScheduler jobs, pluggable AI (`app/ai/`, Gemini first). Prompts in `backend/app/prompts/`.
- **`frontend/`** — React 19 + Vite + TanStack Router/Query; dual-route UI:
  - **`/_tg/summarizer`** — full-screen TG app (`App.tsx` + `TgProviders`); **command palette** on `main`. Main content uses **`app-shell`** width utility.
  - **`/_layout/*`** — template admin shell (`/`, `/items`, `/admin`, `/settings`).
- **Providers (TG shell):** `Settings → Data → UI → Scraper → Chat → AI → Tag` in [`TgProviders.tsx`](frontend/src/components/TgProviders.tsx).
- **TG UI primitives (2026-07-18):** TG-token components under [`frontend/src/components/ui/tg-*.tsx`](frontend/src/components/ui/) — **not** shadcn admin `Button`/`Input`/`LoadingButton`. Catalog + loading/`tg-ui-allow` policy: [`frontend/docs/tg-ui.md`](frontend/docs/tg-ui.md). Includes `TgButton` (`successSoft` / `infoSoft` / `link`, `loading` + optional `loadingLabel`), `TgConfirmDialog`, `TgInput`/`TgTextarea`/`TgFieldLabel`/`TgHelpText`, `TgIconButton` (+ optional tooltip), `TgSettingsSection` (`subtitle`/`actions`), `TgToggle`, `tg-select-trigger`, `TgSelectionChip` / `TgMetaChip` / `TgFilterChip`, `TgSegmentedControl` (`dense` for Appearance theme), `TgHeroEmptyState`. Existing: `tg-tooltip`, `tg-sonner`. Keep `LogEmptyState` for log tabs.
- **Component decomposition (2026-07-13, PR #6):** `SettingsView`, `LogsView`, `ChannelGrid`, `CommandPalette` split into focused subcomponent dirs + tested `lib/` logic.
- **Settings state (schema-driven):** `SettingsContext` over zod schema — [`lib/settings/schema.ts`](frontend/src/lib/settings/schema.ts). **New settings go in the schema, not new `useState`.**
- **Server state (TanStack Query):** `DataContext` + [`queryKeys.ts`](frontend/src/hooks/queryKeys.ts); cache write-throughs via [`applySetStateAction.ts`](frontend/src/lib/applySetStateAction.ts).
- **Command palette:** `frontend/src/lib/commands/` — registry, settings-schema, channel ops, group / telegram-chat-id / recheck-restricted actions. Palette confirm keeps panel + keyboard chrome; footer uses `TgButton` only (not Radix confirm dialog).
- **Post view pipeline:** [`post-view.ts`](frontend/src/lib/posts/post-view.ts); **`filteredPosts` is canonical** for Posts, Summary, Chat, Tag, Discover.
- **Discover bulk follow:** web-view links; multi-select; **`TgConfirmDialog` when ≥5** (no `window.confirm`); bulk API + chained sync (`sync_mode=bulk`).
- **Setting groups / sync permissions:** strict inheritance; four flags on groups; frontend [`sync-permissions.ts`](frontend/src/lib/channels/sync-permissions.ts). Jobs `POST /jobs/sync` **`syncMode`**: `sync_all` | `bulk` | `individual` | `recheck_restricted` | `auto`.
- **uv** + **bun**. Unit: `bun run test:unit` (~348). Left-behind UI gate: **`bun run test:tg-ui`** ([`scripts/check-tg-ui-duplicates.sh`](frontend/scripts/check-tg-ui-duplicates.sh), hard-fail in CI). Playwright: [`frontend/tests/`](frontend/tests/) incl. [`tg-ui-primitives.spec.ts`](frontend/tests/tg-ui-primitives.spec.ts).
- **CI/CD:** GitHub-hosted tests on push; self-hosted deploy — [deployment.md](deployment.md). Migrations on deploy: `prestart` → `alembic upgrade head`.

### Key API surfaces

- Versioned: `/api/v1/telegram/*`, `/network/*`, `/ai/*`, `/data/*`, `/rag/*`, `/jobs/*`
- **Channel sync:** `POST /jobs/sync` with optional `channelIds` + **`syncMode`** → SSE events.
- **Bulk follow:** `POST/GET/SSE/cancel` on `/data/channels/bulk-follow` — fire-and-forget; success chains sync (`sync_mode=bulk`) as `syncJobId`.
- **Channels / setting groups:** CRUD + bulk sync-settings, tags, setting-group; groups include four sync permission fields.
- OpenAPI: `/docs`, `/api/v1/openapi.json`

## Data pipelines

- **Authoritative store:** PostgreSQL; IndexedDB read-through cache ([ADR-003](docs/migration/ADR-003-hybrid-sync.md)).
- **Scrape/sync:** `initial` / `incremental` / `backfill`. **Partial history** = `historyCompleteToCutoff === false`.
- **Per-channel auto-sync:** `regularSyncEnabled` / `dynamicSyncEnabled` — **not** gated by sync permission flags.
- **Setting groups:** built-ins `default`, Slow feed, High velocity, Frozen, Restricted (+ custom). Strict inheritance including sync permissions.
- **Unavailable web view:** Restricted group (`isUnavailableOnWebView`); successful recheck/metadata → auto-promote to **default**.
- **Jobs:** `auto_sync`, `embeddings`, `auto_summary`, `retention`, `translation_batch`.
- **Post media:** `tg_posts.media` JSON; thumbs under `data/post-thumbs`.

## Analysis conventions

- **Channel identity:** `channel_id` / `name` primary; **`telegramChatId`** supplementary. API camelCase. Timestamps: ms epoch.
- **Summarizer UI:** 8 tabs — channels, posts, summary, tag, discover, chat, history, settings.
- **Channels selection:** all channels selectable (incl. frozen/restricted); independent of group semantics.
- **Sync permission matrix (inherited):**

| Operation | Flag(s) |
|---|---|
| Sync All | `includeInSyncAll` |
| Sync Selected, Fix Partial History, palette Recheck Restricted | `includeInBulkSync` |
| Card Sync / palette Sync Channel | `allowIndividualSync` |
| Reset & Sync | `resetSyncEnabled` |
| Bulk Reset All / Fix Partial (reset half) | `includeInBulkSync` **and** `resetSyncEnabled` |

- **Presets:** Restricted = sync-all off, bulk+individual on, reset off. Frozen = sync-all+bulk off, individual+reset on. Others = all on.
- **UI when denied:** disable + tooltip citing group + flag. Card Recheck label when restricted.
- **Command palette:** `Cmd+Shift+P`; group filter via `channelGroup` URL param.
- **Group filter chip order:** default → Slow feed → High velocity → Frozen → Restricted → custom.

## Decisions (stable)

1. **Single-operator (Mode A)** — [DECISIONS.md](docs/migration/DECISIONS.md).
2. **Data** — Postgres authoritative; IndexedDB cache; API-first writes.
3. **Channel setting groups v1** — strict inheritance; no per-channel overrides for inherited fields.
4. **Channel telegram chat ID v1** — username primary; server-managed ID; mismatch → Frozen.
5. **Frontend refactor (PR #6)** — god-component split; schema-driven settings; TanStack Query.
6. **Sync permission flags v2** — four inherited booleans; no `forceSync`; `isFrozen` / `isUnavailableOnWebView` remain semantic; migration `p8q9r0s1t2u3`.
7. **TG UI primitives (2026-07-18)** — TG-native `app-ink` / mono / uppercase language; do **not** force-migrate TG onto admin/shadcn controls. Prefer shared primitives over screen-level extractions. Discover/Logs confirms use `TgConfirmDialog` (`window.confirm` = 0 in components). **SyncSection inline confirm stays inline** (TgButton only). MigrationPrompt / palette confirm shell not restyled onto `TgConfirmDialog`. Justified one-offs use `tg-ui-allow` + CI allowlist. Adjacent polish (2026-07-18): soft/link button variants, dense segmented, `TgToggle` / select-trigger move, help-text + loading audit, docs in `frontend/docs/tg-ui.md`.

### Explicitly rejected / deferred

- **forceSync API override**; tying auto-sync to permission flags — rejected.
- Auto-linking Frozen/Restricted toggles to permission presets; auto-scheduled Restricted recheck — deferred.
- Forcing TG onto shadcn Button/Input/Card; further toast/sonner wrappers; componentizing ChannelCard body, PostFeed layout, command-palette chrome — rejected for UI primitives work.
- Per-channel setting-group overrides, Tag prompt batching, auto-tagging scheduler, Bot API fallback for unavailable web views.

## User preferences

- Self-hosted single operator; discuss trade-offs before big architectural bets.
- **Ask clarifying questions** for scheduling/product decisions (options + recommended).
- **Only commit when explicitly asked**; verify locally before push to main (staging via push-to-main).
- **Frontend** — Playwright for non-trivial UI; unit tests for pure logic; colocated `*.test.tsx`.
- **Bulk APIs** for 2000+ channels; large refactors via parallel sub-agents with disjoint ownership.
- **Signed commits** — 1Password SSH signing; unlock and retry if `op-ssh-sign` fails.

## Environment & fixes

- **Native dev:** `uv sync` → `alembic upgrade head` → uvicorn :8000; `bun run dev` :5173. **`POSTGRES_DB=app`**.
- **Alembic head:** `p8q9r0s1t2u3` — sync permission columns on `tg_channel_setting_groups`.
- **Pre-commit (prek):** `cd backend && uv run prek install -f`. Hooks: ruff, mypy, **ty**, biome, typos.
- **Local checks:** `bun run test:unit` (~348), **`bun run test:tg-ui`**, `tsc`, `cd backend && uv run pytest tests/`.
- **Playwright:** prefer `PLAYWRIGHT_CHANNEL=chrome` if bundled Chromium download fails; auth via `frontend/tests/auth.setup.ts`.
- **CI (2026-07-15):** sync permission tests must `_wait_for_job()` before teardown; sync persist test must `_wait_for_persisted_job_row()`.
- **UI primitives follow-ups (2026-07-18):** `tg-tooltip` `asChild` must preserve child `data-slot` (e.g. `tg-button`); `useLazyTabData` prefetch for publish/sync logs needs real `queryFn`s — missing ones were treated as 401 and cleared session.
- **Local-only:** `test_ai_embeddings` smoke can fail when Gemini geo-blocked — CI passes.
- **GPG/SSH signing:** unlock 1Password if signing fails.

## Caveats

- **Never commit `.env`** or API keys.
- **Single scheduler instance** — no multi-replica without coordination.
- Setting group edits propagate to all members; virtual `group:` tags are display-only.
- Sync permission flags — `!== false` default-true on channels; bulk reset needs both bulk + reset.
- Restricted recheck — reset stays disabled when `resetSyncEnabled=false`; promotion does not rename channel.
- **`telegramChatId`** — only from message widgets; unavailable channels stay null until scrape with posts.
- **TG UI left-behind greps** — do not reintroduce orphan class recipes; use primitives or documented `tg-ui-allow` one-offs.

## Out of scope / roadmap

- Auto-scheduled periodic recheck of Restricted channels.
- Auto-linking Frozen/Restricted semantic toggles to permission presets.
- Telegram chat ID v1.1 (rename cascade, Bot API fallback).
- Auto-tagging scheduler, mobile summarizer.
- CI hardening: pre-commit on push to main, deploy `needs:` test jobs.
- Admin `/_layout` migration onto TG primitives (intentionally separate).

## Session log

- **2026-07-18** — TG UI adjacent polish: closed prior `tg-ui-allow` gaps via `successSoft`/`infoSoft`/`link` + dense segmented + `TgSettingsSection` extensions; moved `TgToggle` / select-trigger into `ui/`; help-text + async loading audit; Playwright/a11y depth; catalog at `frontend/docs/tg-ui.md`.
- **2026-07-18** — TG UI primitives shipped to `main` (`148a56c`) for staging; plan committed under `.cursor/plans/tg_ui_primitives_a165813d.plan.md`.
