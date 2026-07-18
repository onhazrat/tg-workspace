# TG Summarizer — Project Memory

> Last synced: 2026-07-18

## Purpose

Self-hosted Telegram channel summarizer. Migrated from browser-heavy `TG-Summarizer/` (React + Express + IndexedDB) to a **FastAPI + React monorepo** with scraping, scheduling, AI, and PostgreSQL on the server. **Migration Phases 0–7 complete (2026-06-08).** Major features since: dynamic channel sync, Tag tab, post media, Discover tab (+ bulk follow), channel setting groups + UX v2, telegram chat ID, frontend god-component refactor (PR #6), sync permission flags v2, **TG UI primitives (`148a56c`) + adjacent polish (`b27e5c8`) on main (2026-07-18)** — [tg_ui_primitives](.cursor/plans/tg_ui_primitives_a165813d.plan.md), [tg_ui_polish](.cursor/plans/tg_ui_polish_11c8be27.plan.md). Catalog: [`frontend/docs/tg-ui.md`](frontend/docs/tg-ui.md). Run: [README.md](README.md), [development.md](development.md).

## Architecture

- **`backend/`** — FastAPI (`app/main.py`), SQLModel (`app/models_tg.py`), Alembic, services (`scraper.py`, `sync_orchestrator.py`, **`sync_schedule.py`**, `channels.py`, **`followed_channels.py`**, **`bulk_follow.py`**, **`channel_setting_groups.py`**, **`channel_tags.py`**, **`tag_runs.py`**, **`post_media_parser.py`**, **`post_thumbnails.py`**, **`telegram_html.py`**, …), APScheduler jobs, pluggable AI (`app/ai/`, Gemini first). Prompts in `backend/app/prompts/`.
- **`frontend/`** — React 19 + Vite + TanStack Router/Query; dual-route UI:
  - **`/_tg/summarizer`** — full-screen TG app (`App.tsx` + `TgProviders`); **command palette** on `main`. Main content uses **`app-shell`** width utility.
  - **`/_layout/*`** — template admin shell (`/`, `/items`, `/admin`, `/settings`).
- **Providers (TG shell):** `Settings → Data → UI → Scraper → Chat → AI → Tag` in [`TgProviders.tsx`](frontend/src/components/TgProviders.tsx).
- **TG UI primitives:** TG-token components under [`frontend/src/components/ui/tg-*.tsx`](frontend/src/components/ui/) — **not** shadcn admin `Button`/`Input`/`LoadingButton`. Full catalog + loading/`tg-ui-allow` policy: [`frontend/docs/tg-ui.md`](frontend/docs/tg-ui.md). Key pieces: `TgButton` (`primary`/`secondary`/`ghost`/`danger`/`dangerSoft`/`successSoft`/`infoSoft`/`link` + `loading`/`loadingLabel`), `TgConfirmDialog`, `TgInput`/`TgTextarea`/`TgFieldLabel`/`TgHelpText`, `TgIconButton`, `TgSettingsSection` (`subtitle`/`actions`/`headerExtra`), `TgToggle` ([`ui/tg-toggle.tsx`](frontend/src/components/ui/tg-toggle.tsx); settings `ToggleSwitch` re-exports), `selectTriggerClassName` ([`ui/tg-select-trigger.ts`](frontend/src/components/ui/tg-select-trigger.ts)), chips, `TgSegmentedControl` (`sm`/`md`/`dense`), `TgHeroEmptyState`. Keep `LogEmptyState` for log tabs. Existing: `tg-tooltip`, `tg-sonner`.
- **Component decomposition (PR #6):** Settings/Logs/ChannelGrid/CommandPalette split + tested `lib/` logic.
- **Settings state:** zod schema — [`lib/settings/schema.ts`](frontend/src/lib/settings/schema.ts). **New settings go in the schema, not new `useState`.**
- **Server state:** TanStack Query via `DataContext` + [`queryKeys.ts`](frontend/src/hooks/queryKeys.ts); [`applySetStateAction.ts`](frontend/src/lib/applySetStateAction.ts).
- **Command palette:** `frontend/src/lib/commands/`. Confirm keeps panel + keyboard chrome; footer = `TgButton` only.
- **Post view:** [`post-view.ts`](frontend/src/lib/posts/post-view.ts); **`filteredPosts` canonical** for Posts/Summary/Chat/Tag/Discover.
- **Discover bulk follow:** `TgConfirmDialog` when ≥5 (no `window.confirm`); bulk API + chained sync (`sync_mode=bulk`).
- **Setting groups / sync permissions:** strict inheritance; four flags; [`sync-permissions.ts`](frontend/src/lib/channels/sync-permissions.ts). Jobs `syncMode`: `sync_all` | `bulk` | `individual` | `recheck_restricted` | `auto`.
- **uv** + **bun**. Unit: `bun run test:unit` (~353). Left-behind gate: **`bun run test:tg-ui`** (hard-fail in CI). Playwright: [`tg-ui-primitives.spec.ts`](frontend/tests/tg-ui-primitives.spec.ts) (+ summarizer flows).
- **CI/CD:** tests on push; self-hosted deploy — [deployment.md](deployment.md). Migrations: `prestart` → `alembic upgrade head`.

### Key API surfaces

- Versioned: `/api/v1/telegram/*`, `/network/*`, `/ai/*`, `/data/*`, `/rag/*`, `/jobs/*`
- **Channel sync:** `POST /jobs/sync` + optional `channelIds` + **`syncMode`** → SSE.
- **Bulk follow:** `/data/channels/bulk-follow` — fire-and-forget; success chains sync (`sync_mode=bulk`) as `syncJobId`.
- **Channels / setting groups:** CRUD + bulk tags/sync-settings/setting-group; groups include four sync permission fields.
- OpenAPI: `/docs`, `/api/v1/openapi.json`

## Data pipelines

- **Authoritative store:** PostgreSQL; IndexedDB read-through ([ADR-003](docs/migration/ADR-003-hybrid-sync.md)).
- **Scrape/sync:** `initial` / `incremental` / `backfill`. Partial history = `historyCompleteToCutoff === false`.
- **Auto-sync:** `regularSyncEnabled` / `dynamicSyncEnabled` — **not** gated by sync permission flags.
- **Setting groups:** default, Slow feed, High velocity, Frozen, Restricted (+ custom); strict inheritance.
- **Unavailable web view:** Restricted (`isUnavailableOnWebView`); successful recheck/metadata → auto-promote to **default**.
- **Jobs:** `auto_sync`, `embeddings`, `auto_summary`, `retention`, `translation_batch`.
- **Post media:** `tg_posts.media` JSON; thumbs under `data/post-thumbs`.

## Analysis conventions

- **Channel identity:** `channel_id` / `name` primary; **`telegramChatId`** supplementary. API camelCase. Timestamps: ms epoch.
- **Summarizer UI:** 8 tabs — channels, posts, summary, tag, discover, chat, history, settings.
- **Channels selection:** all selectable (incl. frozen/restricted); independent of group semantics.
- **Sync permission matrix (inherited):**

| Operation | Flag(s) |
|---|---|
| Sync All | `includeInSyncAll` |
| Sync Selected, Fix Partial History, palette Recheck Restricted | `includeInBulkSync` |
| Card Sync / palette Sync Channel | `allowIndividualSync` |
| Reset & Sync | `resetSyncEnabled` |
| Bulk Reset All / Fix Partial (reset half) | `includeInBulkSync` **and** `resetSyncEnabled` |

- **Presets:** Restricted = sync-all off, bulk+individual on, reset off. Frozen = sync-all+bulk off, individual+reset on. Others = all on.
- **UI when denied:** disable + tooltip (group + flag). Card shows Recheck when restricted.
- **Command palette:** `Cmd+Shift+P`; `channelGroup` URL param.
- **Group filter chip order:** default → Slow feed → High velocity → Frozen → Restricted → custom.

## Decisions (stable)

1. **Single-operator (Mode A)** — [DECISIONS.md](docs/migration/DECISIONS.md).
2. **Data** — Postgres authoritative; IndexedDB cache; API-first writes.
3. **Channel setting groups v1** — strict inheritance; no per-channel overrides for inherited fields.
4. **Channel telegram chat ID v1** — username primary; server-managed ID; mismatch → Frozen.
5. **Frontend refactor (PR #6)** — god-component split; schema-driven settings; TanStack Query.
6. **Sync permission flags v2** — four inherited booleans; no `forceSync`; `isFrozen` / `isUnavailableOnWebView` remain semantic; migration `p8q9r0s1t2u3`.
7. **TG UI primitives + polish (2026-07-18)** — TG-native `app-ink`/mono/uppercase; do **not** force TG onto admin/shadcn. Prefer shared primitives over screen extractions. Confirms = `TgConfirmDialog` (`window.confirm` = 0). **SyncSection inline confirm stays inline.** Palette/MigrationPrompt not restyled onto confirm dialog. Soft/link button variants + dense segmented close prior allow gaps (`tg-ui-allow` count for those gaps = **0**). Justified future one-offs need `// tg-ui-allow:` + CI skip. See [`frontend/docs/tg-ui.md`](frontend/docs/tg-ui.md).

### Explicitly rejected / deferred

- **forceSync**; tying auto-sync to permission flags — rejected.
- Auto-linking Frozen/Restricted toggles to permission presets; auto-scheduled Restricted recheck — deferred.
- Forcing TG onto shadcn Button/Input/Card; toast rewraps; ChannelCard body / PostFeed / command-palette chrome extractions — rejected.
- Still deferred as raw UX (documented in `tg-ui.md`): SettingsHub nav, LogFilterBar density filters, Chat mode toggles, ChannelCard checkbox / dashed Add Tag.
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
- **Local checks:** `bun run test:unit` (~353), **`bun run test:tg-ui`**, `tsc`, `cd backend && uv run pytest tests/`.
- **Playwright:** prefer `PLAYWRIGHT_CHANNEL=chrome` if bundled Chromium download fails; auth via `frontend/tests/auth.setup.ts`.
- **CI:** sync permission tests must `_wait_for_job()` before teardown; sync persist test must `_wait_for_persisted_job_row()`.
- **UI footguns (2026-07-18):** `tg-tooltip` `asChild` must preserve child `data-slot`; `useLazyTabData` prefetch for publish/sync logs needs real `queryFn`s (missing → false 401 / session clear).
- **Local-only:** `test_ai_embeddings` smoke can fail when Gemini geo-blocked — CI passes.
- **GPG/SSH signing:** unlock 1Password if signing fails.

## Caveats

- **Never commit `.env`** or API keys.
- **Single scheduler instance** — no multi-replica without coordination.
- Setting group edits propagate to all members; virtual `group:` tags are display-only.
- Sync permission flags — `!== false` default-true on channels; bulk reset needs both bulk + reset.
- Restricted recheck — reset stays disabled when `resetSyncEnabled=false`; promotion does not rename channel.
- **`telegramChatId`** — only from message widgets; unavailable channels stay null until scrape with posts.
- **TG UI** — do not reintroduce orphan class recipes; prefer extending primitives over `tg-ui-allow`.

## Out of scope / roadmap

- Auto-scheduled periodic recheck of Restricted channels.
- Auto-linking Frozen/Restricted semantic toggles to permission presets.
- Telegram chat ID v1.1 (rename cascade, Bot API fallback).
- Auto-tagging scheduler, mobile summarizer.
- CI hardening: pre-commit on push to main, deploy `needs:` test jobs.
- Admin `/_layout` migration onto TG primitives (intentionally separate).

## Session log

- **2026-07-18** — Primitives `148a56c` + polish `b27e5c8` on `main` (plans + `frontend/docs/tg-ui.md` committed). Staging smoke via deploy pipeline.
