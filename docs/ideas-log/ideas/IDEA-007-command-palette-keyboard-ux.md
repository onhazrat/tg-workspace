# IDEA-007: Command palette keyboard UX

| Field | Value |
|-------|-------|
| **Id** | IDEA-007 |
| **Status** | implemented (2026-06-25) |
| **Added** | 2026-06-25 |
| **Priority** | medium |
| **Area** | frontend |

## Problem

IDEA-001/004/005/006 shipped a rich command palette with nested entity flows, editors, search-results, and confirm steps. Most flows work with mouse + partial keyboard support, but gaps remain: confirm dialog Enter handling, uncontrolled list selection in entity/search-results (arrow/hover desync class), `loop={false}`, mouse-only Apply/Back in some modes, and E2E tests that click instead of exercising keyboard paths.

## Proposed direction

Audit every `PaletteMode` and chained flow; align with Raycast/VS Code conventions (type-to-filter, wrap, Enter/Escape/Backspace, disabled skip, stay-open refocus). Shared `usePaletteListSelection` hook; confirm dialog keyboard semantics; Playwright keyboard-only suite.

Detail plan: [`.cursor/plans/command_palette_keyboard_ux.plan.md`](../../../.cursor/plans/command_palette_keyboard_ux.plan.md)

## Success criteria

- [x] All palette modes completable without mouse (except native file picker after import confirm)
- [x] Confirm: autofocus Cancel, Enter on focused button, arrow between buttons
- [x] Entity + search-results: controlled cmdk selection with wrap
- [x] Playwright keyboard-only smokes for root, entity, editor, search-results, confirm, chained tag flows
- [ ] Manual keyboard matrix passed once

## Keyboard matrix (post-implementation)

| Mode | Open/focus | Navigate | Enter | Escape | Backspace empty | Wrap | Notes |
|------|------------|----------|-------|--------|-----------------|------|-------|
| `commands` | Cmd/Ctrl+Shift+P; input rAF | ↑↓ controlled `selectedCommandId` | Run command; disabled skipped | Close at root | No-op at root | `loop` | Footer `↵ run · esc close · ⌫ parent`; X tabIndex -1 |
| `entity` | Input rAF on open | ↑↓ controlled `selectedEntityId` | Pick / chain / confirm | Pop stack | Pop stack | `loop` | Multi-pick refocuses filter; `PaletteSubViewHeader` |
| `editor` | Input/textarea rAF | N/A | Enter apply (⌃↵ textarea) | Pop stack | Pop stack | — | `isEditorApplying` blocks Enter; footer hints; testid on Apply |
| `search-results` | Input rAF | ↑↓ controlled `selectedSearchResultId` | Pick + navigate | Pop to editor | Pop to editor | `loop` | Preserves editor query on back |
| `confirm` | Cancel autofocus | ←→ between buttons | Runs focused button | Cancel | — | — | Import still needs native file picker after confirm |
| `assistant` | Back button | Tab | — | Pop stack | Pop stack | — | Stub only |

## Non-goals

- Whole-app keyboard accessibility
- Import file picker replacement
- NL assistant keyboard UX until feature ships
- New palette commands

## Open questions

See plan §7 — defaults favor focus Cancel on destructive confirm, `loop={true}`, document import file-picker exception.

## References

- IDEA-001, IDEA-005, IDEA-006
- `frontend/src/components/CommandPalette.tsx`
- `frontend/src/hooks/usePaletteListSelection.ts`
- `frontend/tests/summarizer.spec.ts` — K1–K14 keyboard suite

## Session log

| Date | Notes |
|------|-------|
| 2026-06-25 | Plan created (keyboard UX audit) |
| 2026-06-25 | Implemented: shared selection hook, confirm keyboard, loop wrap, footer hints, E2E K1–K11 |
| 2026-06-25 | Chained-flow E2E K12–K14 (add/remove tag, search-results back); fixed chained editor panel render |
| 2026-06-25 | Optional: K15–K17 (clear-db-table cancel, deselect multi-pick, freeze/unfreeze); Cmd+Enter on root; aria-live on stay-open picks |
