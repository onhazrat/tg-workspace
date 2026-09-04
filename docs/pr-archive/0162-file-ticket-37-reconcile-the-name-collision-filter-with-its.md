# #162 📋 File ticket 37: reconcile the name-collision filter with its unique index

**State:** merged 2026-08-31 · **Branch:** `worktree-ticket-37-file` into `main` · **Diff:** +119 / -0 across 2 files · **Opened:** 2026-08-31

---

Files ticket 37 for a requirement that ticket 22 left pointing nowhere. Documentation only — one ticket file and its docs-index entry, no code.

## What it is

`services/channel_setting_groups.py::_name_collision_scope_filter` (line 213) mirrors the unique index `(COALESCE(user_id::text, 'global'), lower(name))` on `tg_channel_setting_groups`, and is deliberately **wider** than it — `me OR NULL` rather than exactly the caller's scope. Its docstring says why, then says who fixes it:

> Ticket 22 can reconcile the two once the global rows are gone.

**Ticket 22 did not make the global rows go away.** It dropped `Channel.setting_group_id` — the Channel's *pointer* at a group — not the global setting-group rows. Ticket 34 deliberately left those: a fresh install migrates before its first superuser exists, so there is no account to adopt them to.

Ticket 22's implementer corrected the CLAUDE.md line rather than leave it pointing at themselves, which was the right call and is why this needs a ticket — the requirement now points nowhere, and `channel_setting_groups.py:236` still names ticket 22.

## Why it is not cosmetic, and not urgent

The filter and the index disagreeing means a band of names the application believes are free and the database refuses — a 500 carrying a `UniqueViolation` where the route has a 409 ready. Same class as ticket 34's migration collision, arriving through a request instead of a deploy.

It is currently **masked**: while the global rows exist, the wider filter catches the collision first and answers 409 correctly. Narrowing it without settling the rows would *unmask* the problem rather than fix it — so the docstring's sequencing is right even though its ticket number is wrong.

## The ticket does not pick

Three options, with the loser required to be written down: adopt the preset rows at first-superuser creation (where ticket 34 could not reach, since `init_db` runs after `alembic upgrade head`); narrow the filter to match the index exactly and accept that previously-blocked names become usable; or leave both and delete the promise, recording the mismatch as permanent and masked. The third is defensible and beats a pointer that keeps moving from ticket to ticket.

Ticket 30's rule is pinned as a constraint: the owner in a key answers *which row is yours*, so this filter must not consult `tenancy_enforced()` or become `scoped_select`.

## Also carried

Ticket 22's review found `PUT /data/channels/{id}` is also the follow-an-existing-channel path — its first cut 500'd for an account with no follow, caught by `test_account_isolation.py`. Fixed there, but nothing says so at the handler: it reads as an edit and is also a create. One paragraph of prose, so it rides in this ticket rather than getting its own.

🤖 Generated with [Claude Code](https://claude.com/claude-code)

https://claude.ai/code/session_015sT3u1i9aTtYfkfxHkuE2o
