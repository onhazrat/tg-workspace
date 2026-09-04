# #138 🔒 Per-account Discover dismissals (ticket 30)

**State:** merged 2026-08-26 · **Branch:** `worktree-ticket-30-per-account-discover-dismissals` into `main` · **Diff:** +862 / -102 across 10 files · **Opened:** 2026-08-26

---

Closes ticket 30 — the last blocker on ticket 21, the enforcement acceptance gate.

`tg_discover_ignored` was keyed by `handle` alone, so the first account to dismiss a candidate dismissed it for everybody.

## Why this could not be a scoped read

`ignore_channels` skips a handle that already has a row. Scope only the read and once A dismisses a handle, B's write is a no-op **and** the scoped read then reports the handle as not dismissed — B can never dismiss it and the button silently does nothing. That is a functional regression, not a visibility one, so the key, the reads and the writes move together.

* composite primary key `(handle, user_id)` with a real cascading FK
* every function in the aggregate takes a required `user_id`, no default
* both places `isIgnored` is computed answer for the viewer — live candidates and saved reports
* `unignore_channels` resolves the full composite key, so undoing can no longer delete another account's row and report success for it

## The one family whose filter is not `scoped_select`

Deliberate, and argued in the module docstring. The seam's filter is gated on the flag because it answers *visibility*; the owner here is part of the primary key, so filtering on it answers *identity* — which row is yours — and a flag cannot gate identity. Gated off, two accounts collide on one row again and the composite key is decoration.

Every guard is parametrised over **both** flag states, which is the ticket's fourth checkbox. Mutation-tested: gating the filter behind the flag fails only the flag-off variants (5 of them) while every flag-on variant still passes — precisely the shape of the half-fix the ticket refuses.

## Migration

Settles owners rather than deferring them, since a composite key cannot hold NULL. A NULL stamp and an id left behind by a deleted account get the same answer (the operator, by `resolve_follow_owner`'s rule); a live owner is kept. Completes in one pass — alembic never re-runs a stamped revision, so nothing is left "for the next deploy".

All branches verified against seeded legacy rows, not just round-tripped, including the orphan case that would otherwise abort the FK creation.

## From review

* The no-owner branch **raises instead of deleting**. The first cut dropped every row when no owner resolved and justified it in prose; nothing checked it. Since ticket 18 moved authorisation onto RBAC roles, nothing reads `is_superuser`, so clearing it breaks nothing visible until this migration reads it as "no accounts exist". It now counts first and refuses, naming the fix.
* `unignore_channels` credited the type checker with a check it does not perform — the composite key does **not** break the build, it fails at runtime. The docstring now points at the test that actually holds it.

## Verification

* backend: 1585 passed, 2 skipped
* dismissal family: 29 passed under **both** flag states
* frontend: typecheck clean (both conform guards compile), 882 unit tests pass
* `mypy`, `ty`, `ruff check`, `ruff format --check` all clean
* client regenerated — **no diff**, the wire shape is unchanged

🤖 Generated with [Claude Code](https://claude.com/claude-code)

https://claude.ai/code/session_01RBTWnZzoqsqzjsFFsrJ7WT
