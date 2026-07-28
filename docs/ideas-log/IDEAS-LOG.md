# Ideas Log

> Quick capture for later. See [README](./README.md) for workflow and [_template.md](./_template.md) for detail files.

**Last reviewed:** 2026-06-23

## Backlog

| Id | Title | Area | Priority | Added | Detail | Notes |
|----|-------|------|----------|-------|--------|-------|
| IDEA-001 | Frontend command palette (fuzzy command line) | frontend | medium | 2026-06-10 | [detail](./ideas/IDEA-001-command-palette.md) | **In progress** — see In progress table |
| IDEA-002 | Add TanStack devtools (Router + Query) | frontend | low | 2026-06-17 | [detail](./ideas/IDEA-002-tanstack-devtools.md) | Dev-only Router/Query panels for local debugging; packages partially wired today |
| IDEA-004 | Command palette data copy / export / import | frontend | medium | 2026-06-23 | [detail](./ideas/IDEA-004-command-palette-data-transfer.md) | Granular JSONL + clipboard commands; plan ready — channels phase 1 |
| IDEA-005 | Command palette channel ops & search | frontend | medium | 2026-06-24 | [detail](./ideas/IDEA-005-command-palette-channel-ops-search.md) | Add/delete/sync channel, search posts/summaries; freeze/unfreeze already done |
| IDEA-006 | Command palette extended commands | frontend | medium | 2026-06-24 | [detail](./ideas/IDEA-006-command-palette-extended.md) | Reset sync, tags, semantic search, tor/AI/DB quick actions |
| IDEA-007 | Command palette keyboard UX | frontend | medium | 2026-06-25 | [detail](./ideas/IDEA-007-command-palette-keyboard-ux.md) | Full keyboard operability for all palette modes and chained flows |
| IDEA-008 | Thumbnail cache size walk per channel | backend | medium | 2026-07-20 | [detail](./ideas/IDEA-008-thumbnail-cache-walk-per-channel.md) | Full stat-walk of the cache dir after every channel scrape; caught live via py-spy |
| IDEA-009 | pgvector for RAG search | backend | medium | 2026-07-21 | [detail](./ideas/IDEA-009-pgvector-for-rag.md) | Search still scores a capped window in Python; recall degrades silently as the corpus grows |
| IDEA-010 | Shared paginated-list helper | backend | medium | 2026-07-21 | [detail](./ideas/IDEA-010-shared-paginated-list-helper.md) | The pattern is now copy-pasted 4×; this duplication is why the `stats.py` bulk-delete fix never reached `logs.py` |
| IDEA-011 | Discover tab refinement | full-stack | medium | 2026-07-29 | [detail](./ideas/IDEA-011-discover-tab-refinement.md) | Survey doc — 14 proposals (D1–D14) in 8 workstreams; pick a workstream, not the whole doc. **W1 is designed and agreed**: Discover reports become saved artifacts modelled on summaries |

## In progress

| Id | Title | Started | Owner / session | Detail |
|----|-------|---------|-----------------|--------|
| IDEA-001 | Frontend command palette (fuzzy command line) | 2026-06-23 | command palette implementation | [detail](./ideas/IDEA-001-command-palette.md) — cmdk + shadcn; full settings + channel flows + recents/affinity |
| IDEA-006 | Command palette extended commands | 2026-06-24 | extended commands batch | [detail](./ideas/IDEA-006-command-palette-extended.md) — ~30 ops commands |

## Done

| Id | Title | Completed | Outcome |
|----|-------|-----------|---------|
| IDEA-003 | Proxy-bound worker pool | 2026-06-22 | Per-proxy lane semaphores gate proxied HTTP; sync concurrency capped by pool capacity; settings + runtime-config diagnostics |

## Parked

| Id | Title | Parked | Reason |
|----|-------|--------|--------|
| — | *None* | — | — |
