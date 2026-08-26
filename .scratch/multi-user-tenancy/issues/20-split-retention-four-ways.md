# 20: Split retention four ways

**What to build:** Post retention is a deployment policy an Admin sets once. Log and report retention stay personal. One person's settings can never delete another's evidence.

**Blocked by:** 03, 04, 06

**Status:** done

- [x] Post, embedding, translation, and sync-state sweeps run on the single deployment policy
- [x] Log sweeps run per User on that User's window
- [x] Discovery report pruning is per-User, not across the whole table
- [x] Channels with no Followers are collected
- [x] Asset pruning stays global

**Design note:** `docs/retention-split-plan.md`. **Guard:** `backend/tests/jobs/test_retention_split_four_ways.py`.

Two things the checkboxes did not say, both resolved in the ticket:

- **Sync and network logs, and any log row with no owner, needed a window of their own.** Sync logs became Channel telemetry in ticket 19 and network logs record proxy behaviour, so neither belongs on a per-User window; and `user_id` is nullable on all five log tables, so a background job's rows have no owner to sweep them by. Once the personal families moved to per-account windows all three were reachable by no window at all. New deployment field `sharedLogRetentionDays`, seeded from the deployment's existing `logRetentionDays` so nothing changed horizon.
- **Ownerless Discover reports had to be adopted.** Per-account pruning cannot reach a report with no `user_id`. The migration assigns them to the operator once; every report written since ticket 17 already carries an owner.

Handover from ticket 19 (`delete_old_logs` still filtering sync rows on `user_id == operator OR IS NULL`) is closed: the filter is gone from the Admin purge and from `expire_sync_payloads_stmt`.
