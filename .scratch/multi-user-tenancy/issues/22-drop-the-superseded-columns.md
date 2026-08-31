# 22: Drop the superseded columns (contract)

**What to build:** The corpus owner columns and the Channel columns that moved to the Follow are gone, so nothing can drift back to using them.

**Blocked by:** 21

**Status:** done

- [x] Owner columns are dropped from the corpus tables
- [x] The migrated per-User columns are dropped from the Channel
- [x] A guard asserts corpus models carry no owner and no module references one, stating the reason
- [x] The guard has been watched to fail

## What it actually took

Dropping fourteen columns was the small half. `Channel.setting_group_id` moving
to `ChannelFollow` reaches the whole setting-group subsystem, because the
*write* paths were built to put the value on the Channel and mirror it onto the
follow afterwards. With the source gone the mirror has nothing to copy, so
`sync_follow_settings` and `ensure_follow_for_channel` now take the values the
caller means to write, and `MIRRORED_CHANNEL_FIELDS` became `FOLLOW_OWNED_FIELDS`.

Three decisions worth re-reading before changing any of this:

* **A follow that names no group is skipped, not defaulted.** Falling back to
  anything means scheduling a channel off settings that belong to somebody else,
  which is the bug the follow table exists to prevent — `ensure_follow_for_channel`
  used to copy the group across, so the second follower of a handle inherited the
  first one's group, including one ticket 21's cascade then deletes.
* **The chat-id unique index widened from `(user_id, telegram_chat_id)` to
  `telegram_chat_id`.** A chat id belongs to the handle, so the per-account
  version could not see the collision that matters on a shared corpus. The
  migration clears duplicate bindings *before* creating the index, because a
  failing `CREATE UNIQUE INDEX` stops the deploy.
* **`ownerUserId` left the network-settings payload** rather than being
  repointed at the caller. It reported the dropped stamp, and nothing read it.

## Not in scope

`is_superuser` — this file never named it, and ticket 07 already has a guard
(`tests/api/test_permission_checks.py`) proving nothing reads it for access.
Dropping it is a decision somebody should take deliberately, not fold in here.

Reconciling `_name_collision_scope_filter` with its unique index is still open:
this ticket dropped the *Channel's* group column, not the global
`tg_channel_setting_groups` rows that filter is wider than the index for.
