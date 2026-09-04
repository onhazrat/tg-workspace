"""PGMQ lane naming and drain policy (tickets 09, 10, 12).

`docs/multi-user-tenancy-plan.md` decision 27: **six queues**,
`{auto_sync, manual_bulk, manual_single} x {normal, best_effort}` — PGMQ has no
priority queue, so priority is emulated with one queue per lane. The Budget
half of that product already exists (`quota.py::Budget`, ticket 08); this
module is the other half, kept separate so `quota.py` stays about charging and
this stays about naming. `sync_orchestrator.py` and `app/jobs/sync_queue.py`
both need the same lane name and must not each spell it out separately —
disagreeing about the name is disagreeing about which queue a message goes to.

Ticket 09 created one lane, `manual_single_normal`. Ticket 10 added the other two
normal-tier lanes, because moving the scheduler into the worker process means
auto-sync and bulk-follow have to enqueue rather than call `run_sync_job`.
Ticket 12 adds the three best-effort lanes and the policy that decides which of
the six to take the next message from. Ticket 23 adds the selector in front of
them: `tier_for_spend` reads an account's allowance against what it has already
spent on that Budget today, so an account over one Budget is degraded on that
Budget alone.

**The policy lives here rather than in the consumer** because it is a pure
transform in the sense `tests/services/test_service_kinds.py` means — it holds
no `Session`, opens no socket, and answers "which lane next" from counts alone.
That makes the fairness property the ticket actually cares about testable
without a queue, a worker or a database behind it.
"""

from __future__ import annotations

from collections.abc import Container

from app.services.quota import Budget

TIER_NORMAL = "normal"
TIER_BEST_EFFORT = "best_effort"

#: Strict order between tiers: every normal-tier message goes before any
#: best-effort one (decision 29). Not a weighting — best-effort is what an
#: account is given once it is over its Budget (ticket 24), and a weighting
#: there would mean an account past its ceiling still taking slots from one
#: inside it.
TIER_ORDER = (TIER_NORMAL, TIER_BEST_EFFORT)


def lane_name(budget: Budget, tier: str) -> str:
    return f"{budget.value}_{tier}"


#: The lane ticket 09 installs and consumes. See module docstring.
MANUAL_SINGLE_NORMAL_LANE = lane_name(Budget.MANUAL_SINGLE, TIER_NORMAL)
#: The two ticket 10 adds, so the web process can stop running syncs itself.
AUTO_SYNC_NORMAL_LANE = lane_name(Budget.AUTO_SYNC, TIER_NORMAL)
MANUAL_BULK_NORMAL_LANE = lane_name(Budget.MANUAL_BULK, TIER_NORMAL)
#: The three ticket 12 adds, completing decision 27's product.
MANUAL_SINGLE_BEST_EFFORT_LANE = lane_name(Budget.MANUAL_SINGLE, TIER_BEST_EFFORT)
MANUAL_BULK_BEST_EFFORT_LANE = lane_name(Budget.MANUAL_BULK, TIER_BEST_EFFORT)
AUTO_SYNC_BEST_EFFORT_LANE = lane_name(Budget.AUTO_SYNC, TIER_BEST_EFFORT)

#: How much of a tier's throughput each Budget gets, decision 29's "weighted
#: 3:2:1 within a tier favouring single, bulk, auto".
#:
#: The weights are the whole point, so they are worth saying in words: a person
#: who pressed Sync on one channel is waiting in front of the screen, a bulk
#: follow is waiting but not watching, and auto-sync is nobody's foreground.
#: **Strict order between the three would be the obvious implementation and is
#: the failure decision 29 names** — a steady trickle of single syncs never
#: empties, so auto-sync would never run, and the product would quietly stop
#: updating while the worker looked perfectly busy.
BUDGET_WEIGHTS: dict[Budget, int] = {
    Budget.MANUAL_SINGLE: 3,
    Budget.MANUAL_BULK: 2,
    Budget.AUTO_SYNC: 1,
}

#: Heaviest first. Only a tie-break for equal credit in `LaneScheduler`, and the
#: order `DRAIN_ORDER` presents the lanes in.
BUDGET_DRAIN_ORDER = (Budget.MANUAL_SINGLE, Budget.MANUAL_BULK, Budget.AUTO_SYNC)

#: The Discover handle probe's lane (ticket 36, ADR-012 D9).
#:
#: One `t.me/<handle>` fetch per candidate, so a report arrives triaged instead
#: of asking the operator to sort bots and private channels out of it by hand.
#: It ran on an `asyncio.Semaphore(2)` of its own, outside the Partition, which
#: made it a second scraping budget nothing counted — the same defect as
#: `run_sync_job`'s semaphore, reached from another direction.
DISCOVER_PROBE_LANE = "discover_probe_background"

#: Lanes that carry something other than a Channel sync, each with the reason
#: it is not a `lane_name(budget, tier)`. Shaped like `EXPORT_OMISSIONS`: the
#: exception states its own case, so nothing silently joins the list.
#:
#: **Drained strictly after every sync lane**, which is what makes this "lower
#: priority than other requests to Telegram" without a priority-aware
#: semaphore. `LaneScheduler` is already strict between tiers; these come after
#: the last of them.
#:
#: *No Budget, deliberately.* Giving the probe one would make the name fit
#: `lane_name`, and ticket 23 left probes uncharged on purpose —
#: `DiscoverHandleProbe` is corpus-scoped, so billing one account for
#: deployment-wide work is exactly what the three Budgets exist to prevent. A
#: Budget on the ledger path that then has to be excluded from it is a special
#: case pretending to be a rule.
#:
#: *And no `background` entry in `TIER_ORDER`*, which was the other obvious
#: shape: a tier multiplies through the Budget product and creates three lanes
#: where one is wanted.
NON_SYNC_LANES: dict[str, str] = {
    DISCOVER_PROBE_LANE: (
        "Discover handle probes. One fetch each, charged to nobody because the "
        "verdict is corpus-scoped, and drained only when no sync lane has work."
    ),
}

#: Every lane the worker drains: the Budget x tier product, then the declared
#: non-sync lanes.
#:
#: It is no longer the *drain sequence* — `LaneScheduler` is — but it is still
#: the inventory: `queued_job_ids` scans it, `sync_lane_control` validates
#: against it, and `tests/services/test_sync_lanes.py` asserts every name in it
#: was created by a migration.
DRAIN_ORDER = tuple(
    lane_name(budget, tier) for tier in TIER_ORDER for budget in BUDGET_DRAIN_ORDER
) + tuple(NON_SYNC_LANES)


#: The non-sync lanes as an ordered tuple, for the drain to offer as one group.
#:
#: `lanes_in_tier` is the sync equivalent, and the drain iterates
#: `(*tiers, NON_SYNC_GROUP)`. Without a group of their own these lanes are
#: enqueued and never read: `_LaneBuffers.lanes_with_work` walks the lanes it is
#: handed, and every caller handed it a *tier*.
NON_SYNC_GROUP: tuple[str, ...] = tuple(NON_SYNC_LANES)


def is_sync_lane(lane: str) -> bool:
    """Whether `lane` carries Channel sync work.

    The predicate callers check *before* `lane_budget` or `lane_tier`, both of
    which still raise outside the product (ADR-012 D11). Returning `None` from
    those instead was the alternative, and it converts a loud failure into a
    value that flows somewhere else before it fails.
    """
    return lane not in NON_SYNC_LANES


def lanes_in_tier(tier: str) -> tuple[str, ...]:
    """The three lanes of one tier, heaviest Budget first."""
    return tuple(lane_name(budget, tier) for budget in BUDGET_DRAIN_ORDER)


def lane_budget(lane: str) -> Budget:
    """The Budget a lane carries work for.

    Parses rather than looks up, and raises on a name that is not a lane. The
    inverse of `lane_name`, kept next to it so nothing else in the codebase
    splits a lane string on an underscore — `manual_single_normal` has three of
    them and only one is the separator.
    """
    for tier in TIER_ORDER:
        suffix = f"_{tier}"
        if lane.endswith(suffix):
            return Budget(lane[: -len(suffix)])
    raise ValueError(f"{lane!r} is not a lane name")


def lane_tier(lane: str) -> str:
    """The tier a lane belongs to. Raises on a name that is not a lane."""
    for tier in TIER_ORDER:
        if lane.endswith(f"_{tier}"):
            return tier
    raise ValueError(f"{lane!r} is not a lane name")


def lane_for_budget(budget: Budget, tier: str = TIER_NORMAL) -> str:
    """The lane a Budget's work goes to, normal tier unless told otherwise.

    Derived from the Budget rather than looked up, so a new Budget cannot be
    filed onto whichever lane an `else` branch happened to name. It does *not*
    fail for an unknown Budget — it composes a name, and a Budget with no
    migration behind it fails later at `pgmq.send`, on a queue that does not
    exist. `tests/services/test_sync_lanes.py` is what closes that gap: it
    asserts every Budget's lane is in `DRAIN_ORDER` and that every lane in
    `DRAIN_ORDER` was created by a migration.

    `tier` defaults to normal because that is the answer for an account inside
    its allowance, which is every account most of the time. `lane_for_spend` is
    the form that decides (ticket 23).
    """
    return lane_name(budget, tier)


def tier_for_spend(spent: int, allowance: int | None) -> str:
    """Which tier an account gets, having spent `spent` against `allowance`.

    Decision 17's ladder, and the whole of it: **inside the allowance is normal,
    at or past it is best-effort, and nothing is refused.** The refusal is the
    absolute ceiling, which lives in `quota.assert_within_ceiling` and is not
    expressible here — a lane is a priority, and every lane runs.

    Pure, and takes the two numbers rather than a `Session` and a user id, so
    the rule can be driven as arithmetic. **Ticket 24 moved the allowance into
    the signature**: it used to call `budget_allowance(budget)`, which read one
    number out of `config.py` for everybody, and once an Admin can set a
    deployment default and a per-User override that answer needs a database.
    Reaching for one here would make this module the thing it is defined not to
    be; `sync_queue.lane_for_job` resolves the limits and passes them, which is
    the same shape as the `spent` beside them.

    `allowance is None` is unlimited, which is what a negative setting resolves
    to. The comparison is otherwise `>=`, and that is load-bearing rather than a
    rounding choice: it makes **an allowance of zero mean "always best-effort"**
    (decision 18) by arithmetic instead of by a special case, because zero spent
    is already not less than zero allowed. A `>` would give an account with a
    zero Budget exactly one free batch at normal priority a day, which is the
    shape of thing nobody notices until they are reading a ledger and cannot
    make it add up.

    Only one Budget's numbers reach this function, which is decision 16's reason
    for splitting them at all — exhausting one leaves the other two on the
    normal tier, and a day's total passed in here would collapse the three back
    into one invisibly, since every lane would still be a valid lane.
    """
    if allowance is None:
        return TIER_NORMAL
    return TIER_BEST_EFFORT if spent >= allowance else TIER_NORMAL


def lane_for_spend(budget: Budget, spent: int, allowance: int | None) -> str:
    """The lane `budget`'s work goes on for an account in this position.

    `lane_for_budget` composed with `tier_for_spend`, named because that pair is
    what every enqueue wants and spelling it out at the call site is how the two
    halves end up applied in one place and not the other.
    """
    return lane_for_budget(budget, tier_for_spend(spent, allowance))


class LaneScheduler:
    """Chooses the lane to take the next message from. One per drain.

    Two rules, in this order:

    1. **Strict between tiers.** If any normal-tier lane has work, the answer is
       a normal-tier lane. Best-effort is reached only when the normal tier is
       genuinely empty, not merely when it was empty a moment ago — the caller
       re-offers what is available on every call, so normal work arriving
       mid-drain preempts the next best-effort pick.
    2. **Weighted round-robin within a tier**, 3:2:1 by `BUDGET_WEIGHTS`.

    The weighting is smooth (the algorithm nginx calls smooth weighted
    round-robin) rather than "three, then two, then one": each candidate gains
    its weight in credit each pass, the richest is chosen, and it pays the total
    weight of the candidates back. Over six picks with all three lanes busy that
    is exactly three single, two bulk, one auto, but it does not emit three of
    one lane in a row — which matters because these picks are separated by the
    time a real sync takes, and a burst of one Budget is what the weighting is
    supposed to prevent.

    **Credit only moves for lanes that had work at that moment.** A lane that is
    empty neither gains nor pays, so an idle auto-sync lane does not bank credit
    it would spend all at once when work finally arrives, and a busy lane does
    not fall permanently behind an empty one.
    """

    def __init__(self) -> None:
        # Sync lanes only. `_weighted_pick` reads `BUDGET_WEIGHTS[lane_budget(...)]`,
        # which raises for a non-sync lane — and never sees one, because those
        # are served by the unweighted pass below.
        self._credit: dict[str, int] = {
            lane: 0 for lane in DRAIN_ORDER if is_sync_lane(lane)
        }

    def next_lane(self, available: Container[str]) -> str | None:
        """The lane to serve next, or None when nothing is available.

        `available` is "has a message ready to dispatch right now", which is the
        caller's business: it is what the buffers hold plus what the queues will
        give up, and only the caller can answer that without a `Session`.
        """
        for tier in TIER_ORDER:
            candidates = [lane for lane in lanes_in_tier(tier) if lane in available]
            if candidates:
                return self._weighted_pick(candidates)
        # Strictly after every sync lane, and unweighted: there is one of them,
        # and weighting a single candidate against nothing is arithmetic with
        # no question in it. A probe waits behind a best-effort sync from an
        # account over its Budget, which is the intended order — that account
        # asked for something, and nobody asked for this.
        for lane in NON_SYNC_LANES:
            if lane in available:
                return lane
        return None

    def _weighted_pick(self, candidates: list[str]) -> str:
        total = sum(BUDGET_WEIGHTS[lane_budget(lane)] for lane in candidates)
        for lane in candidates:
            self._credit[lane] += BUDGET_WEIGHTS[lane_budget(lane)]
        # `max` keeps the first of equal credits, and `candidates` is in
        # `BUDGET_DRAIN_ORDER`, so a tie resolves towards the heavier Budget.
        chosen = max(candidates, key=lambda lane: self._credit[lane])
        self._credit[chosen] -= total
        return chosen
