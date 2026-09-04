# #72 ♻️ H1+H2: decompose the sync-path god-functions into named stages

**State:** merged 2026-08-01 · **Branch:** `h1-decompose-sync-path` into `main` · **Diff:** +663 / -358 across 3 files · **Opened:** 2026-08-01

---

Workstream `H` from `docs/architecture-simplification-plan.md`.

| function | before | after |
|---|---|---|
| `_apply_scrape_page` | 258 | **120** |
| `sync_single_channel` | 206 | **110** |
| `import_data` | 211 | **~30** (largest section importer: 63) |

## Named stages, not line slices

Per the rule in `CLAUDE.md`. New functions: `_reconcile_telegram_chat_id`, `_freeze_channel_for_chat_id_problem`, `_refresh_channel_meta`, `_persist_page_posts`, `_collect_new_forwards`, `_decide_next_page`, `_fetch_one_page`, `_walk_channel_pages`, plus seven per-section importers.

## `_ChannelWalk` is passed *in*, not returned

Both `except` handlers in `sync_single_channel` need `requests_log` / `responses_log` **even when the walk raises part-way through**. Returning the state would lose exactly the diagnostic payload those error logs exist to carry.

## Two subtleties preserved — and now documented

Both were invisible in the original nesting:

1. **The chat-id *conflict* branch freezes the channel but does _not_ stop the sync**; the *mismatch* branch does. Easy to "tidy" into symmetry and change behaviour.
2. **The `needs_backfill` transition genuinely appears twice.** An incremental pass can end either by *meeting* stored posts (`break_incremental`) or by simply running out of new ones (`stop_sync`), and a channel with a gap below its stored history must switch passes in both cases.

## Tests were not touched

`git diff --stat -- tests/` is **empty** — that was the contract for this unit. The plan's rule was: if a test needs changing, the refactor changed behaviour, so stop and reconsider. None did.

## The `< 80` target is deliberately not met

`_apply_scrape_page` is 120 lines and is now a readable sequence of named stages. Cutting further would be the line-slicing the rule explicitly forbids.

Worth recording: **the largest backend function is now `jobs/retention.py::run_retention_cleanup` at 174** — never in H1/H2's scope. If the metric matters, that's the next target, not more cuts here.

## Verification

| Check | Result |
|---|---|
| backend suite (isolated DB) | **784 passed / 2 skipped** |
| `tests/` diff | **empty** |
| mypy strict | clean, 124 files |
| ruff check / format | clean |

🤖 Generated with [Claude Code](https://claude.com/claude-code)
