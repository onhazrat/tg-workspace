# 35: Scope setting groups and sync jobs (migrate 7)

**What to build:** The last three unaudited `USER_OWNED` reads go through the seam,
so the flag decides what they return rather than a hand-rolled filter.

**Blocked by:** 03

**Blocks:** 21

**Status:** done

- [x] `list_setting_groups` reads through `scoped_select` instead of its own owner filter
- [x] `load_groups_by_id` is scoped, or excused at the call site with a written reason
- [x] `_running_job_from_row` answers `GET /jobs/runtime-config` for the caller, not across accounts
- [x] Each takes a `user_id` with no default
- [x] Both flag states are green — and the flag-off responses are byte-identical to today's, with one deliberate exception argued below

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

## What landed

`tests/services/test_setting_group_and_job_scoping.py` (33 tests, nine mutations
watched go red), plus the guard-table row and the CLAUDE.md paragraph that had
been describing this ticket in the past tense since ticket 32's merge.

**The flag-off decision, taken deliberately: unfiltered.** `list_setting_groups`
now returns every group while the flag is off and `user_id == me` under
enforcement. Ticket 17's precedent, for its reason — a single-operator deployment
has one account, and preserving `me OR NULL` would have left a fifth NULL rule
for ticket 21 to reconcile against four that already disagree with it. Note this
is the *old* code changing a response, not the new: `me OR NULL` narrowed in both
states, which is what the batching rule forbids.

`load_groups_by_id` is **excused**, through `unscoped_select(reason=...)` rather
than a bare `select`. Scoping it hides nothing from anyone — every call site
resolves ids it already holds from scoped rows — and three of the seven read a
missing group as "skip this channel", so a scoped map silently drops followed
channels out of auto-sync. It takes no `user_id`, because an ignored parameter
decays into a used one.

Three things the ticket did not anticipate.

* **The `SyncJob` fix is not the function the ticket named.**
  `get_active_sync_job_summary` prefers `_active_jobs` and only falls back to
  `_running_job_from_row`, so scoping the fallback alone leaves the preferred
  path unscoped on the worker — the one process where that dict has anything in
  it. `_job_is_visible_to` covers it. It must **not** use `may_act_on`: that
  ignores the flag on its non-NULL branch, so it narrows a response while
  enforcement is off. The first cut used it and
  `test_auto_publish_scoping.py`'s declared-caller list caught it, quoting
  exactly this case in its error message.

* **Three by-id writes on the same table had no owner check at all.**
  `update_setting_group`, `delete_setting_group` and
  `bulk_assign_setting_group`, all behind plain `CurrentUser` routes: rename
  another account's group and reschedule every channel in it, delete it, or
  govern your own channels by their policy row. Confirmed as in scope before
  implementing. They take the **ungated** `assert_owner_on_write`; the mutation
  swapping in the gated `assert_owner` fails only the flag-off variants.

* **The scraper was a fourth caller of `bulk_assign_setting_group`.**
  `sync_orchestrator`'s chat-id freeze. The per-channel move is now
  `apply_group_to_channel`, called directly, because the freeze resolves its
  group from the Channel's own owner rather than from a client-chosen id — and
  routing it through the user-facing door would also have made it 404 whenever
  the channel is not operator-scoped.

`operator.distinct_operator_setting_group_ids` is **deleted**, not left beside
the replacement: it hand-rolled `Channel.user_id == me OR IS NULL`, and `Channel`
is `FOLLOW_SCOPED` with that column going away in ticket 22.

## Left for ticket 21

Two rows shapes that enforcement makes invisible, both pinned as tests rather
than discovered later:

* **Ownerless setting groups.** A fresh install migrates before its first
  superuser exists, so the three built-in presets carry no owner and ticket 34's
  backfill could not adopt them. They vanish from the list under enforcement.
* **Ownerless `SyncJob` rows.** The scheduler still creates them without a
  `user_id`, so `activeSyncJob` reports nothing for an auto-sync under
  enforcement — the same answer from both the row read and the in-memory
  filter, deliberately.

Both are the same requirement ticket 34 already filed: **eliminate the
`user_id=None` creation paths before flipping the flag**, rather than merely
flipping it.
