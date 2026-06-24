# IDEA-006: Command palette extended commands

| Field | Value |
|-------|-------|
| **Id** | IDEA-006 |
| **Status** | in progress |
| **Added** | 2026-06-24 |
| **Priority** | medium |
| **Area** | frontend |

## Problem

IDEA-001/004/005 shipped core palette, data transfer, and channel ops/search — but operators still use ChannelGrid, PostFilter, SettingsView, DatabaseManagement, and SummaryConfig for many frequent actions (reset sync, tags, semantic search, tor quick actions, AI workflow, DB maintenance).

## Proposed direction

Add ~30 extended commands across Channels, Sync, Posts, Summaries, Settings, Data, AI, and Navigate groups. Reuse `channel-ops.ts`, `search-results` mode, `requiresConfirmation`, offline hints, and chained entity sub-flows (`entityPayload`).

Detail plan: [`.cursor/plans/command_palette_extended_commands.plan.md`](../../../.cursor/plans/command_palette_extended_commands.plan.md)

## Success criteria

- [ ] All brainstorm commands implemented (excluding explicit skips)
- [ ] Shared helpers extracted from ChannelGrid, SettingsView, PostFilter, DatabaseManagement, AIContext
- [ ] Wired in `useCommandRegistry.ts`
- [ ] Unit tests for pure helpers; Playwright smoke for 2–3 high-value commands
- [ ] `bun run lint && bun run build && bun test` pass

## Non-goals

- Rename channel (rejected)
- Publishing CRUD in palette
- Full NL assistant execution (stub only)
- Re-implement palette-existing commands

## Decisions (defaults, 2026-06-24)

1. **Confirm on destructive** — delete, reset sync, bulk reset, delete summary, restart tor, clear table, migrate.
2. **Offline** — disable server-required ops with reason.
3. **Semantic search** — disabled when embeddings off.
4. **Select by tag** — case-insensitive match on `channel.tags`.
5. **NL assistant** — placeholder message only.

## References

- IDEA-001, IDEA-004, IDEA-005
- Brainstorm session `6a3bde19`

## Session log

| Date | Notes |
|------|-------|
| 2026-06-24 | Plan + implementation started |
