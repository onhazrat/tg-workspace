# #152 📋 Ticket 21: record the three preconditions ticket 34 hands it

**State:** closed 2026-08-29 · **Branch:** `worktree-ticket-21-preconditions` into `main` · **Diff:** +53 / -8 across 2 files · **Opened:** 2026-08-28

---

Records what ticket 34 hands to ticket 21, and marks 34 done in the docs index. Documentation only — no code, no tests, no migration.

## Verified before recording

Ticket 34's completion claim, checked independently rather than taken on report:

- PR #151 **MERGED** as `3f4386e1`, `verification.verified = true`, on `origin/main`
- Ticket file `Status: done`, zero unticked checkboxes
- `backend/app/alembic/versions/c0d1e2f3a4b5_backfill_owners_ticket_34.py` present
- `tenancy.owner_backfill_inventory()` at `tenancy.py:279`; guard `tests/services/test_owner_backfill.py` present
- CLAUDE.md carries both the bullet and the guard-table row
- Staging deploy run `33163647428` completed/success for that sha

## The three preconditions

**1. The columns stay nullable, so unowned rows keep appearing.** Every log `upsert_*` takes `user_id` as optional and the scheduler creates `SyncJob` rows with none. 34 settles the rows that existed against a schema that still permits new ones.

**2. A fresh install keeps its global setting-group presets, and they are still reachable.** Ticket 34's first draft claimed nothing could reference them; that was wrong, and I confirmed the correction on `main`: `ensure_default_group(session, *, user_id: uuid.UUID | None)` is called from `channels.py:408` and `followed_channels.py:107`, and auto-follow passes `user_id or channel.user_id` — `None` whenever the Channel is itself unowned.

**This is scope ticket 21's checkboxes do not name**: it has to eliminate the `user_id=None` creation paths *before* flipping the flag, not merely flip it.

**3. `tg_channel_setting_groups` cannot be stamped naively.** Its unique index on `(COALESCE(user_id::text, 'global'), lower(name))` — the only non-key unique index on any of the fourteen tables — turns the obvious `SET user_id = <operator>` into a `UniqueViolation`. Inside `alembic upgrade head` that aborts the migration, and since `prestart.sh` runs under `set -e` with backend and worker gated on `service_completed_successfully`, it stops the deploy rather than degrading.

`/code-review` caught that after a green suite and an open PR. Ticket 34's own guard could not: its seeder invents a unique name per row, so the index was structurally unreachable from the test. **A guard that exercises a statement's predicate says nothing about the constraints that statement has to satisfy.** Tickets 35 and 22 both touch this table, so the note carries the lesson to them.

## Also

Ticket 21's `Blocked by` line annotates 34 as done — 35 remains its only open blocker.

🤖 Generated with [Claude Code](https://claude.com/claude-code)

https://claude.ai/code/session_015sT3u1i9aTtYfkfxHkuE2o



## Comments

### onhazrat on 2026-08-29

Superseded by #155, which rebases this onto `258b7b9` now that ticket 35 has landed.

This branch predated ticket 35, so it still listed 35 as a blocker on ticket 21 and carried three preconditions. #155 carries all of this plus ticket 35's two, marks both 34 and 35 done in the docs index, and states the requirement the five share.
