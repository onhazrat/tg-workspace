# TG Summarizer — Project Memory

> Last synced: 2026-07-02

## Purpose

Self-hosted Telegram channel summarizer. Migrated from browser-heavy `TG-Summarizer/` (React + Express + IndexedDB) to a **FastAPI + React monorepo** with scraping, scheduling, AI, and PostgreSQL on the server. **Migration Phases 0–7 complete (2026-06-08).** **Dynamic channel sync v1 (2026-07-01)** — [dynamic_channel_sync plan](.cursor/plans/dynamic_channel_sync_77e7db50.plan.md). **Tag tab v1 (2026-07-02)** — AI-assisted channel tagging with persisted tag-run history — [tag_tab_v1 plan](.cursor/plans/tag_tab_v1_cea80474.plan.md). Run commands: [README.md](README.md), [development.md](development.md).

## Architecture

- **`backend/`** — FastAPI (`app/main.py`), SQLModel (`app/models_tg.py`), Alembic, services (`scraper.py`, `sync_orchestrator.py`, **`sync_schedule.py`**, `channels.py`, **`channel_tags.py`**, **`tag_runs.py`**, …), APScheduler jobs, pluggable AI (`app/ai/`, Gemini first). Prompts in `backend/app/prompts/` (`templates.py`, `summary.py`, **`tagging.py`**).
- **`frontend/`** — React 19 + Vite + TanStack Router/Query; dual-route UI:
  - **`/_tg/summarizer`** — full-screen TG app (`App.tsx` + `TgProviders`); **command palette** on `main`. Main content uses **`app-shell`** width utility.
  - **`/_layout/*`** — template admin shell (`/`, `/items`, `/admin`, `/settings`).
- **Providers (TG shell):** `Settings → Data → UI → Scraper → Chat → AI → Tag` in [`TgProviders.tsx`](frontend/src/components/TgProviders.tsx).
- **Command palette:** `frontend/src/lib/commands/` — registry, settings-schema, channel ops, data transfer.
- **Post view pipeline:** [`frontend/src/lib/posts/post-view.ts`](frontend/src/lib/posts/post-view.ts) — `buildFilteredPostsFromRaw`, `formatPostsForPrompt`. **`filteredPosts` is canonical** for Posts UI, Summary, Chat, and Tag prompts.
- **Channel tag model:** [`frontend/src/lib/channels/channel-tag-model.ts`](frontend/src/lib/channels/channel-tag-model.ts) + mirror [`backend/app/services/channel_tags.py`](backend/app/services/channel_tags.py). Legacy `string[]` tags normalize to `{ name, source, assignedAt }`.
- **Tag apply flow:** [`apply-tag-suggestions.ts`](frontend/src/lib/channels/apply-tag-suggestions.ts) — name normalization (`@`, displayName), add/remove via `mergeAiTags` / `removeAiTags`; bulk persist via **`PATCH /channels/bulk-tags`** (not sequential `upsertChannel`).
- **Prompt channel context:** [`format-channels-for-prompt.ts`](frontend/src/lib/channels/format-channels-for-prompt.ts) — builds `{channels}` block; toggles in `UIContext` + checkboxes on **ChannelGrid**.
- **Tag prompt builder:** [`tag-prompt.ts`](frontend/src/lib/channels/tag-prompt.ts), parser [`parse-tag-response.ts`](frontend/src/lib/channels/parse-tag-response.ts).
- **Channel tag utilities:** [`channel-tags.ts`](frontend/src/lib/channels/channel-tags.ts) — `collectAllChannelTags` (alphabetical, for prompts/palette), `sortTagsForChannelGrid` (Channels tab tag bar order), tag filter/select helpers.
- **Tag UI:** `TagContext`, `TagConfig`, `TagView`, `PasteTagsModal` — mirror Summary copy/generate/paste pattern.
- **API clients (ADR-006):** hand-written `frontend/src/api/` (summarizer); generated `frontend/src/client/` (admin/auth).
- **Data layer (frontend):** `repository.ts` API-first → `cache.ts` (IndexedDB).
- **uv** + **bun**. **Playwright E2E** in `frontend/tests/summarizer.spec.ts` (~100+ tests).
- **CI/CD:** GitHub-hosted tests on push; self-hosted deploy — [deployment.md](deployment.md). **Migrations on deploy:** `prestart` → `alembic upgrade head`.

### Key API surfaces

- Versioned: `/api/v1/telegram/*`, `/network/*`, `/ai/*`, `/data/*`, `/rag/*`, `/jobs/*`
- **AI summary:** `POST /ai/summary`, `/summary/stream`, `/summary/prompt` — accept **`channelsText`** (formatted channel block); fallback `channels` join.
- **AI tag:** `POST /ai/tag/prompt`, `/tag/stream` — `channelsText`, `postsText`, **`allTags`**, **`tagMode`** (`add`|`remove`).
- **AI chat:** `/chat/stream` — accepts `channelsText`.
- **Channels:** `GET/PUT/DELETE /data/channels/{id}`; **`PATCH /data/channels/bulk-sync-settings`**; **`PATCH /data/channels/bulk-tags`** (batch tag writes, single transaction).
- **Tag runs:** `GET/PUT/DELETE /data/tag-runs/{id}` — persisted tag workflow history (`tg_tag_runs`).
- **Channel sync:** `POST /jobs/sync` → SSE events.
- OpenAPI: `/docs`, `/api/v1/openapi.json`

## Data pipelines

- **Authoritative store:** PostgreSQL; IndexedDB read-through cache ([ADR-003](docs/migration/ADR-003-hybrid-sync.md)).
- **Scrape/sync:** `sync_orchestrator.py`; passes: `initial` / `incremental` / `backfill`. **Partial history** = `historyCompleteToCutoff === false`.
- **Per-channel auto-sync (v1):** Channel fields source of truth — `regularSyncEnabled`, `dynamicSyncEnabled`, `nextRegularSyncAt`, `nextDynamicSyncAt`. See [dynamic_channel_sync plan](.cursor/plans/dynamic_channel_sync_77e7db50.plan.md).
- **Channel tags:** JSON on `tg_channels.tags` — structured objects; no separate category field. Import/export normalizes via `channel_tags` service.
- **Tag runs:** `tg_tag_runs` — pending/completed runs with `promptText`, `responseText`, `suggestions`, `applyResult`, `mode`, `channelContextOptions`.
- **Jobs:** `auto_sync`, `embeddings`, `auto_summary`, `retention`, `translation_batch`.

## Analysis conventions

- **Channel identity:** `channel_id` / `name`; API camelCase. **Timestamps:** ms epoch.
- **Summarizer UI:** URL tabs `/summarizer?tab=` — **7 workspace tabs:** channels, posts, summary, **tag**, chat, history, settings. Settings sub-sections: `?tab=settings&section=`.
- **Tab routing pitfall:** `tab` must appear in **both** [`useSummarizerTab.ts`](frontend/src/hooks/useSummarizerTab.ts) **and** route `VALID_TABS` in [`summarizer.tsx`](frontend/src/routes/_tg/summarizer.tsx) — route `validateSearch` runs first; missing entry silently falls back to `summary`.
- **Posts tab filters:** `postFilter_*` in localStorage; `filteredPosts` canonical for all AI tabs.
- **Channel prompt context (Channels tab):** checkboxes *Include channel bio in prompts* / *Include current tags in prompts* → `prompt_includeChannelBio`, `prompt_includeChannelTags` in localStorage via `UIContext`. Affects Summary, Chat, and Tag `{channels}` blocks.
- **Tag tab scope:** **selected channels** + **filteredPosts** (same as Summary). User controls count via Channels tab selection — **no prompt batching UI** (removed misleading batch counter).
- **Tag modes:** **Add** (merge AI tags, `source: "ai"`) or **Remove** (subtract listed tags only). Apply uses **all parsed channels** matching selection; normalizes `@username` / display names.
- **Tag taxonomy:** embedded in `TAG_PROMPT` template; `{all_tags}` lists existing vocabulary across all operator channels.
- **External AI flows:** Copy Prompt → pending run → paste back (`PasteSummaryModal` / `PasteTagsModal`). Primary for ad-hoc tagging at scale.
- **Command palette:** `Cmd+Shift+P`; tag ops via `channel-tags.ts` + `filter-channels.ts` (`tag:` / `#` prefix).
- **Channels tab tag bar:** top of Channels tab — inline chip row in `ChannelGrid` (comment: *Tags & Auto Sync row*); `allTags` memo. Click toggles selection for all non-frozen channels with that tag; shows `(selected/total)`. Sorted by `sortTagsForChannelGrid`: **fully selected → partial → none**; within each group **channel count desc**, then **selected count desc** (re-sorts when selection changes). Not the same sort as `collectAllChannelTags` (alphabetical, used for `{all_tags}` and palette).

## Decisions (stable)

1. **Single-operator (Mode A)** — see [DECISIONS.md](docs/migration/DECISIONS.md).
2. **Data** — Postgres authoritative; IndexedDB cache; API-first writes.
3. **Dynamic channel sync v1 (2026-07-01)** — per-channel deadlines; global settings seed new channels only.
4. **Post view filters (2026-06-30)** — shared `post-view.ts`; `filteredPosts` canonical.
5. **Tag tab v1 (2026-07-02)** — structured tags with `source` + `assignedAt`; Tag run history in dedicated `tg_tag_runs` table; add/remove modes; bulk tag apply API for 100+ channels; channel prompt context checkboxes shared across AI tabs; **no auto-tagging scheduler**.
6. **Channels tab tag bar sort (2026-07-02)** — selection-state grouping (fully / partial / none) with usage-based ordering inside each group; implemented in `sortTagsForChannelGrid` with unit tests.

### Explicitly rejected / deferred

- Mode B, Celery/Redis, pgvector, mobile responsive summarizer.
- **Prompt batching for Tag tab** — rejected (user selects channels explicitly; one prompt for full selection).
- **Auto-tagging background job** — deferred; Tag tab is manual/copy-paste/in-app generate only.
- **Configurable taxonomy in Settings** — deferred (hardcoded in prompt for v1).
- **Storing prompt checkbox prefs in DB** — deferred (localStorage only; auto-summary job still uses names-only fallback).
- Dynamic sync v1.1, Open Graph share links — see prior plans.

## User preferences

- Self-hosted single operator; discuss trade-offs before big architectural bets.
- **Ask clarifying questions** for scheduling/product decisions.
- **Only commit when explicitly asked**; plan files updated when user requests.
- **Frontend bug fixes** — verify with Playwright; add regression test when non-trivial.
- **Prefer simpler flows** — Copy Prompt + paste over heavy wizards.
- **Bulk APIs for scale** — 2000+ channels; avoid N sequential HTTP round-trips.

## Environment & fixes

- **Native dev:** `uv sync` → `alembic upgrade head` → uvicorn :8000; `bun run dev` :5173. **`POSTGRES_DB=app`**.
- **Alembic head (2026-07-02):** `j2k3l4m5n6o7` — `tg_tag_runs` table (after `h1i2j3k4l5m6` dynamic sync).
- **Pre-commit:** `uv run prek run --all-files`; `bun run lint` (Biome). **Avoid running global lint autofix** when scoping changes — it can reformat unrelated files.
- **Playwright local (Cursor sandbox):** bundled Chromium install may hang; use **`PLAYWRIGHT_CHANNEL=chrome`** or Docker (`docker compose run --rm playwright …`). Requires backend on :8000 + `alembic upgrade head`.
- **Playwright CI:** `.github/workflows/playwright.yml` — **push to main always runs tests** (paths-filter bypass on push; PRs still filtered). Prior failure was git fetch in paths-filter, not test logic.
- **E2E tag tests:** `channelHasTag` must handle structured tag objects `{ name }`, not only `string[]`.
- **GPG signing:** 1Password agent may fail in agent environments; `--no-gpg-sign` fallback if needed.

## Caveats

- **Never commit `.env`** or API keys.
- **Single scheduler instance** — no multi-replica without coordination.
- **Tag Apply** — frontend computes final tag lists; bulk API replaces tags per channel (add/remove logic is client-side).
- **Tag run paste** — must target pending run from Copy Prompt; parser accepts fenced JSON.
- **2000+ channels** — use bulk APIs (`bulk-sync-settings`, `bulk-tags`); avoid Sync All.
- **`SettingsView.tsx`** still large (refactor deferred).

## Out of scope / roadmap

- Auto-tagging scheduler, configurable tag taxonomy in Settings, tag-source filters in ChannelGrid.
- Filter ChannelGrid by tag source (`manual` vs `ai`).
- `{all_tags}` in Summary/Chat prompts.
- Dynamic sync v1.1, Open Graph, SettingsView split, mobile summarizer.
