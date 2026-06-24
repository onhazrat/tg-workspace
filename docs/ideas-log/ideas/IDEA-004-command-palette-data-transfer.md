# IDEA-004: Command palette data copy / export / import

| Field | Value |
|-------|-------|
| **Id** | IDEA-004 |
| **Status** | backlog |
| **Added** | 2026-06-23 |
| **Priority** | medium |
| **Area** | frontend |

## Problem

The command palette (IDEA-001) only supports full-database JSONL backup. Operators need granular copy-to-clipboard, entity-scoped JSONL export, and merge import for channels, posts, and summaries — including selected and frozen subsets.

## Proposed direction

Shared `frontend/src/lib/data-transfer/` module + palette commands in `data-commands.ts`. API-first reads/writes via existing repository endpoints. Phase 1: channels (selection exists). Phase 2: posts/summaries after "selected" semantics are confirmed.

Detail plan: [`.cursor/plans/command_palette_data_export_import.plan.md`](../../../.cursor/plans/command_palette_data_export_import.plan.md)

## Success criteria

- [ ] 9 channel copy/export/import commands in palette
- [ ] Shared JSONL envelope + DRY with DatabaseManagement helpers
- [ ] Imports use `requiresConfirmation`; merge upsert behavior documented
- [ ] Unit + Playwright smoke tests

## Non-goals

- New backend export routes (v1)
- Post/summary multi-select UI unless explicitly chosen
- Replacing full-database backup commands

## Open questions

See numbered list in implementation plan.

## References

- IDEA-001 command palette
- `backend/app/services/data_import_export.py`
- `frontend/src/lib/commands/actions.ts`

## Session log

| Date | Notes |
|------|-------|
| 2026-06-23 | Plan drafted; blocked on selected posts/summaries semantics |
