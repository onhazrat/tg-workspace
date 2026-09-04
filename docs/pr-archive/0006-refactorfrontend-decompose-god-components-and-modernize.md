# #6 refactor(frontend): decompose god components and modernize state management

**State:** merged 2026-07-13 · **Branch:** `refactor/frontend-decompose-god-components` into `main` · **Diff:** +9729 / -6575 across 74 files · **Opened:** 2026-07-13

---

## What & why

Behavior-preserving refactor targeting the frontend's biggest maintainability/DX pain points (no feature changes). The four largest components and the two heaviest contexts were decomposed into focused modules with colocated unit tests. Shared context public APIs are unchanged, so consumer components were **not** touched.

## Changes

**Component splits** (thin container + focused subcomponents + tested pure logic):

| File | Before → After | Extracted to |
|---|---|---|
| `SettingsView.tsx` | 2068 → **75** | `components/settings/` (Appearance/Sync/Network/Ai) + shared `ToggleSwitch`; proxy math → `lib/settings/` |
| `LogsView.tsx` | 1748 → **273** | `components/logs/` (per-tab + shared card/filter kit); filtering/format/tab-metadata → `lib/logs/` |
| `ChannelGrid.tsx` | 1448 → **444** | `components/channel-grid/` (toolbar/chips/body/dialogs); filter/chip/trim logic → `lib/channels/` |
| `CommandPalette.tsx` | 1138 → **420** | `components/command-palette/` (per-mode views + flow hooks); grouping/search/messages → `lib/commands/palette-*` |

**State management:**
- **`SettingsContext.tsx`** 967 → **323**: ~27 settings now declared in a zod schema (`lib/settings/schema.ts`) with pure, tested load/persist/sync helpers. localStorage keys and backend payload shapes preserved for back-compat.
- **`DataContext.tsx`**: finished the in-progress TanStack Query migration — values now derive directly from the query cache; the 4 externally-used setters became cache write-throughs (via a generic `applySetStateAction` helper) and 7 unused setters were removed.

Net: **−6575 / +9729** across 74 files — the bulk of additions being **~157 new unit tests**.

## Intentional behavior refinements (flagged, all benign)
- **SettingsContext**: network/Tor settings now hydrate **once on mount** instead of re-running on every tor/proxy state change; zod now rejects garbage localStorage/server values (fall back to defaults) instead of applying `NaN`.
- **SettingsView**: background polling (proxy health / Tor status / job status) runs only while its section is mounted rather than on every settings tab; ephemeral state (proxy test results, dialogs) resets on section switch.
- **DataContext**: optimistic `setChannels` writes now trigger the auto-select/prune reconciliation immediately instead of after the next refetch.

## Verification
- ✅ `biome check` clean (310 files) · `tsc -p tsconfig.build.json` exit 0 · production `build` succeeds
- ✅ `bun test src` — **303 pass / 0 fail** (was 146 at baseline)
- ✅ Manually smoke-tested every refactored view against the real backend (Docker stack + Vite): login, ChannelGrid, CommandPalette (open + fuzzy search), all SettingsView sections (incl. Advanced-Mode proxy/TOR panels), and LogsView tab switching — **zero console errors**.

## Reviewer notes
- Done as 6 parallel workstreams with disjoint file ownership; public APIs held stable so no consumer churn.
- The Playwright e2e suite was **not** run here — it's blocked by a pre-existing `PrivateService` import in `tests/utils/privateApi.ts` that fails on `main` too (the generated client omits it in production mode), independent of this PR.

🤖 Generated with [Claude Code](https://claude.com/claude-code)
