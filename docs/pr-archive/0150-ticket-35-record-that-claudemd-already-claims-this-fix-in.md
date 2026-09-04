# #150 📋 Ticket 35: record that CLAUDE.md already claims this fix in the past tense

**State:** closed 2026-08-29 · **Branch:** `worktree-ticket-35-prose-drift` into `main` · **Diff:** +36 / -0 across 1 files · **Opened:** 2026-08-28

---

Records a documentation discrepancy on ticket 35's file. Documentation only — no code, no tests, no migration.

## What it is

CLAUDE.md line 67 states that the three unscoped reads ticket 35 covers **already** go through the tenancy seam:

> They now go through `scoped_select` with `user_id` as a **required keyword**

They do not. Verified against `origin/main` at `314307c`:

- `backend/app/services/channel_setting_groups.py` contains **no reference to `scoped_select`**. `list_setting_groups` (line 743) and four other call sites still use `_operator_group_scope_filter` (line 188) — the hand-rolled `user_id == me OR user_id IS NULL`.
- `backend/app/services/scraper_jobs.py::_running_job_from_row` (line 654) still selects the oldest non-terminal `SyncJobRow` with no owner predicate.

`git blame` puts the sentence in `22b06c35`, ticket 32's merge. The same paragraph that correctly warns *"Do not read ticket 32 as an all-clear for `app/`"* becomes exactly that all-clear one clause later.

## Why it needed writing down

Ticket 35 is unassigned. Its implementer reads CLAUDE.md, finds their deliverable described in the past tense, and either concludes the ticket is stale or — worse — treats the trailing claims about a required keyword and a flag-off guard as existing behaviour to preserve rather than as work to do. Neither exists.

The ticket now says reconciling that paragraph is part of the work, and that those sentences are its **specification, not its status**. The fix is to do the work, not to soften the prose.

## Provenance

Flagged by a peer session while it was picking up ticket 34; I verified it independently against `main` before recording. This is the decay CLAUDE.md's own guard section warns about — it cites the `BaseModel`-in-a-route-module rule going three modules stale. One day elapsed here.

🤖 Generated with [Claude Code](https://claude.com/claude-code)

https://claude.ai/code/session_015sT3u1i9aTtYfkfxHkuE2o



## Comments

### onhazrat on 2026-08-29

Closing as obsolete — ticket 35 landed in #154 (`258b7b9`) and reconciled the prose this PR existed to warn about.

This PR appended a section to ticket 35's file saying CLAUDE.md described its fix in the past tense before the fix existed. That is now false in both halves: `scoped_select` appears 7 times in `channel_setting_groups.py` on main, `_job_is_visible_to` is in `scraper_jobs.py`, and CLAUDE.md's claim is no longer ahead of the code. Merging it now would inject a stale warning into a completed ticket.

It did its job in the meantime — the content was hand-delivered to ticket 35's implementer while their base predated this branch, which is what the PR was for.
