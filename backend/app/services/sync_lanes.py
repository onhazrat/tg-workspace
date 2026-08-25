"""PGMQ lane naming (ticket 09): one home for the six-queue convention.

`docs/multi-user-tenancy-plan.md` decision 27: **six queues**,
`{auto_sync, manual_bulk, manual_single} x {normal, best_effort}` — PGMQ has no
priority queue, so priority is emulated with one queue per lane. The Budget
half of that product already exists (`quota.py::Budget`, ticket 08); this
module is the other half, kept separate so `quota.py` stays about charging and
this stays about naming. `sync_orchestrator.py` and `app/jobs/manual_single_queue.py`
both need the same lane name and must not each spell it out separately —
disagreeing about the name is disagreeing about which queue a message goes to.

Ticket 09 creates exactly one lane, `manual_single_normal`. Ticket 23 is what
first makes an enqueue choose the best-effort tier; until then `TIER_NORMAL` is
the only one anything uses.
"""

from __future__ import annotations

from app.services.quota import Budget

TIER_NORMAL = "normal"
TIER_BEST_EFFORT = "best_effort"


def lane_name(budget: Budget, tier: str) -> str:
    return f"{budget.value}_{tier}"


#: The one lane ticket 09 installs and consumes. See module docstring.
MANUAL_SINGLE_NORMAL_LANE = lane_name(Budget.MANUAL_SINGLE, TIER_NORMAL)
