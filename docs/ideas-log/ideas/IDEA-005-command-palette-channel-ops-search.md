# IDEA-005: Command palette channel ops & search

| Field | Value |
|-------|-------|
| **Id** | IDEA-005 |
| **Status** | backlog |
| **Added** | 2026-06-24 |
| **Priority** | medium |
| **Area** | frontend |

## Problem

IDEA-001 shipped channel selection, freeze/unfreeze, and bulk sync — but not single-channel add/delete/sync or quick find-and-open for posts/summaries. Operators still use the Channels grid and tab toolbars for these frequent actions.

## Proposed direction

Add palette commands: **add channel**, **delete channel**, **sync channel**, **search posts**, **search summaries**. **Freeze/unfreeze already exist** (IDEA-001 entity flows); no duplicate work.

- Reuse Raycast `entity-root` + `editor` sub-pages from IDEA-001
- Add new **`search-results`** sub-view for in-palette post/summary pick lists (not navigate + filter only)
- Extract shared channel helpers from `ChannelGrid` (`lib/channels/`)
- Lift History search to `UIContext` for palette + HistoryView parity
- **Phasing:** Phase 1 channel ops (add/delete/sync); Phase 2 search (in-palette results)
- Detail plan: [`.cursor/plans/command_palette_channel_ops_search.plan.md`](../../../.cursor/plans/command_palette_channel_ops_search.plan.md)

## Success criteria

- [x] Add / delete / sync single channel from palette
- [x] Add channel stays open on success for adding another
- [x] Delete/sync candidate pools include all channels (frozen, unavailable)
- [x] Search posts & summaries: editor → in-palette results → pick navigates tab
- [x] Empty Apply on search clears filter; post search clears semantic/related modes
- [x] Freeze/unfreeze regression unchanged (IDEA-001 — no new freeze/unfreeze commands)
- [x] Shared add-channel helper used by grid + palette
- [x] Playwright smoke for new commands

## Non-goals

- Re-implement freeze/unfreeze
- Navigate + filter only for search (rejected — in-palette results are v1)
- Backend API changes

## Decisions (user-confirmed, 2026-06-24)

1. **Search UX:** In-palette result lists — pick to open/navigate (new `search-results` mode).
2. **Add channel on success:** Stay open to add another.
3. **Delete channel pool:** All channels including frozen & unavailable.
4. **Search posts empty query:** Allow empty Apply to clear post search filter.
5. **Search summaries empty query:** Allow empty Apply to clear history search filter.
6. **Sync channel pool:** All channels including frozen.
7. **Semantic on text search:** Clear semantic/related when applying text search.
8. **Phasing:** Ops first — Phase 1 add/delete/sync; Phase 2 search.

## References

- IDEA-001 command palette
- `frontend/src/lib/commands/channel-entities.ts`
- `frontend/src/components/ChannelGrid.tsx`

## Session log

| Date | Notes |
|------|-------|
| 2026-06-24 | Plan drafted; freeze/unfreeze audit — already shipped |
| 2026-06-24 | Phase 1 ops implemented — freeze/unfreeze unchanged (IDEA-001); add/delete/sync via channel-ops |
| 2026-06-24 | Phase 2 search shipped — search-results mode, UIContext history search lift, Playwright smoke |
