# Six lanes, weighted draining, and lane control (ticket 12)

Ticket: `.scratch/multi-user-tenancy/issues/12-remaining-five-lanes-and-weighted-draining.md`.
Blocked by 10 (merged), built on 11 (merged, `0acd279`).

## What the ticket asks for

1. Six lanes exist: `{auto_sync, manual_bulk, manual_single} x {normal, best_effort}`.
2. Draining is strict between tiers and weighted within one, favouring single, then bulk, then automatic.
3. Messages are enqueued interleaved across Users.
4. An Admin can pause or drain a single lane.

Plan decisions 26, 27, 29 and 31 are the source; ticket 23 is the first caller that will
choose the best-effort tier.

## The two head-of-line notes this ticket inherits

Both point at the same object, the worker's one concurrency gate, and one change resolves both.

- **From ticket 10** (`sync_queue._batch_size`): a batch is read, gathered, and awaited as a
  unit, so one Channel needing a deep backfill holds its slot while the rest of its batch
  finishes.
- **From ticket 11** (`sync_orchestrator._claim_or_coalesce`): a coalesced waiter holds a gate
  permit *while it waits*. N requests for one busy Channel occupy N slots. Ticket 11 capped the
  wait at 15 minutes rather than restructuring the gate and left this to 12.

## Design

### A. Lane naming (`services/sync_lanes.py`, stays a pure transform)

`TIER_ORDER = (normal, best_effort)`, `BUDGET_DRAIN_ORDER = (manual_single, manual_bulk,
auto_sync)`, `BUDGET_WEIGHTS = {single: 3, bulk: 2, auto: 1}`. `DRAIN_ORDER` becomes all six
lanes, strict tier first and weight order within. `lane_tier`/`lane_budget` parse a name back,
so nothing outside this module splits a lane string.

### B. The three best-effort lanes exist by migration

Same idempotent `pgmq.meta`-checked shape as ticket 10's `b3c4d5e6f7a8`, hard-coding its
strings for the same reason. `tests/services/test_sync_lanes.py` remains the join between the
constants and the migrations.

### C. Continuous dispatch replaces batch-at-a-time

`drain_sync_lanes` becomes: acquire a permit, pick the next message, spawn it, repeat; when no
message is available, wait for a running task and re-check. Slots therefore refill as they free
rather than at a batch boundary, which resolves head-of-line note 1.

Picking a message is three nested rules:

- **Strict between tiers.** No best-effort message is dispatched while any normal-tier lane has
  work. This is a *live* check, not a snapshot: normal work arriving mid-drain preempts the
  next best-effort pick.
- **Weighted 3:2:1 within a tier**, favouring single, bulk, auto. A credit scheme, not strict
  order: strict priority within a tier is exactly how a trickle of manual work starves auto
  sync, which is the failure decision 29 names.
- **Round-robin across Users within a lane**, see D.

### D. Interleaving across Users happens at dispatch, not at enqueue

Deliberate departure from decision 31's *wording*, honouring its *reason*. The decision's
stated failure is "a user following 500 channels would otherwise block everyone behind them".
Every enqueue call carries exactly one user (`enqueue_sync_job(job, user_id)`), so interleaving
at enqueue reorders within one call and does nothing for user B sitting behind user A's 2,000
messages. The property is only reachable where the messages of different users meet, which is
the read. Adding a multi-user enqueue signature with no caller is the "mechanism with no
caller" this series has refused before.

### E. The concurrency permit becomes releasable

`SyncSlot` wraps the gate. The dispatcher acquires it; `sync_single_channel` holds it while it
walks; `_claim_or_coalesce` hands it back for the duration of each wait and re-takes it before
re-attempting the claim. The gate therefore means "how many Channels this deployment is
scraping at once" again, rather than "how many messages are in progress", which resolves
head-of-line note 2.

**Why it still cannot deadlock.** Ticket 11's argument was "the holder takes its permit before
it can claim, so it is always able to finish". That half is unchanged: a claim holder never
releases its permit while it walks. Only a *waiter* releases, and a waiter holds no claim. So
no permit is ever held by something waiting for a claim held by something waiting for a permit;
there is no cycle. The change removes contention rather than adding an ordering.

**`COALESCE_MAX_WAIT_SECONDS` stays, on a different reason.** Its stated justification, that
the waiter holds a gate slot, is gone. It still earns its place because the waiter's *message*
is claimed from PGMQ under a visibility timeout (~2.4h), and a waiter that outlasted it would
be redelivered while still being processed; and because a person is waiting on the SSE stream.
The constant is unchanged at 15 minutes; its docstring is rewritten to say why.

### E2. A second drain returns rather than parking on a fully-held gate

Waiting for a permit is the right backpressure once a drain is dispatching, and the wrong
behaviour before it has dispatched anything. `_consume_wakes` drains sequentially, so the only
drain that can overlap another is the 30-second sweep — a scheduled job with APScheduler's
default `max_instances=1`. A sweep parked on `acquire()` for the length of a deep backfill
would suppress every tick behind it. It has nothing to do anyway: the drain holding the
permits loops until its lanes are empty.

### F. Pause and drain a lane (`services/sync_lane_control.py`, an orchestrator)

- **Pause** = the worker skips that lane entirely while paused. Messages stay queued. State
  lives in a new global settings key `sync_lanes` (`tg_app_settings`), read once per drain.
- **Drain** = purge what is queued on that lane now: archive every message, then `cancel_job`
  each distinct job those messages belonged to. Archive-and-mark is the shape ticket 09's
  redelivery exhaustion and ticket 10's reconcile already use.
  - The partial case is the interesting one: purging 40 of a 50-message batch would otherwise
    leave the job non-terminal for ever, because the last Channel to finish is what makes a job
    terminal now. `cancel_job` already marks every pending/running Channel cancelled and writes
    the terminal row, so it is the right primitive rather than a new terminal state.
  - "Drain" deliberately does *not* mean "process this lane now": the NOTIFY ring plus the 30s
    sweep already are that, so it would be a second spelling of an existing mechanism.
- **Permission**: `Permission.JOBS_MANAGE`, not a new constant. It already covers "enable or
  disable a job" and already admits to being destructive (triggering retention deletes Posts).
  Pausing a lane is that same act one level down, for the same audience.

## Guards

`tests/services/test_lane_draining.py` (new) drives real load rather than asserting the weights
are configured: a steady trickle of manual work must not starve auto sync; best-effort must not
run while normal-tier work exists; one User's backlog must not block another's; a freed slot
must refill before its batch peers finish; a coalesced waiter must not hold a permit.
`tests/services/test_sync_lanes.py` extends to all six lanes and both tiers.


## What code review changed

Five defects, all real, all fixed on the branch. Worth recording because three of them are
properties of *this* design rather than slips, and the next person changing the drain loop
will meet them again.

1. **A permit was leaked whenever `_next_message` raised.** The permit is taken before the
   read that can fail — that ordering is deliberate, since waiting for a permit is the
   backpressure — so every path out that does not hand it to a task has to give it back. It
   did not, and `_concurrency_gate` is module-global and rebuilt only when the configured
   value changes, so the loss never healed: after `syncConcurrency` connection blips the
   worker parks on `acquire()` for ever, and the busy-gate break added above then reports
   every sweep as an empty queue. Silent, permanent, untraceable. Now a `try/finally` with a
   `dispatched` flag.
2. **The paused set was read once per drain, and a drain has no bounded length.** It returns
   only when every lane is empty *and* nothing is in flight. The docstring justified the
   snapshot with "the sweep starts a fresh one every 30 seconds", which is exactly what the
   busy-gate note above had already established to be false — `job_sync_queue` runs with
   APScheduler's default `max_instances=1`, so ticks behind a running drain are skipped, and
   `_consume_wakes` drains sequentially by design. Re-read on a five-second cadence.
3. **`MAX_INTERLEAVED_USERS` without a rotating cursor was the same starvation one rung up.**
   `ORDER BY v LIMIT 20` hands the window to the same lowest-sorted accounts on every pass for
   as long as they have work, so with 25 busy accounts the twenty-first is never read — the
   exact failure `_read_interleaved` exists to prevent. The comment claiming the rest are
   "reached on the next pass" only held if an account's whole backlog fitted in one read.
   `pgmq.distinct_due_values` now takes `after`, and the caller keeps a per-lane cursor.
4. **Bounding the coalescing wait stopped working once the permit became releasable.** The
   drain sits on `gate.acquire()`, so a released permit is taken immediately by a fresh
   Channel that holds it for a whole page walk — and the waiter was parked in the re-acquire
   for that whole time, evaluating neither `COALESCE_MAX_WAIT_SECONDS` nor its job's
   cancellation. Which is to say the constant's *remaining* justification, keeping the waiter
   inside its own message's visibility timeout, had been quietly undone by the change that
   rewrote its docstring. The re-acquire is now bounded by the same deadline and raises
   `SlotLost`, which the waiter answers with the skip it would have reached anyway. It must
   not carry on without the permit: that is the concurrency cap silently exceeded.
5. **`_run_whole_job` released its permit, and the docstring's arithmetic was backwards.**
   `run_sync_job` opens its own semaphore of the same size, so holding gives `2N - 1` and
   releasing gives a full `2N` — releasing is the worse of the two, not the tidier one. It
   keeps the permit now. Legacy path, live only for the messages in flight across one deploy.

**Two of the guards written for these fixes could not fail** when first mutation-tested, and
both for the same reason: the test did not reproduce the conditions the defect needs. The
rotation guard asserted that every account was *eventually* served, which is true even with a
fixed window because the queue does drain — the assertion had to be about *when*. The
`SlotLost` guard had nothing competing for the permit, so the waiter re-acquired its own
instantly and the bound was never reached. Fifteen mutations now, fifteen red.
