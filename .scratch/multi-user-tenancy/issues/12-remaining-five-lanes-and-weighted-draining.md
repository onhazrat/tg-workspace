# 12: Remaining five lanes and weighted draining

**What to build:** All six queues exist. Normal-priority work always drains before best-effort, and a steady trickle of manual work cannot starve automatic sync.

**Blocked by:** 10

**Status:** done

- [x] Six lanes exist: automatic, manual bulk, manual single, each normal and best-effort
- [x] Draining is strict between tiers and weighted within one, favouring single, then bulk, then automatic
- [x] Messages are enqueued interleaved across Users
- [x] An Admin can pause or drain a single lane

Plan: `docs/sync-lane-weighting-plan.md`. Guards:
`tests/services/test_lane_draining.py` (real load) and `tests/services/test_sync_lanes.py`
(the policy as arithmetic). Every guard was mutation-tested — fifteen mutations, fifteen red.
Code review found five defects, all fixed; the plan document's "What code review changed"
section records them, including a permit leak that would have deadlocked the worker with no
diagnostic, and the two guards that had to be rewritten because they could not fail.

## Decisions taken while implementing

**Checkbox 3 is implemented at the read, not at the enqueue, and that is a departure from
decision 31's wording.** The decision says "enqueue interleaved by user", but its stated
failure is "a user following 500 channels would otherwise block everyone behind them", and
those two are not the same requirement. Every enqueue call carries exactly one account
(`enqueue_sync_job(job, user_id)`), so interleaving there reorders within one call and does
nothing across calls: PGMQ is FIFO by `msg_id`, so account B's three messages sit behind
account A's two thousand however A's were written. The property is only reachable where the
accounts' messages meet, which is the read. Adding a multi-account enqueue signature no
caller can use would be a mechanism with no caller. `_read_interleaved` uses PGMQ's own
`conditional` filter, one read per account with due work, merged round-robin.

**`pgmq.read_grouped_rr` was rejected although it is literally a round-robin read.** It only
considers groups whose *head* message is currently visible, so claiming one of an account's
messages makes every other message of that account unreadable until it is archived — one
sync at a time per account, which trades a fairness problem for a worse throughput one.

**Drain means purge, not "run this lane now."** The second reading is already the NOTIFY ring
plus the 30-second sweep. Purging archives every message (including in-flight ones, whose
visibility timeout would otherwise return them to a lane the operator just emptied) and then
cancels each job behind them — a job is terminal only when its last Channel finishes, so a
partial purge would otherwise strand it for ever and `has_active_sync_job()` would answer
True from then on, silencing auto-sync.

**`Permission.JOBS_MANAGE`, not a new constant.** It already covers enabling and triggering a
scheduled job and already states that it is destructive because triggering retention deletes
Posts. Pausing or discarding queued work is the same act one level down, for the same
audience.

## The two head-of-line notes this ticket inherited

Both resolved, and by one change, because both are about the same object — the worker's
concurrency gate.

- **Ticket 10's** (a batch awaited as a unit): `drain_sync_lanes` no longer reads a batch and
  gathers it. It takes a permit, dispatches one message, and comes back, so a slot refills the
  moment it frees and a slow Channel delays nothing but itself. A batch is now only a read size.
- **Ticket 11's** (a coalesced waiter holds a permit): the permit is a `SyncSlot`, and
  `_claim_or_coalesce` hands it back for the duration of each wait, re-taking it before the
  next claim attempt.

**The no-deadlock argument still holds, restated.** Ticket 11's was "the holder acquires its
permit before it can claim, so it is always able to finish". That half is untouched: a runner
holding a Channel's claim holds its permit for the whole walk and never releases mid-walk.
Only a waiter releases, and a waiter holds no claim — so there is no permit held by something
waiting for a claim held by something waiting for a permit, which is the only cycle available.

**`COALESCE_MAX_WAIT_SECONDS` keeps its value and loses its reason.** Ticket 11 justified the
15-minute cap by the waiter holding a gate slot; that is no longer true. It still earns its
place: the waiter's *message* is claimed from PGMQ under a ~2.4-hour visibility timeout, and a
waiter that outlasted it would have its own message redelivered and run a second time while
the first was still waiting — and a person is on the other end of the SSE stream. The
docstring now says that instead. Re-tuning it was considered and rejected: nothing about the
number changed, only why it is there.

## Notes for later tickets

- Ticket 23 is the first thing that will *choose* the best-effort tier; `lane_for_budget` takes
  a `tier` argument defaulting to normal, and the three best-effort lanes are created and
  drained but empty until then.
- `MAX_INTERLEAVED_USERS` (20) bounds how many accounts one lane read round-robins between,
  because each costs a read. A deployment that outgrows it serves the rest on the next pass.
- Ticket 13 owns one-worker-per-proxy. The draining here is correct across processes — the
  claim is a row and PGMQ's read is `FOR UPDATE SKIP LOCKED` — but the concurrency gate is
  still per process, so N workers means N gates.
