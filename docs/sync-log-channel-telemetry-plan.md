# Sync logs become Channel telemetry (ticket 19)

**Blocked by:** 03 (the seam), 04 (the follow table). Both landed.
**Blocks:** 21, the enforcement acceptance gate, along with 20 and 30.

A sync log answers "did this Channel deliver Posts, and if not why not". That is a fact about the
Channel, not about whoever happened to trigger the scrape, and the second follower of a handle has
exactly as much right to it as the first. Today `SyncLog` is `USER_OWNED` in the seam, so the moment
ticket 21 flips `TENANCY_ENFORCED` the second follower gets an empty Logs tab for scrapes that ran on
their behalf.

Plan decision 22 states it directly: `SyncLog` is channel telemetry, visibility follows "do you
follow this channel", and a nullable owner meaning "scheduled" resurrects the `operator.py` ambiguity
and fails open on a forgotten stamp.

## What changes

### The classification

`SyncLog` moves from `Scope.USER_OWNED` to `Scope.FOLLOW_SCOPED`, keyed on `channel_name`. That is the
same key the four other corpus tables use, and `scoped_select` already joins it through `tg_channels`
name-to-name rather than comparing a foreign key to it, because `Channel.name` is writable and
diverges from `Channel.id` the moment somebody renames a channel.

`SyncLogPayload` moves with it. A payload table takes its parent's scope, which is what
`SummaryPayload` and `ChatSessionPayload` already do, and a child claiming an owner its parent does
not have is the drift the seam exists to prevent.

### The payload table gains `channel_name`

`tg_sync_log_payloads` has no channel column, and the seam's guard requires every follow-scoped model
to declare a real one. So the column is added and backfilled from `tg_sync_logs`.

Denormalising from the parent is the pattern that table already follows and says so in its own
docstring: `timestamp` is there for the same class of reason, so the payload sweep stays a
single-table bulk DELETE instead of joining the whole log table. `channel_name` earns its place the
same way, and ticket 20 needs it when log retention splits.

`ADD COLUMN` with no default is instant on PostgreSQL 11+. The backfill is an `UPDATE ... FROM`, and
the table is small relative to `tg_sync_logs` because payloads expire on a shorter horizon.

### Sync logs stop carrying an owner

`upsert_sync_log` accepts a `user_id` and no longer writes it, on either row. The parameter stays
because `_LOG_IMPORTERS` in `data_import_export.py` dispatches all five log types through one uniform
`(session, item, user_id)` signature, and ticket 22 removes the column and the parameter together.

An ignored parameter decays, so the ignoring is asserted rather than incidental: a guard passes a real
user id to `upsert_sync_log` and requires the stored row to carry `None`.

### Who may delete one sync log row

`DELETE /data/logs?type=sync&logId=...` gains the `DATA_ADMIN` gate the two purge branches already
have. The other four types keep answering to their owner through `get_log`.

Ticket 18 deliberately left the single-row branch ungated, with the reasoning that "one row of your
own is not an administrative act". Once the row is shared telemetry, that sentence points the other
way: a follower deleting it destroys evidence belonging to every other follower, which is precisely
what ticket 20's own checkbox forbids. The same argument ticket 05 made for unfollow rather than
delete.

The Logs tab keeps its delete button. The frontend has no permission model to hide it with (ticket 18
established the pattern of gating the route and fixing `isAuthFailure` rather than building
permission-aware UI), and the only account on a single-operator deployment holds `DATA_ADMIN`
already.

### Who may write one

`create_logs` calls `assert_owner` on an existing row, which ticket 18 added to close a takeover hole:
without it a caller posting another account's log id overwrites that row and becomes its owner.

`assert_owner` on an ownerless row does not merely stop working, it fails closed and refuses
everything, because `owner_id is None` raises once the flag is on. So sync gets two rules instead.
You may write telemetry for a Channel you follow, and through this door the write is **create-only**:
an id that already names a row is refused rather than merged.

The create-only half came out of review, and it matters. Checking that the caller can *see* the row
it is about to flatten is not a check that it may flatten it. Two accounts following the same handle
both pass every visibility check, and `upsert_sync_log` then overwrites `status`, `error`,
`posts_count` and the bodies, so one Follower rewrites telemetry the other reads. The route gates the
single-row delete on `DATA_ADMIN` because destroying that record is not one Follower's to do, and an
overwrite destroys the same record.

The channel-name comparison is exact, not case-folded. `follows.visible_channel_names` lowercases for
handle matching, but `scoped_select` emits `tg_channels.name = tg_sync_logs.channel_name`, so a
case-insensitive write guard would accept a row the read scope could never match: invisible to
everyone including whoever wrote it. A write guard looser than the read scope manufactures unreachable
rows rather than merely failing to protect.

The internal writers are unaffected. `sync_orchestrator` mints a fresh uuid per attempt and
`data_import_export` calls `upsert_sync_log` directly; `create_logs` is only the API's door, and
`saveSyncLog` in the frontend is exported and called by nothing.

### Collection takes them too

`collect_unfollowed_channel` reclaims the rows that do not cascade when retention takes a Channel
nobody follows. The two sync-log tables just joined that group, so they are collected through
`logs.collect_channel_sync_logs`, called the way `clear_channel_sync_state` already is, so the
aggregate that owns those tables stays their only writer.

Stranding them is worse than stranding posts. Once the `tg_channels` row is gone there is no Follow
for the EXISTS to reach, so the rows are invisible to every account and still on disk, and they are
the heaviest tables in the schema. `logRetentionDays` is the only other thing that would take them,
and the sweep skips log retention entirely when that window is 0.

### The legacy stamps are cleared

The migration nulls `user_id` on both sync tables. `upsert_sync_log` stops writing it, but three
sweeps still read it as `user_id = :operator OR user_id IS NULL`: `run_retention_cleanup`,
`delete_old_logs`/`expire_sync_payloads_stmt`, and `stats._scoped_count`/`_scoped_delete`. A row
stamped with some *other* account before the upgrade matches none of them ever again, so it would be
excluded from every sweep and from `syncLogCount` permanently while the Logs tab kept showing it.
Visible, uncountable and unreclaimable is the worst of the three states.

Verified against a clone of the real dev database: 2,940 stamped rows, all nulled, all payloads
backfilled, zero name mismatches against their parent.

### Search

`list_logs` dispatches through `scoped_select` by model class, so the follow predicate lands on the
list, the search and the `searchInDetails` payload semi-join without any of them naming a scope. The
predicate still goes on before the ordering, the offset and the limit.

The payload subquery inside `_log_search_clause` stays unscoped on purpose: it is semi-joined into a
statement that is already narrowed to visible logs, so scoping it twice would cost a second EXISTS
over the corpus for no change in the result.

## The wire format does not change

`SyncLogResponse` and `SyncLogListItemResponse` never carried `userId`. The generated client, the
OpenAPI document and the frontend are untouched, and the only observable difference on a
single-operator deployment is that a non-Admin can no longer delete one sync log row, which no
non-Admin account exists to notice yet.

## Guards

`tests/services/test_sync_log_channel_telemetry.py`, in both directions:

1. With the flag on, a follower of a Channel sees its sync logs even though another account produced
   them, and a non-follower does not.
2. `get_log` answers 404 for a log on an unfollowed Channel, with the string an absent row gets.
3. Search and `searchInDetails` return the same follow-scoped set, so the bodies stay findable
   without becoming a way around the predicate.
4. `upsert_sync_log` stores no owner even when handed one.
5. `create_logs` refuses a sync log naming an unfollowed Channel and accepts one naming a followed
   Channel.
6. With the flag off, every one of the above returns exactly what it returned before.

`test_tenancy_seam.py` and `test_log_tenancy_scoping.py` are updated rather than relaxed: sync leaves
the owned-types list and joins the follow-scoped one, and the seam's corpus assertion is untouched
because `Scope.CORPUS` still means the two tables no follow can reach.

Every assertion is mutation-tested before it is trusted, per `CLAUDE.md`.
