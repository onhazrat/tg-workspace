# 19: Sync logs become Channel telemetry

**What to build:** Sync history is a fact about a Channel, visible to anyone who Follows it, so people can see why they did or did not receive Posts.

**Blocked by:** 03, 04

**Status:** done

- [x] Sync logs carry no owner and are visible by Follow
- [x] Search across sync history still works within that scope
- [x] Both flag states are green

Plan: `docs/sync-log-channel-telemetry-plan.md`. Guard:
`backend/tests/services/test_sync_log_channel_telemetry.py`.

## What landed

`SyncLog` and `SyncLogPayload` are `Scope.FOLLOW_SCOPED`, keyed on
`channel_name`. `upsert_sync_log` accepts a `user_id` and does not write it; the
parameter stays only because `_LOG_IMPORTERS` dispatches five log types through
one uniform signature, and ticket 22 drops the column and the parameter
together. A migration denormalises `channel_name` onto `tg_sync_log_payloads`,
the way `timestamp` already is, so the payload row can be scoped without putting
a join to a 191k-row table inside the predicate.

## Three decisions this ticket had to make that its checkboxes did not state

1. **`assert_owner` on an ownerless row fails closed.** `owner_id is None`
   raises, so ticket 18's write-takeover guard would have refused *every* sync
   log write the moment ticket 21 flips the flag. It is restated as a Follow
   check rather than deleted, and it checks both the Channel an incoming log
   names and the one an existing row at that id already names. Checking only the
   first leaves the takeover open, because the id is the thing being guessed.
2. **Deleting one sync log row is now administrative.** A Follower deleting
   shared telemetry destroys the record for every other Follower, which is what
   ticket 20's own checkbox forbids and the argument ticket 05 made for
   unfollowing rather than deleting. `SHARED_LOG_TYPES` is derived from `SCOPES`
   rather than listed, so a type reclassified in the seam arrives at the gate on
   its own.
3. **That gate closes a hole ticket 18 left in network logs.** Their *reads*
   went Admin-only, but `DELETE /data/logs?type=network&logId=...` never had a
   permission check and `get_log` skips the owner check for Admin-only types, so
   any authenticated account could delete a proxy log one row at a time without
   ever being able to read one. Watched to fail: with the gate removed a plain
   user gets `200` on both `sync` and `network`.

## Found by review, after the first cut

4. **Seeing a row is not permission to flatten it.** Two accounts following the
   same handle both passed every visibility check, and `upsert_sync_log` then
   overwrote `status`, `error` and the counts, so one Follower could rewrite
   telemetry the other reads. Through the API the write is now create-only. The
   delete gate above condemns exactly that harm; the overwrite had been left
   open.
5. **Collection strands the sync logs.** `collect_unfollowed_channel` reclaims
   the tables that do not cascade, and these two had just joined that group.
   Once the Channel row is gone there is no Follow for the EXISTS to reach, so
   the rows are invisible to everyone and still on disk. Collected now through
   `logs.collect_channel_sync_logs`, so the owning aggregate stays the only
   writer.
6. **The write guard was case-insensitive, the read scope is not.**
   `visible_channel_names` lowercases for handle matching; `scoped_select`
   compares names exactly. An account following `MixedCase` could write a log
   naming `mixedcase`, which the EXISTS could then never match. A guard looser
   than the scope manufactures unreadable rows rather than merely failing to
   protect.
7. **A refused delete reached nobody.** `handleDelete` awaited `mutateAsync`
   with no catch, so the new 403 surfaced as an unhandled rejection and the row
   just stayed. `useDeleteLogsMutation` already promised these failures "reach
   the operator". Both it and `confirmClearLogs` now toast, the second of which
   has been able to refuse a non-Admin silently since ticket 18.
8. **The index was built before the backfill**, so the `UPDATE` maintained it
   per row and left it bloated. Reordered.
9. **The legacy owner stamps are nulled.** Three sweeps still read `user_id =
   :operator OR IS NULL`; a row stamped with another account before the upgrade
   matched none of them ever again, so it was excluded from every sweep and from
   `syncLogCount` while remaining visible in the Logs tab.

## For ticket 22

`SyncLog.user_id` and `SyncLogPayload.user_id` are both dead: written as `None`,
read by nothing. They go with the corpus owner columns, along with
`upsert_sync_log`'s third parameter.

## For ticket 20

`tg_sync_log_payloads.channel_name` is there now, so a per-Channel payload sweep
stays a single-table bulk DELETE. `delete_old_logs` still filters sync rows on
`user_id == operator OR IS NULL`, which matches everything now that the stamp is
never written. Harmless today, and it is ticket 20's to resolve: sync logs are
no longer personal, so they do not belong on a per-User retention window.
