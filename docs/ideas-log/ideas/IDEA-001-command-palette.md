# IDEA-001: Frontend command palette (fuzzy command line)

| Field | Value |
|-------|-------|
| **Id** | IDEA-001 |
| **Status** | in-progress |
| **Added** | 2026-06-10 |
| **Started** | 2026-06-23 |
| **Priority** | medium |
| **Area** | frontend |

## Problem

Most workflows require hunting through tabs, sidebars, and settings panels. Power users repeat the same navigation (switch tab, open settings section, trigger sync, change theme) many times per session. A command palette with fuzzy search lets users type intent instead of clicking through the UI.

## Implemented direction (2026-06-23)

**Scope:** `/_tg/summarizer` only (`TgProviders`).

| Topic | Decision |
|-------|----------|
| **Library** | `cmdk` + shadcn `command` |
| **Shortcut** | `Cmd+Shift+P` / `Ctrl+Shift+P` |
| **Header trigger** | Icon button in `App.tsx` |
| **Settings** | All `SettingsContext` mutables + 5 server job toggles; Publishing CRUD excluded |
| **Boolean settings** | Toggle / Enable / Disable per setting with ON/OFF badge |
| **Enum settings** | Flat searchable list (`Set X → Y`) |
| **Free-form** | In-palette editor sub-page |
| **Advanced settings** | Auto-enable `advancedMode` before apply |
| **Offline** | Sync/scrape commands visible but disabled with hint |
| **Embeddings** | Two labeled paths: Feature (`setEmbeddingsEnabled`) vs Background Job (`api.updateJob`) |
| **Confirmation** | Bulk freeze/unfreeze, clear cache, import/export DB (schema `requiresConfirmation`) |
| **Recents** | Empty query only; `localStorage` reverse-chronological |
| **Search learning** | Query→command affinity + frecency ranking (`rank-commands.ts`) |
| **Channel flows** | Raycast nested: search/select/deselect/freeze/unfreeze/auto-follow + bulk ops |
| **Deferred** | NL assistant (stub mode), open-post (stub `entity-root`) |

### Key files

- `frontend/src/components/CommandPalette.tsx` — dialog + mode stack UI
- `frontend/src/components/CommandPaletteProvider.tsx` — palette state
- `frontend/src/hooks/useCommandRegistry.ts` — binds contexts to command schemas
- `frontend/src/lib/commands/` — static command schemas (navigate, actions, settings, channels)
- `frontend/src/hooks/useJobToggles.ts` — shared job toggle logic (also used by `SettingsView`)

## Success criteria

- [x] Palette opens/closes via `Cmd/Ctrl+Shift+P` and header icon
- [x] Fuzzy search + affinity ranking for registered commands
- [x] Workspace tab navigation and theme toggle work without mouse
- [x] Commands registered in `lib/commands/` and extended via schemas
- [x] Playwright coverage in `frontend/tests/summarizer.spec.ts`

## Non-goals (unchanged)

- Full NL assistant execution inside palette
- Replacing post/channel search UIs
- CLI outside browser
- Admin template shell palette (`/_layout/*`)
- Publishing bot/destination CRUD via palette

## Session log

| Date | Notes |
|------|-------|
| 2026-06-10 | Created from product idea |
| 2026-06-23 | Full v1 implementation: cmdk + shadcn, all settings, channel entity flows, recents, search affinity, confirmation, stubs |
