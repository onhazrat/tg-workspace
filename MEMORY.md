# TG Summarizer — Project Memory

> Last synced: 2026-07-09

## Purpose

Self-hosted Telegram channel summarizer. Migrated from browser-heavy `TG-Summarizer/` (React + Express + IndexedDB) to a **FastAPI + React monorepo** with scraping, scheduling, AI, and PostgreSQL on the server. **Migration Phases 0–7 complete (2026-06-08).** **Dynamic channel sync v1 (2026-07-01)** — [dynamic_channel_sync plan](.cursor/plans/dynamic_channel_sync_77e7db50.plan.md). **Tag tab v1 (2026-07-02)** — [tag_tab_v1 plan](.cursor/plans/tag_tab_v1_cea80474.plan.md). **Post media v1 (2026-07-04)**. **Discover tab v1 (2026-07-06)** — [discover_tab_v1 plan](.cursor/plans/discover_tab_v1_f26ed84d.plan.md). **Channel setting groups v1 + UX v2 (2026-07-07)** — [channel_setting_groups plan](.cursor/plans/channel_setting_groups_89fcc8b4.plan.md), [setting_groups_ux_v2 plan](.cursor/plans/setting_groups_ux_v2_fb1c5766.plan.md). **Trim channel selection (2026-07-08)**. **Channel telegram chat ID v1 (2026-07-08/09)** — [channel_telegram_chat_id plan](.cursor/plans/channel_telegram_chat_id_9fdb00fd.plan.md). Run commands: [README.md](README.md), [development.md](development.md).

## Architecture

- **`backend/`** — FastAPI (`app/main.py`), SQLModel (`app/models_tg.py`), Alembic, services (`scraper.py`, `sync_orchestrator.py`, **`sync_schedule.py`**, `channels.py`, **`channel_setting_groups.py`**, **`channel_tags.py`**, **`tag_runs.py`**, **`post_media_parser.py`**, **`post_thumbnails.py`**, **`telegram_html.py`**, …), APScheduler jobs, pluggable AI (`app/ai/`, Gemini first). Prompts in `backend/app/prompts/`.
- **`frontend/`** — React 19 + Vite + TanStack Router/Query; dual-route UI:
  - **`/_tg/summarizer`** — full-screen TG app (`App.tsx` + `TgProviders`); **command palette** on `main`. Main content uses **`app-shell`** width utility.
  - **`/_layout/*`** — template admin shell (`/`, `/items`, `/admin`, `/settings`).
- **Providers (TG shell):** `Settings → Data → UI → Scraper → Chat → AI → Tag` in [`TgProviders.tsx`](frontend/src/components/TgProviders.tsx).
- **Command palette:** `frontend/src/lib/commands/` — registry, settings-schema, channel ops, **`group-commands.ts`**, **`channel-telegram-chat-id-commands.ts`**, data transfer.
- **Post view pipeline:** [`frontend/src/lib/posts/post-view.ts`](frontend/src/lib/posts/post-view.ts) — `buildFilteredPostsFromRaw`, `formatPostsForPrompt`, **`applyMediaFilter`**. **`filteredPosts` is canonical** for Posts UI, Summary, Chat, Tag, and **Discover**.
- **Post media (frontend):** [`post-media.ts`](frontend/src/lib/posts/post-media.ts); PostFilter media chips.
- **Post media (backend):** `Post.media` JSON on `tg_posts`; thumbs on disk under `data/post-thumbs`; served at **`GET /telegram/post-thumb/{channel}/{post_id}`** and **`GET /telegram/channel-photo/{channel_id}`** (auth required).
- **Discover pipeline (frontend-only):** [`discover-forward-sources.ts`](frontend/src/lib/posts/discover-forward-sources.ts), [`DiscoverView.tsx`](frontend/src/components/DiscoverView.tsx).
- **Channel tag model:** [`channel-tag-model.ts`](frontend/src/lib/channels/channel-tag-model.ts) + mirror [`channel_tags.py`](backend/app/services/channel_tags.py). Legacy `string[]` tags normalize to `{ name, source, assignedAt }`.
- **Setting groups:** [`channel_setting_groups.py`](backend/app/services/channel_setting_groups.py) — strict inheritance; `tg_channel_setting_groups` + `Channel.setting_group_id`. Frontend: [`SettingGroupsPanel.tsx`](frontend/src/components/SettingGroupsPanel.tsx), [`setting-groups.ts`](frontend/src/lib/channels/setting-groups.ts), shared cache [`useSettingGroups.ts`](frontend/src/hooks/useSettingGroups.ts) (React Query; group **selection is client-side**, no refetch on click). **Virtual group tags:** [`virtual-group-tags.ts`](frontend/src/lib/channels/virtual-group-tags.ts) — `group:{GroupName}` chips on cards (read-only). Channel PUT uses `channelWritePayload()` in [`data.ts`](frontend/src/api/data.ts) to strip inherited + server-managed fields.
- **Channel grid sort/trim:** [`sort-channels-for-grid.ts`](frontend/src/lib/channels/sort-channels-for-grid.ts) — shared grid comparator (includes **`posts_in_scope`**); [`trim-selected-channels.ts`](frontend/src/lib/channels/trim-selected-channels.ts) — shrink selection to first N by sort order.
- **Telegram chat ID:** `Channel.telegram_chat_id` (API `telegramChatId`); extracted in [`scraper.py`](backend/app/services/scraper.py) from widget `data-view` base64 JSON field `c`; populated on sync/channel-info; **server-managed** (not client-writable).
- **Tag apply flow:** [`apply-tag-suggestions.ts`](frontend/src/lib/channels/apply-tag-suggestions.ts); bulk persist via **`PATCH /channels/bulk-tags`**.
- **Prompt channel context:** [`format-channels-for-prompt.ts`](frontend/src/lib/channels/format-channels-for-prompt.ts); toggles in `UIContext` + checkboxes on **ChannelGrid**.
- **Tag prompt builder:** [`tag-prompt.ts`](frontend/src/lib/channels/tag-prompt.ts), parser [`parse-tag-response.ts`](frontend/src/lib/channels/parse-tag-response.ts).
- **Channel tag utilities:** [`channel-tags.ts`](frontend/src/lib/channels/channel-tags.ts) — `collectAllChannelTags`, `sortTagsForChannelGrid`, tag filter/select helpers.
- **Tag UI:** `TagContext`, `TagConfig`, `TagView`, `PasteTagsModal`.
- **API clients (ADR-006):** hand-written `frontend/src/api/` (summarizer); generated `frontend/src/client/` (admin/auth).
- **Data layer (frontend):** `repository.ts` API-first → `cache.ts` (IndexedDB).
- **uv** + **bun**. **Bun unit tests** (`bun:test`) in `frontend/src/**/*.test.ts(x)` — `bun run test:unit`. **Playwright E2E** in `frontend/tests/` — `bun run test` (~100+ tests).
- **CI/CD:** GitHub-hosted tests on push; self-hosted deploy — [deployment.md](deployment.md). Workflows: `test-backend`, **`test-frontend-unit`**, `playwright`, `test-docker-compose`, `pre-commit` (PR only), `zizmor`. **Migrations on deploy:** `prestart` → `alembic upgrade head`.

### Key API surfaces

- Versioned: `/api/v1/telegram/*`, `/network/*`, `/ai/*`, `/data/*`, `/rag/*`, `/jobs/*`
- **AI summary/tag/chat:** accept **`channelsText`**; tag also takes **`allTags`**, **`tagMode`**.
- **Channels:** `GET/PUT/DELETE /data/channels/{id}`; **`PATCH /data/channels/bulk-sync-settings`**; **`PATCH /data/channels/bulk-tags`**; **`PATCH /data/channels/bulk-setting-group`**. Channel responses include optional **`telegramChatId`** (read-only).
- **Setting groups:** `GET/POST /data/setting-groups`; `PUT/DELETE /data/setting-groups/{id}`.
- **Tag runs:** `GET/PUT/DELETE /data/tag-runs/{id}`.
- **Channel sync:** `POST /jobs/sync` → SSE events.
- **Media assets:** `GET /telegram/channel-photo/{channel_id}`, `GET /telegram/post-thumb/{channel_name}/{post_id}`.
- OpenAPI: `/docs`, `/api/v1/openapi.json`

## Data pipelines

- **Authoritative store:** PostgreSQL; IndexedDB read-through cache ([ADR-003](docs/migration/ADR-003-hybrid-sync.md)).
- **Scrape/sync:** `sync_orchestrator.py`; passes: `initial` / `incremental` / `backfill`. **Partial history** = `historyCompleteToCutoff === false`.
- **Per-channel auto-sync (v1):** Channel fields source of truth — `regularSyncEnabled`, `dynamicSyncEnabled`, `nextRegularSyncAt`, `nextDynamicSyncAt`. Inherited from setting group on membership change.
- **Setting groups:** `tg_channel_setting_groups` per operator scope; each channel has exactly one `setting_group_id`. Group update propagates inherited fields to all member channels. Built-in groups seeded per scope: `default`, **Slow feed**, **High velocity**, `Frozen`, `Restricted`.
- **Channel tags:** JSON on `tg_channels.tags` — structured objects; no separate category field. Manual `group:` tags blocked; virtual `group:{name}` derived from membership.
- **Tag runs:** `tg_tag_runs` — pending/completed runs with suggestions, apply result, mode.
- **Jobs:** `auto_sync`, `embeddings`, `auto_summary`, `retention`, `translation_batch`.
- **Discover (derived, no API):** aggregates `forwardedFrom` from `filteredPosts` + channel list.
- **Post media:** scrape enriches posts with `media` object; thumbs on disk; Docker deploy mounts **`app-media-data:/app/data`**.
- **Telegram HTML text:** [`telegram_html.extract_telegram_html_text`](backend/app/services/telegram_html.py).
- **Telegram chat ID extraction:** from `.tgme_widget_message[data-view]` on `t.me/s` pages (not channel header); requires at least one visible message widget.

## Analysis conventions

- **Channel identity:** `channel_id` / `name` (username) remains primary for scrape URLs, posts, and `Channel.id`. **`telegramChatId`** is supplementary stable Telegram peer ID (`-100…`). API camelCase. **Timestamps:** ms epoch.
- **Summarizer UI:** URL tabs `/summarizer?tab=` — **8 workspace tabs:** channels, posts, summary, tag, **discover**, chat, history, settings. Settings sub-sections: `?tab=settings&section=`. Group panel deep-link: `?settingGroup={id}` via [`useSummarizerGroupParams.ts`](frontend/src/hooks/useSummarizerGroupParams.ts).
- **Tab routing pitfall:** `tab` must appear in **both** [`useSummarizerTab.ts`](frontend/src/hooks/useSummarizerTab.ts) **and** route `VALID_TABS` in [`summarizer.tsx`](frontend/src/routes/_tg/summarizer.tsx).
- **Posts tab filters:** `postFilter_*` in localStorage; `filteredPosts` canonical for all AI tabs and Discover.
- **Channel prompt context:** checkboxes *Include channel bio/tags* → `UIContext` localStorage; affects Summary, Chat, Tag `{channels}` blocks.
- **Tag tab scope:** **selected channels** + **filteredPosts**; **no prompt batching UI**.
- **Tag modes:** **Add** or **Remove**; apply uses all parsed channels matching selection.
- **Command palette:** `Cmd+Shift+P`; tag ops via `channel-tags.ts`; group ops via `group-commands.ts`; **copy Telegram chat ID** commands (all/selected/frozen, IDs-only and name+ID TSV, single-channel entity flow) via `channel-telegram-chat-id-commands.ts`.
- **Channels tab tag bar:** inline chip row in `ChannelGrid`; **tag search** input filters visible tag chips; sorted by `sortTagsForChannelGrid` (fully selected → partial → none; usage within group).
- **Channels tab control layout (2026-07-08):** tag chips occupy their **own row**; the AI-prompt-context toggles and the filter/sort/trim controls sit on a **second row** as two self-contained pills (left: *AI Prompt Context* bio/tags checkboxes; right: *Showing X of Y* + *Lang* + *Sort By* + *Trim*), both `flex-wrap`.
- **Channels tab group filter chips:** row of setting-group chips; toggles `channelGroup` URL param; filters grid by `settingGroupId`. Built-in order: default → Slow feed → High velocity → Frozen → Restricted → custom (alpha).
- **Channels tab trim:** sort toolbar `[ N ] [ Trim ]` next to Sort By + direction; shrinks global `selectedChannels` to first N in `sortChannelsForGrid` order; filter-hidden selections still ranked; `N >= selectedCount` → noop + info toast; `N < 1` invalid (use **None** to clear all); last N in `channelGrid_trimCount`.
- **Channels tab sort:** includes **Posts in Scope** (counts from `filteredPosts`); optional **sort rank** display on cards (`channelGrid_showSortRank` localStorage).
- **Channel card metadata toggles (Settings):** subscribers, photos, videos, files, links, start ID, bio, **`showChannelTelegramChatId`** (default **off**).
- **Discover tab scope:** same **selected channels** + **filteredPosts** as Summary/Tag. Sort chips: Forwards (default) · Last seen · Forwarded by.

## Decisions (stable)

1. **Single-operator (Mode A)** — see [DECISIONS.md](docs/migration/DECISIONS.md).
2. **Data** — Postgres authoritative; IndexedDB cache; API-first writes.
3. **Dynamic channel sync v1 (2026-07-01)** — per-channel deadlines; global settings seed new channels only (superseded for sync fields by setting groups).
4. **Post view filters (2026-06-30)** — shared `post-view.ts`; `filteredPosts` canonical.
5. **Tag tab v1 (2026-07-02)** — structured tags; `tg_tag_runs`; bulk tag apply API; **no auto-tagging scheduler**.
6. **Channels tab tag bar sort (2026-07-02)** — selection-state grouping in `sortTagsForChannelGrid`.
7. **Discover tab v1 (2026-07-06)** — frontend-only from `filteredPosts`; guided tour step after Tag.
8. **Post media v1 (2026-07-04)** — `tg_posts.media` JSON; thumbs on disk; authenticated thumb URLs.
9. **Telegram text extraction (2026-07-05)** — shared `extract_telegram_html_text`.
10. **Media cache persistence (deploy)** — `compose.yml` volume `app-media-data` → `/app/data`.
11. **Channel setting groups v1 (2026-07-07)** — strict inheritance, **no per-channel overrides** for inherited fields; each channel in exactly one group; default group editable but not deletable; non-empty custom groups cannot be deleted. Inherited: `regularSyncEnabled`, `dynamicSyncEnabled`, `autoSyncIntervalMinutes`, `dynamicSyncExpectedPosts`, `autoFollowForwarded`, `isFrozen`, `isUnavailableOnWebView`. **`language` stays per-channel** (not inherited).
12. **Setting groups UX v2 (2026-07-07)** — built-in presets: **Slow feed** (1440m regular, dynamic on, 1 post), **High velocity** (60m, dynamic on, 10 posts); unique group names (case-insensitive per scope); removed Settings sync-defaults bulk UI; simplified `ChannelCard` (no per-channel sync toggles); virtual `group:{name}` tags on all cards; group filter chips; palette group commands (`group-commands.ts` + `channelGroup` / `settingGroup` URL params).
13. **Setting groups performance (2026-07-07)** — `GET /setting-groups` must not load all channel ORM rows (orphan IDs via SQL DISTINCT); `list_setting_groups` must **`commit()` after `ensure_builtin_groups`** even when only `flush()` ran (gating on `session.new` alone rolls back built-ins). Frontend: shared React Query cache; stale-while-revalidate in panel.
14. **Trim channel selection (2026-07-08)** — shrink-only; all globally selected channels ranked; reuses `sortChannelsForGrid`; shared helper + unit + Playwright tests.
15. **ChannelGrid two-row controls (2026-07-08)** — tag chips on row 1; AI-prompt-context + filter/sort/trim pills on row 2.
16. **Frontend unit tests in CI (2026-07-08)** — `bun run test:unit` runs `bun:test` on `frontend/src/**/*.test.ts(x)`; separate from Playwright (`bun run test`). Workflow: [`.github/workflows/test-frontend-unit.yml`](.github/workflows/test-frontend-unit.yml); path-filtered on `frontend/**`.
17. **Prek baseline on main (2026-07-08)** — full `prek run --all-files` green; frontend Biome-formatted; OpenAPI client regen; SQLAlchemy typing fixes in `operator.py` / `channel_setting_groups.py`; [`_typos.toml`](_typos.toml) for spell-check excludes (`.cursor/`, live HTML fixtures).
18. **Channel telegram chat ID v1 (2026-07-08/09)** — nullable `telegram_chat_id` on `tg_channels` with partial unique index `(user_id, telegram_chat_id)`; **username remains primary** for scrape URLs, posts, and `Channel.id`. **Server-managed** — reject on PUT/create/import; stripped from `channelWritePayload`. **Populate** on sync/channel-info from `data-view`; **add dedup** selects existing channel when `telegramChatId` matches (no duplicate create). **Mismatch** (stored ≠ scraped) or **ID conflict** on populate → move to **Frozen** group + failed sync log. **No Bot API fallback**; **no username rename cascade** in v1. UI: optional ChannelCard badge (`showChannelTelegramChatId`, default off). Palette: copy ID commands (all/selected/frozen, TSV variants, single-channel).

### Explicitly rejected / deferred

- Mode B, Celery/Redis, pgvector, mobile responsive summarizer.
- **Per-channel overrides for setting-group fields** — rejected (strict inheritance).
- **Prompt batching for Tag tab** — rejected.
- **Auto-tagging background job** — deferred.
- **Configurable taxonomy in Settings** — deferred.
- **Storing prompt checkbox prefs in DB** — deferred (localStorage only).
- Dynamic sync v1.1, Open Graph share links — see prior plans.
- **Discover v1.1:** bulk follow, preview card, auto-follow suggest — deferred.
- **Telegram chat ID v1.1:** username rename detection + post/embeddings cascade; Bot API `getChat` fallback for empty web views; using numeric ID as primary key or scrape URL.

## User preferences

- Self-hosted single operator; discuss trade-offs before big architectural bets.
- **Ask clarifying questions** for scheduling/product decisions.
- **Only commit when explicitly asked**; plan files updated when user requests.
- **Frontend bug fixes** — verify with Playwright; add regression test when non-trivial.
- **Prefer simpler flows** — Copy Prompt + paste over heavy wizards.
- **Bulk APIs for scale** — 2000+ channels; avoid N sequential HTTP round-trips.
- **Channel discovery** — prefer filter-aware forward aggregation from existing scrape data.

## Environment & fixes

- **Native dev:** `uv sync` → `alembic upgrade head` → uvicorn :8000; `bun run dev` :5173. **`POSTGRES_DB=app`**.
- **Alembic head:** `o7p8q9r0s1t2` — `telegram_chat_id` on channels + partial unique index (after `n6o7p8q9r0s1` built-in presets). Run `alembic upgrade head` before relying on `telegramChatId`.
- **Pre-commit (prek):** install once per clone: `cd backend && uv run prek install -f` → `.git/hooks/pre-commit`. Manual full sweep: `cd backend && uv run prek run --all-files`. **`git commit` runs prek automatically** on staged/changed files (not identical to `--all-files`; hooks with `pass_filenames: false` like mypy/ty/SDK-gen are repo-scoped). Config: [`.pre-commit-config.yaml`](.pre-commit-config.yaml); mypy/ty run from `backend/`; typos uses [`_typos.toml`](_typos.toml).
- **Biome:** use pinned **`bun run biome`** (2.3.14 via frontend devDep) — **never `npx @biomejs/biome`** (pulls newer version → whole-file reformat). `bun run lint` runs Biome with `--write --unsafe` (auto-fix). Main is Biome-clean as of prek baseline (2026-07-08).
- **Local dev checks for scoped frontend edits:** `bun run test:unit` (fast), `bun run tsc -p tsconfig.build.json --noEmit` (typecheck). Playwright E2E needs full Docker stack; CI runs on push to main.
- **CI quality gaps (2026-07-08, not yet fixed):** `pre-commit` workflow runs on **PRs only** — direct pushes to `main` skip it. `deploy-staging` has no `needs:` on test jobs. `bun run lint` is fix-mode, not check-only.
- **Playwright local (Cursor sandbox):** use **`PLAYWRIGHT_CHANNEL=chrome`** or Docker. Requires backend on :8000 + `alembic upgrade head`.
- **Playwright CI:** push to main always runs tests (paths-filter bypass on push).
- **E2E tag tests:** `channelHasTag` must handle structured tag objects `{ name }`.
- **GPG signing:** 1Password agent may fail in agent environments; `--no-gpg-sign` fallback if needed.
- **Setting groups CI (2026-07-07):** after strict inheritance, channel-create tests must assign groups (or bulk-sync default group) for dynamic sync / auto-follow — inherited fields on `PUT /channels` are rejected. Duplicate `import { toast }` in `channel-tags.ts` broke Docker frontend build.
- **Telegram chat ID CI fix (2026-07-09):** `data-view` base64 is **unpadded** — decoder must pad before `b64decode`. `telegram_chat_id` must be rejected on **create** path too (not only update).

## Caveats

- **Never commit `.env`** or API keys.
- **Single scheduler instance** — no multi-replica without coordination.
- **Tag Apply** — frontend computes final tag lists; bulk API replaces tags per channel.
- **Setting group edits** — propagate to all member channels; frozen state inherited from group.
- **Virtual `group:` tags** — display-only; cannot be manually added/removed via tag UI; excluded from `{all_tags}` / Tag tab prompts.
- **SettingGroupsPanel** — never put `selectedId` in fetch deps (caused full refetch + loading gate on every group click).
- **Reserved built-in groups** — `default`, Slow feed, High velocity, Frozen, Restricted: editable settings, non-deletable, always listed at 0 channels; canonical ids use prefixes (`default-`, `slow-feed-`, `high-velocity-`, `frozen-`, `restricted-`).
- **2000+ channels** — use bulk APIs (`bulk-sync-settings`, `bulk-tags`, `bulk-setting-group`).
- **`SettingsView.tsx`** still large (refactor deferred).
- **Discover + semantic search** — RAG mode caps at ~50 posts.
- **Post media migration** — DB must be at `k3l4m5n6o7p8`+; thumbs are filesystem-only.
- **Post thumbs** — authenticated API paths only (`thumbApiPath`).
- **`telegramChatId`** — only from message widgets on web view; empty/unavailable channels stay null until a scrape page with posts. Forwarded posts carry **host** channel ID, not source. Copy commands skip channels without ID (info toast). Username recycling triggers mismatch freeze.

## Out of scope / roadmap

- Auto-tagging scheduler, configurable tag taxonomy in Settings, tag-source filters in ChannelGrid.
- Filter ChannelGrid by tag source (`manual` vs `ai`).
- `{all_tags}` in Summary/Chat prompts.
- Dynamic sync v1.1, Open Graph, SettingsView split, mobile summarizer.
- Discover bulk follow, preview card, dismiss persistence, auto-follow suggest mode.
- Per-channel sync toggles on ChannelCard (removed; use setting groups).
- **Telegram chat ID v1.1:** rename cascade, Bot API fallback, primary-key migration.
- **CI hardening:** pre-commit on push to main, deploy `needs:` test jobs, split `lint` vs `lint:fix`.
