"""PGMQ lane naming (ticket 09): one home for the six-queue convention.

`docs/multi-user-tenancy-plan.md` decision 27: **six queues**,
`{auto_sync, manual_bulk, manual_single} x {normal, best_effort}` — PGMQ has no
priority queue, so priority is emulated with one queue per lane. The Budget
half of that product already exists (`quota.py::Budget`, ticket 08); this
module is the other half, kept separate so `quota.py` stays about charging and
this stays about naming. `sync_orchestrator.py` and `app/jobs/sync_queue.py`
both need the same lane name and must not each spell it out separately —
disagreeing about the name is disagreeing about which queue a message goes to.

Ticket 09 created one lane, `manual_single_normal`. Ticket 10 adds the other two
normal-tier lanes (`auto_sync_normal`, `manual_bulk_normal`), because moving the
scheduler into the worker process means auto-sync and bulk-follow have to
enqueue rather than call `run_sync_job` — and a lane is where they enqueue *to*.
Ticket 12 adds the three best-effort lanes and the weighted draining between all
six; ticket 23 is what first makes an enqueue *choose* the best-effort tier,
which is why building it earlier would be a mechanism with no caller.
"""

from __future__ import annotations

from app.services.quota import Budget

TIER_NORMAL = "normal"
TIER_BEST_EFFORT = "best_effort"


def lane_name(budget: Budget, tier: str) -> str:
    return f"{budget.value}_{tier}"


#: The lane ticket 09 installs and consumes. See module docstring.
MANUAL_SINGLE_NORMAL_LANE = lane_name(Budget.MANUAL_SINGLE, TIER_NORMAL)
#: The two ticket 10 adds, so the web process can stop running syncs itself.
AUTO_SYNC_NORMAL_LANE = lane_name(Budget.AUTO_SYNC, TIER_NORMAL)
MANUAL_BULK_NORMAL_LANE = lane_name(Budget.MANUAL_BULK, TIER_NORMAL)

#: Every lane the worker drains today, in the order it drains them.
#:
#: Manual single first, then bulk, then automatic — the *ordering* half of
#: decision 29, which a plain round-robin would not give. The weighting (3:2:1
#: within a tier) and the strict normal-before-best-effort rule between tiers
#: are ticket 12's, and both need lanes that do not exist yet. Strict order
#: across these three is the honest interim: it favours the person waiting on a
#: single sync, and with only normal-tier lanes there is no tier for it to
#: starve.
DRAIN_ORDER = (
    MANUAL_SINGLE_NORMAL_LANE,
    MANUAL_BULK_NORMAL_LANE,
    AUTO_SYNC_NORMAL_LANE,
)


def lane_for_budget(budget: Budget) -> str:
    """The normal-tier lane a Budget's work goes to.

    Derived from the Budget rather than looked up, so a new Budget cannot be
    filed onto whichever lane an `else` branch happened to name. It does *not*
    fail for an unknown Budget — it composes a name, and a Budget with no
    migration behind it fails later at `pgmq.send`, on a queue that does not
    exist. `tests/services/test_sync_lanes.py` is what closes that gap: it
    asserts every Budget's lane is in `DRAIN_ORDER` and that every lane in
    `DRAIN_ORDER` was created by a migration.
    """
    return lane_name(budget, TIER_NORMAL)
