---
name: Command Palette Extended Commands
overview: Extend the TG Summarizer command palette with channel lifecycle, sync/jobs, post/summary filters, settings quick actions, data maintenance, and AI workflow commands. Builds on IDEA-001/004/005 infrastructure.
todos:
  - id: plan-idea-docs
    content: Create IDEA-006 detail file and IDEAS-LOG row
    status: in_progress
  - id: shared-helpers
    content: Extract channel/sync/tor/post-filter helpers from grid/settings views
    status: pending
  - id: extend-types-palette
    content: Extend CommandContext, EntityFlowType, entityPayload for chained sub-flows
    status: pending
  - id: channel-commands
    content: Reset sync, delete selected, tags, start ID, select by tag, refresh metadata
    status: pending
  - id: sync-job-commands
    content: Pause auto-sync 10m, trigger jobs, bulk reset & sync all
    status: pending
  - id: posts-summary-commands
    content: Semantic search, related posts, filters, date range, forwarded, delete summary, starred toggle
    status: pending
  - id: settings-data-ai
    content: Tor actions, reload channels, DB stats/migrate/clear table, AI workflow, open-post
    status: pending
  - id: registry-wire
    content: Wire buildExtendedCommands in useCommandRegistry and CommandPalette handlers
    status: pending
  - id: tests-qa
    content: Unit tests for pure helpers; Playwright smoke; lint/build/test
    status: pending
isProject: false
---

# Command Palette — Extended Commands Plan

Extend the TG Summarizer command palette (`Cmd/Ctrl+Shift+P`) with operator-facing commands from brainstorm session `6a3bde19`. Builds on IDEA-001/004/005 ([`frontend/src/lib/commands/`](frontend/src/lib/commands/)).

Detail idea: [IDEA-006](../docs/ideas-log/ideas/IDEA-006-command-palette-extended.md)

---

## Scope

### Implement (~30 commands)

| Group | Commands |
|-------|----------|
| **Channels** | Reset & Sync Channel, Delete Selected Channels, Add/Remove Tag, Edit Start Message ID, Select Channels by Tag, Refresh Channel Metadata |
| **Sync** | Pause Auto-Sync 10m, Trigger Job Now (×5 jobs), Bulk Reset & Sync All |
| **Posts** | Semantic Search, Find Related Posts, Clear Post Filters, Date Range (24h/7d/30d), Forwarded Filter (3) |
| **Summaries** | Delete Summary, Show Starred Summaries Only |
| **Settings** | Rotate Tor IP Now, Restart Tor |
| **Data** | Reload Channels, Refresh DB Stats, Migrate Local→Server, Clear IndexedDB Table |
| **AI** | Generate Summary Now, Copy Summary Prompt, Paste External Summary |
| **Navigate** | Open Post by ID (enable stub) |

### Skip (explicit)

Rename channel, palette-existing ops (navigate, settings toggles, sync all/selected/channel, add/delete channel, text search, freeze/unfreeze, data transfer 21 cmds, theme/tour, clear cache, full DB import/export, resume auto-sync, job enable/disable pairs), publishing CRUD.

### Deferred / stub only

- **Natural Language Commands** — assistant stub placeholder (no execution)
- **Open Post by ID** — editor + navigate/scroll (minimal, not full entity browse)

---

## Architecture

### Patterns (reuse)

- `channel-ops.ts` registry style for new channel commands
- `search-results` mode for semantic post search
- `requiresConfirmation` on destructive ops
- `offlineDisabled()` hints for server-required ops
- Chained sub-flows via `entityPayload` on palette provider (entity → editor / entity → tag pick)

### New modules

| Module | Purpose |
|--------|---------|
| `lib/channels/reset-sync.ts` | Single + bulk reset & sync |
| `lib/channels/channel-tags.ts` | Add/remove tag, select by tag (case-insensitive) |
| `lib/channels/update-start-id.ts` | Edit channel start message ID |
| `lib/channels/refresh-metadata.ts` | `api.channelInfo` + upsert |
| `lib/channels/delete-selected.ts` | Bulk delete selected channels |
| `lib/network/tor-actions.ts` | Rotate IP, restart Tor |
| `lib/commands/post-filters.ts` | Clear filters, date ranges, forwarded enum helpers |
| `lib/commands/open-post.ts` | Parse channel+post ID input |
| `lib/commands/extended-commands.ts` | `buildExtendedCommands()` registry |
| `lib/commands/entity-candidates.ts` | Non-channel entity pools (summaries, posts, tables, tags) |

### Context extensions

- `CommandContext`: `forwardedFilter`, `setForwardedFilter`, `filteredPosts`, `starredOnly`, `setStarredOnly`, `handleSummarize`, `copySummaryPrompt`, `completePendingSummary`, `loadHistory`
- `UIContext`: lift `starredOnly` from HistoryView
- `EntityFlowType`: reset-sync, tag flows, delete-summary, pick-post, clear-db-table, remove-tag-pick, open-post

### Defaults

- Confirm: delete, reset sync, bulk reset, delete summary, restart tor, clear table, migrate
- Offline: disable server-required ops
- Semantic search: disabled when embeddings off
- Select by tag: case-insensitive match on `channel.tags`

---

## Test plan

- Unit: `channel-tags.test.ts`, `post-filters.test.ts`, `open-post.test.ts`
- Playwright: reload channels, pause auto-sync visible, semantic search disabled hint (or clear filters)
- `cd frontend && bun run lint && bun run build && bun test`
