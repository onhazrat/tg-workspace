# #146 🚦 Six lanes, weighted draining, lane control (ticket 12)

**State:** merged 2026-08-27 · **Branch:** `worktree-ticket-12-lanes` into `main` · **Diff:** +2852 / -132 across 19 files · **Opened:** 2026-08-27

---

Closes ticket 12 (`.scratch/multi-user-tenancy/issues/12-remaining-five-lanes-and-weighted-draining.md`). Plan: `docs/sync-lane-weighting-plan.md`.

## The four checkboxes

- **Six lanes exist.** Migration `b9c0d1e2f3a4` creates the three best-effort lanes, completing decision 27's product. They are drained but empty until ticket 23 selects a tier — the consumer is the caller, and `pgmq.read` raises on a queue no migration created.
- **Strict between tiers, weighted 3:2:1 within one.** `LaneScheduler` in `services/sync_lanes.py`, kept a pure transform so the fairness property is testable without a queue behind it. Strict order within a tier is the obvious implementation and is the failure decision 29 names: a trickle of single syncs never empties, so auto-sync never runs and the deployment quietly stops updating while the worker looks busy. Smooth WRR rather than "three then two then one", because the picks are separated by however long a real sync takes. Credit only moves for lanes that had work, so an idle lane cannot bank a burst.
- **Interleaved across accounts — at the read, not the enqueue.** A departure from decision 31's wording that honours its stated reason; argued in the ticket file and the module docstring. Every enqueue carries exactly one account, so interleaving there cannot help account B sitting behind account A's 2,000 messages. `_read_interleaved` uses PGMQ's own `conditional` filter, one read per account with due work, and does not engage at all below two accounts. `pgmq.read_grouped_rr` was rejected: it only reads groups whose *head* message is visible, so claiming one of an account's messages makes the rest unreadable — one sync at a time per account.
- **Pause or drain one lane.** `services/sync_lane_control.py`, gated on `JOBS_MANAGE`. Pause is lossless (messages stay queued *and visible*). Drain purges: archive everything, then cancel each job behind those messages — a job is terminal only when its last Channel finishes, so a partial purge would otherwise strand it for ever and `has_active_sync_job()` would answer True from then on, silencing auto-sync.

## Both inherited head-of-line notes, resolved by one change

They are about the same object, the worker's concurrency gate.

- **Ticket 10's** (a batch awaited as a unit): `drain_sync_lanes` takes a permit, dispatches one message, and comes back. A slot refills the moment it frees, and no lane waits for another lane to drain.
- **Ticket 11's** (a coalesced waiter holds a permit): the permit is a `SyncSlot` the waiter puts down for each wait and re-takes before its next claim attempt.

**Still cannot deadlock.** Ticket 11's argument was "the holder takes its permit before it can claim", and that half is untouched — a claim holder never releases while it walks, and only a waiter releases, so no permit is held by something waiting for a claim held by something waiting for a permit.

**`COALESCE_MAX_WAIT_SECONDS` keeps its value and loses its reason.** The gate justification is gone; what remains is that the waiter's message is claimed under a ~2.4h visibility timeout it must not outlast, and that a person is on the SSE stream. The docstring says that instead.

## Verification

- Backend: 1775 passed, 2 skipped, 0 failed. mypy clean; `ty` diagnostics unchanged at 89 (all pre-existing, verified against a stashed baseline). ruff check and format clean.
- Frontend: `tsc --noEmit` clean, 882 unit tests pass, generated client regenerated and committed.
- **Ten mutations, ten red.** Strict-order-within-tier, tier strictness removed from the policy, interleaving disabled, serial dispatch, `released()` made a no-op, pause ignored, purge without cancel, a lane with no migration, a naive underscore split of a lane name, and untracked buffered claims.

Note: CI test workflows are billing-blocked and never start, so expect no checks here.


## Comments

### onhazrat on 2026-08-27

### Code review pass (high effort) — five defects found and fixed in `f9a6638`

1. **A concurrency permit was leaked whenever `_next_message` raised.** The worst of the five: the gate is module-global and rebuilt only when the configured value changes, so the loss never heals. After `syncConcurrency` connection blips the worker parks on `acquire()` for ever — and the busy-gate break added in `7325388` then reports every sweep as an empty queue. Silent, permanent, and untraceable.
2. **The paused set was read once per drain, and a drain has no bounded length.** Its docstring justified the snapshot with "the sweep starts a fresh one every 30 seconds", which the commit right before it had already established to be false (`max_instances=1`). Re-read on a five-second cadence.
3. **`MAX_INTERLEAVED_USERS` without a rotating cursor is the same starvation one rung up** — the lowest-sorted accounts refill the window for as long as they have work, so the twenty-first account is never read. `distinct_due_values` now takes `after`.
4. **Bounding the coalescing wait stopped working once the permit became releasable.** The drain sits on `acquire()`, so a freed permit is taken at once by a fresh Channel, and the waiter was parked in the re-acquire for that Channel's whole walk, checking neither its deadline nor its cancellation — quietly undoing the very justification this PR had rewritten the constant's docstring to state.
5. **`_run_whole_job` released its permit and the arithmetic was backwards**: holding gives 2N-1, releasing gives 2N.

**Two of the guards written for these fixes could not fail when first mutation-tested**, both because the test did not reproduce what the defect needs — the rotation guard asserted every account was *eventually* served (true even with a fixed window; the assertion had to be about *when*), and the `SlotLost` guard had nothing competing for the permit. Both rewritten.

Fifteen mutations now, fifteen red. Backend 1780 passed, 2 skipped, 0 failed; mypy clean; ruff clean.
