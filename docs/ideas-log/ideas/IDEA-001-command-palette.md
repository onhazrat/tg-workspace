# IDEA-001: Frontend command palette (fuzzy command line)

| Field | Value |
|-------|-------|
| **Id** | IDEA-001 |
| **Status** | backlog |
| **Added** | 2026-06-10 |
| **Priority** | medium |
| **Area** | frontend |

## Problem

Most workflows require hunting through tabs, sidebars, and settings panels. Power users repeat the same navigation (switch tab, open settings section, trigger sync, change theme) many times per session. A command palette with fuzzy search would let users type intent instead of clicking through the UI.

## Proposed direction

Add a **global command palette** (modal overlay, keyboard-first) inspired by VS Code / Raycast / `cmdk`:

- **Trigger:** `Cmd+K` / `Ctrl+K` (and optionally a visible “Search commands…” affordance in the header).
- **Fuzzy find:** Filter commands by title, keywords, and aliases (e.g. “sync”, “scrape”, “dark mode”, “channels”).
- **Registry pattern:** Central `commands.ts` (or similar) declaring id, label, keywords, group, shortcut hint, and `run()` that calls existing context/hooks — no duplicate business logic.
- **UI stack:** Prefer `cmdk` + existing Radix/shadcn `Dialog` (or add shadcn `command` component). Match current theme (dark/light).

### Command categories (initial backlog)

| Group | Example commands | Maps to today |
|-------|------------------|---------------|
| **Navigate** | Go to Channels / Posts / Summary / Chat / History / Settings | `WORKSPACE_TABS`, `SETTINGS_TABS`, `setActiveTab` in `UIContext` |
| **Channels** | Select all channels, clear selection, follow channel by username | `DataContext`, `ChannelGrid` actions |
| **Sync & scrape** | Sync selected channels, pause auto-sync, resume auto-sync | `ScraperContext`, `api.jobsStatus` |
| **AI** | Generate summary, open chat, change model / language | `AIContext`, `SettingsContext` |
| **Appearance** | Toggle theme, start guided tour | `App.tsx` `toggleTheme`, `useGuidedTour` |
| **Data** | Export, clear cache (with confirm), open diagnostics | Settings hub / data management tab |
| **Search** | Focus post search, semantic search | `ScraperContext` search state |

Phase 1: navigation + theme + tab switch only. Phase 2: mutating actions with confirmation where destructive.

## Success criteria

- [ ] Palette opens/closes globally via keyboard; does not break focus in inputs when closed.
- [ ] Fuzzy search returns relevant commands in &lt;50 ms for ~30–50 registered commands.
- [ ] At least workspace tab navigation and theme toggle work without mouse.
- [ ] Commands are registered in one place and easy to extend.
- [ ] Optional: show shortcut hints in palette rows for discoverability.

## Non-goals

- Full natural-language assistant inside the palette (that stays in Chat).
- Replacing the existing post/channel search UIs — palette focuses on **actions and navigation**.
- CLI outside the browser or server-side shell.
- Every settings field exposed as a command in v1 (use grouped “Open Settings → Sync” instead).

## Open questions

- Single palette vs. separate “Go to…” (navigation) and “Commands…” modes?
- Should channel/post **entity** search live in the same palette (fuzzy pick a channel by name) or a second palette?
- Register commands from feature modules vs. one flat registry file?
- Persist recent/frequent commands?

## References

- `frontend/src/App.tsx` — main workspace shell and tabs
- `frontend/src/constants.ts` — `WORKSPACE_TABS`, `SETTINGS_TABS`
- `frontend/src/contexts/UIContext.tsx`, `DataContext`, `ScraperContext`, `SettingsContext`, `AIContext`
- `frontend/src/components/SettingsHub.tsx` — settings sub-navigation
- No existing `cmdk` / command palette dependency in `package.json` today

## Session log

| Date | Notes |
|------|-------|
| 2026-06-10 | Created from product idea: command-line-style UX with fuzzy finding |
