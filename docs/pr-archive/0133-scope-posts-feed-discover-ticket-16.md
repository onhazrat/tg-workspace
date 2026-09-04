# #133 🔒 Scope Posts, feed, Discover (ticket 16)

**State:** merged 2026-08-25 · **Branch:** `worktree-ticket-16-scope-posts-feed-discover` into `main` · **Diff:** +1081 / -74 across 24 files · **Opened:** 2026-08-25

---

With `TENANCY_ENFORCED` on, `list_feed`, `lookup_posts`, `count_posts_in_scope` and `compute_discover_candidates` return only Posts under Channels the caller Follows; while it's off, `scoped_select` is a no-op and nothing changes. All four take a required keyword-only `user_id`, threaded from `CurrentUser` through `routes/data/posts.py`, `routes/data/discover.py`, `prompt_assembly` and `ai_routes`.

The Post select was the easy half. Two things weren't:

**`list_feed` has two query shapes.** With a per-channel cap it wraps the base select in a `row_number()` subquery, so the predicate has to land inside that subquery or the window ranks rows the caller can't see and the cap is computed over the wrong set.

**Four modules each had their own `select(Channel.name)`** answering "do I follow this handle?" — the `unfollowed_forwarded` filter (feed and counts), Discover's `isFollowed`, and a saved report's live `isFollowed`. Unscoped, that reports a candidate as already followed because *another account* follows it. They're now one function, `follows.visible_channel_names`, named for what it returns while the flag is off.

Handle probes stay corpus; `probe_map`, `list_probes` and `queue_counts` say so at the call site through `unscoped_select` with a shared `PROBE_SCOPE_REASON`.

`create_report` lost its `user_id=None` default — it now picks the aggregation's scope as well as stamping the row, and resolving a missing owner through `get_operator_user_id` is the NULL fallback decision 24 dissolves.

## Review round

`/code-review high` found the fourth `select(Channel.name)`, in `discover_reports.followed_names`. It runs *after* the aggregation and overwrote the scoped answer, so under enforcement `POST /discover/reports` and `POST /discover/candidates` would have returned different `isFollowed` for byte-identical input. Both the ticket text and the CLAUDE.md paragraph said "three copies"; they were wrong, because every test stopped at the aggregate. Fixed, with a regression test. Same review found `probe_map` left unmarked while the guard only counted `unscoped_select` calls instead of naming functions, and a cwd-relative path in that guard.

## Deliberately not here

Dismissed candidates (`tg_discover_ignored`) stay global. The table is keyed by `handle` alone, so per-account dismissals need a composite-PK migration plus a backfill. Scoping only the read would break the feature rather than leave it: `ignore_channels` skips a handle that already has a row, so once A dismisses `@foo`, B's dismissal writes nothing and a scoped read would tell B it isn't dismissed — B could never dismiss it. Recorded in the ticket; **no ticket currently owns it**.

Also out: RAG vector search (already channel-restricted through the legacy `operator.py` filter, ticket 22's cleanup), background jobs with no caller to scope to, and saved-report reads (ticket 17).

## Verification

22 tests in `tests/services/test_post_tenancy_scoping.py` covering both flag states for each read, the capped-feed branch, two followers of one handle both keeping their posts, the `followed`-set behaviours, probes shared in both states, and a signature guard. **Eight mutations applied, all eight watched go red** before the guards were trusted.

Full backend suite 1402 passed, 2 pre-existing skips, 0 failed. `mypy`, `ruff`, `ty` clean; all pre-commit hooks green. Generated OpenAPI byte-identical to the committed one, so the frontend and generated client are untouched.

🤖 Generated with [Claude Code](https://claude.com/claude-code)

https://claude.ai/code/session_01SMdmvvut6RiZqcvD6QFtUf


## Comments

### onhazrat on 2026-08-25

Added `c43479a`: files ticket 30 (per-account Discover dismissals) and marks ticket 21 blocked by it.

This is the deferral ticket 16's write-up promised, made concrete rather than left as a note. The ticket states why scoping only the read is worse than leaving the table alone — `ignore_channels` skips a handle that already has a row, so once one account dismisses a handle a second account's dismissal writes nothing, and a scoped read then tells them it is not dismissed. The key and the read have to move together.

Ticket 21's file also now records the other thing 16 left for its fifth checkbox: `operator.py`'s `select_operator_channels` null-owner filter is still live and still reached by `routes/rag.py`.

Markdown only — no code, no tests affected.
