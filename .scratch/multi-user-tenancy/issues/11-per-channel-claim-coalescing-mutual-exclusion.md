# 11: Per-Channel claim, coalescing, mutual exclusion

**What to build:** Two people syncing the same Channel at once cannot corrupt its history cursors, and the second request rides the first rather than repeating the work.

**Blocked by:** 10

**Status:** done

- [x] Only one sync per Channel runs at a time, enforced outside process memory
- [x] A request finding one in flight waits for it, reports its result, and is not charged
- [x] The scheduling deadline advances on completion only; the in-flight claim is a separate field that expires on its own
- [x] A crashed worker's Channel is picked up again without manual intervention
- [x] A guard proves concurrent syncs do not interleave cursor writes

## How it was built

`Channel.sync_claimed_at` / `sync_claimed_by` (migration `a8b9c0d1e2f3`), taken
by a conditional `UPDATE ... RETURNING` in `services/channels.py` -- the
aggregate that already owns `tg_channels`, so the table keeps one writer. Four
primitives, each its own transaction: `try_claim_channel_sync`,
`renew_channel_sync_claim`, `release_channel_sync_claim`,
`channel_sync_claim_holder`.

`sync_single_channel` claims, heartbeats, and releases; `_claim_or_coalesce`
is the waiter. `scraper_jobs._channel_locks` and `acquire_channel` are deleted
rather than kept beside the claim.

Guard: `tests/services/test_channel_mutual_exclusion.py` (15 tests), plus the
replacement half of `tests/deployment/test_worker_count.py`'s reason 2.

Decisions worth carrying forward:

* **The lease is not the visibility timeout.** 5 minutes against the VT's ~2.4
  hours. The VT decides when a dead worker's *message* returns; the lease
  decides when its *Channel* does. Tying them would leave a Channel that
  crashed at noon refusing every sync until 14:24.
* **Release and renew are conditional on the holder.** An overrun runner
  reaches its own `finally` after being replaced; an unconditional release
  there clears the *new* holder's claim mid-walk.
* **A coalesced waiter holds a concurrency-gate permit while it waits.** It
  cannot deadlock -- the holder took its permit before it could claim -- but N
  waiters on one busy Channel occupy N slots, so the wait is capped at
  `COALESCE_MAX_WAIT_SECONDS` and reports a skip past it. Draining as slots
  free is ticket 12's; this is the same head-of-line shape `_batch_size`
  already documents.
* **"Not charged" needed no new code and is still asserted.** A coalesced
  request never enters the walk, so its meter counts nothing, and a charge of
  zero writes no row. Both halves are pinned, because either alone passes for
  a request that scraped and was let off.
* **One mutation was run and caught nothing, and that is written down** in the
  guard's docstring: swapping `RETURNING` for `rowcount` is *not* a defect on a
  plain conditional `UPDATE` through `session.execute`. The `CLAUDE.md` warning
  is about `session.exec` and `ON CONFLICT DO NOTHING`.

Left for ticket 21's owner-backfill bill: nothing new. The claim is not
owner-scoped -- a Channel is shared corpus, and mutual exclusion over its
cursors is not a visibility question.
