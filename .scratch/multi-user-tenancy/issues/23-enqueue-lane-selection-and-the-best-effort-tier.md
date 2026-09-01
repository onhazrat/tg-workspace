# 23: Enqueue lane selection and the best-effort tier

**What to build:** A User over one Budget keeps working, more slowly, on that Budget only. Their other two Budgets are unaffected, and they still receive Posts from Channels other people sync.

**Blocked by:** 08, 12

**Status:** done

- [x] Enqueue reads current usage and chooses the normal or best-effort lane
- [x] Exhausting one Budget leaves the other two at normal priority
- [x] Best-effort work runs only when normal work is idle
- [x] A guard covers the ladder in both directions

Plan: `docs/quota-lane-selection-plan.md`. Guard:
`tests/services/test_lane_selection.py`, twenty-two mutations, twenty-two red.
`/code-review` found four defects, all fixed; the plan's "What code review
changed" section records them, including a deployment-wide scheduler gate that
this ticket's strict tier would have turned into a stall for every account.

`enqueue_sync_job` is the one seam — every path that starts a sync goes through
it — so `lane_for_job(job, user_id)` grew the ledger read rather than four
callers each growing one. `sync_lanes.tier_for_spend` is the ladder itself and
stays a pure transform; `quota.budget_allowance` is where the three daily
limits come from.

## Decisions taken while implementing

**The comparison is `spent >= allowance`, and that is load-bearing.** It makes
an allowance of zero mean "always best-effort" (decision 18) by arithmetic
rather than by a special case, so ticket 24's fifth checkbox is already true. A
`>` would give a zero-Budget account exactly one batch a day at normal priority.

**Negative means unlimited.** The operator's escape hatch for a default that
turns out wrong, and the one value that cannot collide with a real limit.

**The defaults ship as real numbers, set from staging's own ledger** —
`auto_sync` 10,000, `manual_bulk` 3,000, `manual_single` 1,000, against observed
daily spends of 22,500-33,700, 150-1,130 and 1-410. `auto_sync` sits *below*
what the operator spends on purpose: an account following ~2,000 Channels is the
shape the best-effort tier exists for, and a default nobody crosses is a
mechanism with no caller. They are deployment configuration, not an Admin
setting and not per-User — both of those are ticket 24's first checkbox.

**The tier is chosen once per enqueue call, for the whole batch.** Decision 19
puts enforcement at enqueue; choosing per message would mean projecting the
spend of a sync that has not happened, and one sync is between one Request and
fifty. So a batch enqueued while an account is inside its Budget runs entirely
at normal priority however far past the line it takes them, and the ladder meets
it on the next enqueue. The ceiling that bounds the overshoot is ticket 24's.

**Usage is read for the account that will be charged**, through the same
`resolve_charge_owner` the charge uses, not for the id the caller passed. Those
differ for an ownerless enqueue and for an id naming a deleted account, and
reading the raw id would let both run at normal priority forever while the
operator paid.

**A ledger read that fails picks the normal lane.** Nothing is refused at this
rung, so being wrong costs one batch at the wrong priority against taking the
sync path down over a transient database error. Ticket 24's ceiling is where the
cost of being wrong is unbounded work instead and may want the other answer.

## The two questions ticket 08 left

**`charge_sync_job` keeps swallowing its failures.** It runs after the Posts are
committed, so raising would report an accounting problem by failing a sync that
worked. The cost is bounded — one message unbilled, the next charge succeeds —
and under-billing repeatedly needs a database that has already stopped the
enqueue read and the sync itself. The log line now names the Budget too.

**`jobs/discover_probe.py` stays uncharged, and the question is closed.** It
does not enqueue onto a lane, so the ladder has nothing to deprioritize; and the
probe queue is corpus-scoped deployment background work, so billing one account
for it makes that account's Budget a proxy for deployment load — what decision
16 split the Budgets to stop. Deployment-wide load is bounded by the proxy
partition and the adaptive wait (tickets 13, 14).

## Two syncs the ladder cannot reach

Both predate this ticket, both are declared in `RUN_SYNC_JOB_CALLERS` with their
reasons, and an undeclared third fails the guard. `auto_summary._sync_stale_channels`
needs the sync finished before it can summarise, and `bulk_follow.run_follow_job`'s
probe phase is metered but runs inline. Neither is on a lane, so there is no tier
to choose and nothing to deprioritise. **A ceiling can refuse either, because a
refusal needs no lane** — ticket 24's.

## The gate this ticket had to make per-account

`run_auto_sync` skipped its whole tick on the deployment-wide `has_active_sync_job()`.
That was bounded before, because auto-sync always held weight 1 in the round-robin.
With the strict tier it is not: an account over its Budget sits on best-effort for
as long as manual work keeps arriving, and its non-terminal job stopped *every*
account's scheduler. It is `active_sync_job_owners()` now, and it filters rather
than returning. `run_auto_summary` keeps the global check — what it gates is the
stale-channel pre-sync, so a stall there costs staler input, not a stopped
scheduler.
