# #154 🔒 Scope setting groups and sync jobs (ticket 35)

**State:** merged 2026-08-29 · **Branch:** `ticket-35-scope-setting-groups` into `main` · **Diff:** +1177 / -130 across 12 files · **Opened:** 2026-08-29

---

Closes ticket 35. With ticket 34 merged, this is ticket 21's last remaining blocker.

## The three reads

Ticket 32 called its own work "the last unscoped read family in `app/`" and was wrong. These are what remained, all `USER_OWNED` in `SCOPES`, none going through the seam.

**`list_setting_groups`** hand-rolled `user_id == me OR user_id IS NULL`. That filter narrowed in **both** flag states, which is the one thing a seam adoption may not do — it is what let ~40 other read paths migrate without any of them moving a response. It now goes through `scoped_select`, so flag-off becomes **unfiltered**. That decision was confirmed before implementing, on ticket 17's precedent for `/data/artifacts` and for its reason: a single-operator deployment has one account, so the widening is invisible where it ships, and keeping `me OR NULL` leaves a fifth NULL rule for ticket 21 to reconcile against four that already disagree with it.

Its orphan rescue moves off `operator.distinct_operator_setting_group_ids`, which hand-rolled the same shape over `Channel.user_id` — a column ticket 22 deletes. It is now an EXISTS against the follow table. The old helper is **deleted**, not left beside the replacement.

**`load_groups_by_id`** stays unscoped, through `unscoped_select(reason=...)` rather than a bare `select`. All seven call sites do `groups_by_id.get(channel.setting_group_id)` for a channel already scoped, so a second filter hides nothing from anybody — it blanks the *policy* of a channel you legitimately follow, and three call sites read a missing group as "skip this channel". Scoping it would silently drop followed channels out of auto-sync. It deliberately takes no `user_id`, because an ignored parameter decays into a used one.

**`_running_job_from_row`** is not the whole `SyncJob` fix. `get_active_sync_job_summary` *prefers* `_active_jobs` and only falls back to the row, so scoping the function the ticket names leaves the preferred path answering across accounts — on the worker, the one process where that dict is populated. `_job_is_visible_to` covers it, restating `scoped_select`'s rule against a dict because the seam cannot reach process memory.

## Four write doors, found by auditing the reads

None of these had an owner check of any kind, all behind plain `CurrentUser` routes with client-visible ids:

- `update_setting_group` — rename another account's group and recompute `next_regular_sync_at` for every channel in it
- `delete_setting_group` — delete it
- `bulk_assign_setting_group` — govern your own channels by their policy row
- `_import_channels` — attach an imported channel to their group (the fourth, found after the first three were closed)

The first three take the **ungated** `assert_owner_on_write`, so nothing moves on a one-account deployment while the clobber closes on one that has two. The import takes `may_act_on` and **falls through to the caller's default** rather than raising: an import is one transaction, and aborting a whole restore over a field a document can be wrong about is worse than the branch that already existed for an absent group.

## Two things deliberately not adopted

`_job_is_visible_to` must **not** use `may_act_on` — it ignores the flag on its non-NULL branch, so it would narrow a response while enforcement is off. The first cut did exactly that and ticket 33's declared-caller list caught it, quoting this case in its error message.

What survives of the old setting-group filter answers **identity**, not visibility: whether a *name* is taken, mirroring the unique index `(COALESCE(user_id::text, 'global'), lower(name))`. Ticket 30's rule — a flag cannot gate identity. `scoped_select` there would make a duplicate name stop being rejected while the flag is off and arrive as a Postgres `UniqueViolation` instead of the route's 409.

## Verification

- `tests/services/test_setting_group_and_job_scoping.py` — 35 tests, both flag states throughout
- **Ten mutations watched go red**, each on the test its docstring names. The gated-guard mutation fails **only** the flag-off variants, which is the half-fix signature ticket 31 describes
- Full suite **1912 passed, 2 skipped**; `mypy`, `ty check`, `ruff check`, `ruff format --check` all clean
- No frontend client change — the generate-frontend-sdk hook passed

## Left for ticket 21

Two row shapes enforcement makes invisible, both pinned as tests rather than left to be discovered: ownerless setting groups (a fresh install migrates before its first superuser exists, so ticket 34's backfill could not adopt the presets) and ownerless `SyncJob` rows (the scheduler still creates them without an owner). Both are the requirement ticket 34 already filed — eliminate the `user_id=None` creation paths before flipping the flag, rather than merely flipping it.

🤖 Generated with [Claude Code](https://claude.com/claude-code)

https://claude.ai/code/session_01GDXDdkcWtQ1LEo7EHfaK2k
