# 35: Scope setting groups and sync jobs (migrate 7)

**What to build:** The last three unaudited `USER_OWNED` reads go through the seam,
so the flag decides what they return rather than a hand-rolled filter.

**Blocked by:** 03

**Blocks:** 21

**Status:** ready-for-agent

- [ ] `list_setting_groups` reads through `scoped_select` instead of its own owner filter
- [ ] `load_groups_by_id` is scoped, or excused at the call site with a written reason
- [ ] `_running_job_from_row` answers `GET /jobs/runtime-config` for the caller, not across accounts
- [ ] Each takes a `user_id` with no default
- [ ] Both flag states are green — and the flag-off responses are byte-identical to today's

## Why this is its own ticket

Ticket 32's file claimed it closed "the last unscoped read family in `app/`".
**That was wrong**, and its author corrected it in four places — the ticket file,
the docs index, `CLAUDE.md` and the guard test — while flagging that ticket 21
must not read ticket 32 as an all-clear. These three are what remain. All are
`USER_OWNED` in `SCOPES`; none goes through the seam.

**`list_setting_groups` is the one that matters most**, and not for the obvious
reason. It hand-rolls `user_id == me OR user_id IS NULL` over
`ChannelSettingGroup` via `_operator_group_scope_filter(operator_id)` — and that
filter **narrows in both flag states**. Every other adoption in this programme was
a no-op while the flag was off, by construction: that is what let ~40 read paths
migrate one batch at a time without any batch changing a response. This one is
already narrowing on the shipping config, which is the exact failure the seam's
batches forbid, and it is doing it with a NULL rule that no other family uses.
Two owner filters with different NULL handling is the drift `tenancy.py` exists to
prevent — it surfaces as a group visible in one view and absent from another.

**`load_groups_by_id` reads the same table with no filter at all.** A scoped list
over an unscoped by-id read is ticket 17's half-fix in miniature.

**`_running_job_from_row` reads `SyncJob` across accounts** to serve
`GET /jobs/runtime-config`. `SyncJob` is `USER_OWNED`; a runtime config assembled
from whatever job happens to be running belongs to whoever is running it.

## The flag-off behaviour is the hard part

For the two setting-group reads, "adopt the seam" is not merely wrapping the
statement: the existing filter already narrows, so a naive `scoped_select` swap
**widens** the flag-off response — the seam is a no-op while off, and today's
filter is not. Decide deliberately whether flag-off should keep today's narrowed
answer or return to unfiltered, and write down which. Ticket 17 faced the same
question on `/data/artifacts` and chose to change the flag-off response
deliberately, confirmed before implementing, on the grounds that a
single-operator deployment has one account and the alternative left a fifth NULL
rule for ticket 21 to reconcile. That precedent is available; it is not
automatically the right answer here.

## Not in scope

Backfilling owners is ticket 34. Flipping the flag is ticket 21. Dropping
superseded columns is ticket 22.
