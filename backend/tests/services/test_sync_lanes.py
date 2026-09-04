"""The lane names in code and in the migrations agree, and the drain policy
does what decision 29 says (tickets 09, 10, 12).

A lane exists because a migration ran `pgmq.create('<name>')`. The worker reads
`<name>` from `app/services/sync_lanes.py`. Nothing connects the two but the
spelling, so renaming a constant leaves the worker reading a queue that was
never created — and `pgmq.read` on a missing queue raises, which means *every*
sweep fails and every queued sync stops, for a rename that looked local.

The migration deliberately hard-codes its strings (a migration must keep
describing the schema it created even after the constant it was named for is
gone), so this is the join between them.

The second half of this file is ticket 12's: `LaneScheduler` is a pure
transform, so the fairness property the ticket is actually about — "a steady
trickle of manual work cannot starve automatic sync" — can be driven here as
arithmetic, and is driven against a real queue and a real worker in
`test_lane_draining.py`.
"""

from __future__ import annotations

import pathlib
import re
from collections import Counter

import pytest

from app.services.quota import Budget
from app.services.sync_lanes import (
    AUTO_SYNC_BEST_EFFORT_LANE,
    AUTO_SYNC_NORMAL_LANE,
    BUDGET_WEIGHTS,
    DISCOVER_PROBE_LANE,
    DRAIN_ORDER,
    MANUAL_BULK_BEST_EFFORT_LANE,
    MANUAL_BULK_NORMAL_LANE,
    MANUAL_SINGLE_BEST_EFFORT_LANE,
    MANUAL_SINGLE_NORMAL_LANE,
    NON_SYNC_LANES,
    TIER_BEST_EFFORT,
    TIER_NORMAL,
    TIER_ORDER,
    LaneScheduler,
    is_sync_lane,
    lane_budget,
    lane_for_budget,
    lane_tier,
    lanes_in_tier,
)

_VERSIONS = pathlib.Path(__file__).resolve().parents[2] / "app" / "alembic" / "versions"


def _lanes_created_by_migrations() -> set[str]:
    """Every queue name any migration passes to `pgmq.create`."""
    created: set[str] = set()
    for path in _VERSIONS.glob("*.py"):
        text = path.read_text()
        created.update(re.findall(r"pgmq\.create\('([a-z_]+)'\)", text))
        # The ticket-10 and ticket-12 migrations build their names from a tuple
        # and call `pgmq.create` through a `DO` block, so pick those up too.
        if "_LANES = (" in text:
            block = text.split("_LANES = (", 1)[1].split(")", 1)[0]
            created.update(re.findall(r'"([a-z_]+)"', block))
        # And ticket 36's, which creates one lane and so names it with a
        # singular constant. Matched on the constant rather than on the `DO`
        # block, because the block interpolates the name and a regex over the
        # SQL would be reading `'{_LANE}'`.
        created.update(re.findall(r'^_LANE = "([a-z_]+)"', text, re.MULTILINE))
    return created


def test_every_lane_the_worker_drains_was_created_by_a_migration() -> None:
    created = _lanes_created_by_migrations()
    missing = set(DRAIN_ORDER) - created
    assert not missing, (
        f"the worker drains {sorted(missing)}, which no migration creates. "
        "`pgmq.read` raises on a queue that does not exist, so every sweep "
        "would fail and every queued sync would stop."
    )


def test_the_guard_can_actually_see_the_migrations() -> None:
    """Without this, a moved `versions/` directory turns the assertion above
    into `set() - set()` and the guard passes by finding nothing at all."""
    created = _lanes_created_by_migrations()
    assert MANUAL_SINGLE_NORMAL_LANE in created, (
        "no migration appears to create any lane; this guard is reading the "
        f"wrong directory ({_VERSIONS})"
    )


def test_a_lane_name_is_its_budget_and_tier() -> None:
    """The names are a product, not six literals, and `lane_budget`/`lane_tier`
    are the inverse — so nothing outside the module splits a lane string."""
    assert lane_for_budget(Budget.MANUAL_SINGLE) == MANUAL_SINGLE_NORMAL_LANE
    assert lane_for_budget(Budget.MANUAL_BULK) == MANUAL_BULK_NORMAL_LANE
    assert lane_for_budget(Budget.AUTO_SYNC) == AUTO_SYNC_NORMAL_LANE
    assert (
        lane_for_budget(Budget.MANUAL_SINGLE, TIER_BEST_EFFORT)
        == MANUAL_SINGLE_BEST_EFFORT_LANE
    )
    for lane in DRAIN_ORDER:
        if not is_sync_lane(lane):
            continue
        assert lane_name_roundtrips(lane), lane


def lane_name_roundtrips(lane: str) -> bool:
    return lane_for_budget(lane_budget(lane), lane_tier(lane)) == lane


def test_manual_single_survives_a_naive_underscore_split() -> None:
    """`manual_single_normal` has three underscores and only one separates the
    Budget from the tier. A `lane.split("_")` anywhere would answer `manual`."""
    assert lane_budget(MANUAL_SINGLE_NORMAL_LANE) is Budget.MANUAL_SINGLE
    assert lane_tier(MANUAL_SINGLE_NORMAL_LANE) == TIER_NORMAL
    assert lane_budget(MANUAL_SINGLE_BEST_EFFORT_LANE) is Budget.MANUAL_SINGLE
    assert lane_tier(MANUAL_SINGLE_BEST_EFFORT_LANE) == TIER_BEST_EFFORT
    with pytest.raises(ValueError):
        lane_budget("not_a_lane")
    with pytest.raises(ValueError):
        lane_tier("manual_single")


def test_the_sync_lanes_are_the_full_budget_and_tier_product() -> None:
    """Checkbox 1. Every Budget in every tier, and nothing else *is a sync lane*.

    It read "and nothing else" against the whole of `DRAIN_ORDER` until ticket
    36 put a seventh lane there. That lane is not a sync lane and deliberately
    has no Budget — `is_sync_lane` is the line between them, so this asserts
    the product on one side of it and `NON_SYNC_LANES` answers for the other.
    """
    expected = {
        lane_for_budget(budget, tier) for budget in Budget for tier in TIER_ORDER
    }
    sync_lanes = {lane for lane in DRAIN_ORDER if is_sync_lane(lane)}

    assert sync_lanes == expected
    assert len(sync_lanes) == 6
    assert len(set(DRAIN_ORDER)) == len(DRAIN_ORDER), "a lane appears twice"


def test_every_non_sync_lane_states_why_it_is_not_one() -> None:
    """The `EXPORT_OMISSIONS` shape: an exception that argues for itself.

    A lane in `DRAIN_ORDER` with no Budget and no reason is a queue the worker
    drains and nobody can explain — and, because `lane_budget` raises on it,
    one that would take the drain down the first time something asked.
    """
    unexplained = {lane for lane in DRAIN_ORDER if not is_sync_lane(lane)} - set(
        NON_SYNC_LANES
    )
    assert not unexplained, f"{sorted(unexplained)} is drained with no reason given"

    for lane, reason in NON_SYNC_LANES.items():
        assert lane in DRAIN_ORDER, f"{lane} has a reason but is never drained"
        assert len(reason) > 40, f"{lane}'s reason does not say what it carries"
        with pytest.raises(ValueError):
            lane_budget(lane)
        with pytest.raises(ValueError):
            lane_tier(lane)


def test_a_probe_never_drains_while_a_sync_lane_has_work() -> None:
    """D9's whole claim: "lower priority than other requests to Telegram",
    using the strict tier ordering that already exists rather than a
    priority-aware semaphore.

    Including behind **best-effort** — an account past its Budget still asked
    for something, and nobody asked for a probe.
    """
    scheduler = LaneScheduler()

    assert scheduler.next_lane({MANUAL_SINGLE_NORMAL_LANE, DISCOVER_PROBE_LANE}) == (
        MANUAL_SINGLE_NORMAL_LANE
    )
    assert (
        scheduler.next_lane({MANUAL_SINGLE_BEST_EFFORT_LANE, DISCOVER_PROBE_LANE})
        == MANUAL_SINGLE_BEST_EFFORT_LANE
    )
    assert scheduler.next_lane({DISCOVER_PROBE_LANE}) == DISCOVER_PROBE_LANE
    assert scheduler.next_lane(set()) is None


def test_every_budget_has_a_lane_in_the_drain_order() -> None:
    """A Budget with no lane is work that can be charged but never queued."""
    for budget in Budget:
        assert lane_for_budget(budget) in DRAIN_ORDER, (
            f"{budget.value} has no normal-tier lane in DRAIN_ORDER, so a sync "
            "charged against it would be enqueued onto a lane nobody drains"
        )


def test_normal_tier_lanes_all_precede_best_effort_ones() -> None:
    """And the non-sync lanes come after both, which is their whole priority."""
    sync_lanes = [lane for lane in DRAIN_ORDER if is_sync_lane(lane)]
    assert [lane_tier(lane) for lane in sync_lanes] == (
        [TIER_NORMAL] * 3 + [TIER_BEST_EFFORT] * 3
    )
    assert list(DRAIN_ORDER)[: len(sync_lanes)] == sync_lanes, (
        "a non-sync lane sits among the sync ones; `DRAIN_ORDER` is the "
        "inventory a reader takes the policy from"
    )


# --- the drain policy (ticket 12) ---------------------------------------


def _serve(scheduler: LaneScheduler, available: set[str], picks: int) -> list[str]:
    """Ask for `picks` lanes with the same set busy throughout."""
    out = []
    for _ in range(picks):
        lane = scheduler.next_lane(available)
        assert lane is not None
        out.append(lane)
    return out


def test_nothing_available_is_answered_with_none() -> None:
    assert LaneScheduler().next_lane(set()) is None


def test_a_busy_tier_is_shared_three_two_one() -> None:
    """Decision 29's weighting, over one full cycle."""
    counts = Counter(_serve(LaneScheduler(), set(lanes_in_tier(TIER_NORMAL)), 6))
    assert counts[MANUAL_SINGLE_NORMAL_LANE] == 3
    assert counts[MANUAL_BULK_NORMAL_LANE] == 2
    assert counts[AUTO_SYNC_NORMAL_LANE] == 1


def test_a_trickle_of_manual_work_cannot_starve_automatic_sync() -> None:
    """The failure decision 29 names, and the reason the weighting is not a
    strict order. Manual single work is *always* available here — the trickle
    never runs out — and auto-sync still has to get its share."""
    scheduler = LaneScheduler()
    served = _serve(
        scheduler, {MANUAL_SINGLE_NORMAL_LANE, AUTO_SYNC_NORMAL_LANE}, picks=40
    )
    auto = served.count(AUTO_SYNC_NORMAL_LANE)
    assert auto == 10, (
        f"auto-sync got {auto} of 40 picks against a permanent trickle of "
        "single syncs; 3:1 is 10. A strict order would give it 0 and the "
        "deployment would stop updating while the worker looked busy."
    )
    # Not merely served, but served regularly: no long run of the heavy lane.
    longest_gap = max(
        len(run)
        for run in "".join(
            "S" if lane == MANUAL_SINGLE_NORMAL_LANE else "A" for lane in served
        ).split("A")
    )
    assert longest_gap <= 3, (
        f"auto-sync waited {longest_gap} picks between turns; the weighting is "
        "meant to be smooth, not a burst of one lane followed by a burst of "
        "the other"
    )


def test_best_effort_never_runs_while_normal_tier_work_exists() -> None:
    """Checkbox 2's strict half. The best-effort lane here is the *heaviest*
    Budget and the normal one the lightest, so nothing but the tier rule can
    produce this answer."""
    scheduler = LaneScheduler()
    available = {AUTO_SYNC_NORMAL_LANE, MANUAL_SINGLE_BEST_EFFORT_LANE}
    assert _serve(scheduler, available, 20) == [AUTO_SYNC_NORMAL_LANE] * 20


def test_best_effort_is_reached_once_the_normal_tier_empties() -> None:
    """And is itself weighted, so the tier rule is not simply 'never'."""
    scheduler = LaneScheduler()
    assert scheduler.next_lane({AUTO_SYNC_NORMAL_LANE}) == AUTO_SYNC_NORMAL_LANE
    counts = Counter(_serve(scheduler, set(lanes_in_tier(TIER_BEST_EFFORT)), 6))
    assert counts[MANUAL_SINGLE_BEST_EFFORT_LANE] == 3
    assert counts[MANUAL_BULK_BEST_EFFORT_LANE] == 2
    assert counts[AUTO_SYNC_BEST_EFFORT_LANE] == 1


def test_normal_work_arriving_mid_drain_preempts_the_next_best_effort_pick() -> None:
    """The tier rule is re-evaluated on every call rather than latched, which is
    what makes it hold for a drain that started while the normal tier was
    empty — the common case, since best-effort backlogs are long."""
    scheduler = LaneScheduler()
    assert (
        scheduler.next_lane({AUTO_SYNC_BEST_EFFORT_LANE}) == AUTO_SYNC_BEST_EFFORT_LANE
    )
    assert (
        scheduler.next_lane({AUTO_SYNC_BEST_EFFORT_LANE, MANUAL_BULK_NORMAL_LANE})
        == MANUAL_BULK_NORMAL_LANE
    )


def test_an_idle_lane_does_not_bank_credit_and_spend_it_in_a_burst() -> None:
    """If credit accrued for lanes with nothing to do, an auto-sync lane idle
    for an hour would out-rank everything the moment work arrived and run a
    burst of syncs ahead of the person waiting at the screen."""
    scheduler = LaneScheduler()
    _serve(scheduler, {MANUAL_SINGLE_NORMAL_LANE}, picks=50)
    served = _serve(
        scheduler, {MANUAL_SINGLE_NORMAL_LANE, AUTO_SYNC_NORMAL_LANE}, picks=8
    )
    assert served.count(AUTO_SYNC_NORMAL_LANE) == 2, (
        "auto-sync took an unfair share immediately after being idle, which "
        "means credit accrued while it had nothing to do"
    )


def test_the_weights_are_the_ones_the_decision_names() -> None:
    """Pinned so a change to the ratio is a deliberate edit here rather than a
    number nudged in passing."""
    assert BUDGET_WEIGHTS == {
        Budget.MANUAL_SINGLE: 3,
        Budget.MANUAL_BULK: 2,
        Budget.AUTO_SYNC: 1,
    }
