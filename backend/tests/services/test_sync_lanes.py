"""The lane names in code and in the migrations agree (tickets 09, 10).

A lane exists because a migration ran `pgmq.create('<name>')`. The worker reads
`<name>` from `app/services/sync_lanes.py`. Nothing connects the two but the
spelling, so renaming a constant leaves the worker reading a queue that was
never created — and `pgmq.read` on a missing queue raises, which means *every*
sweep fails and every queued sync stops, for a rename that looked local.

The migration deliberately hard-codes its strings (a migration must keep
describing the schema it created even after the constant it was named for is
gone), so this is the join between them.
"""

from __future__ import annotations

import pathlib
import re

from app.services.quota import Budget
from app.services.sync_lanes import (
    AUTO_SYNC_NORMAL_LANE,
    DRAIN_ORDER,
    MANUAL_BULK_NORMAL_LANE,
    MANUAL_SINGLE_NORMAL_LANE,
    TIER_NORMAL,
    lane_for_budget,
)

_VERSIONS = pathlib.Path(__file__).resolve().parents[2] / "app" / "alembic" / "versions"


def _lanes_created_by_migrations() -> set[str]:
    """Every queue name any migration passes to `pgmq.create`."""
    created: set[str] = set()
    for path in _VERSIONS.glob("*.py"):
        text = path.read_text()
        created.update(re.findall(r"pgmq\.create\('([a-z_]+)'\)", text))
        # The ticket-10 migration builds its names from a tuple and calls
        # `pgmq.create` through a `DO` block, so pick those up too.
        if "_LANES = (" in text:
            block = text.split("_LANES = (", 1)[1].split(")", 1)[0]
            created.update(re.findall(r'"([a-z_]+)"', block))
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
    """The names are a product, not three literals — `lane_for_budget` is what
    ticket 12 extends to the best-effort tier, and it must keep agreeing with
    the constants the migrations spelled out."""
    assert lane_for_budget(Budget.MANUAL_SINGLE) == MANUAL_SINGLE_NORMAL_LANE
    assert lane_for_budget(Budget.MANUAL_BULK) == MANUAL_BULK_NORMAL_LANE
    assert lane_for_budget(Budget.AUTO_SYNC) == AUTO_SYNC_NORMAL_LANE
    for lane in DRAIN_ORDER:
        assert lane.endswith(f"_{TIER_NORMAL}"), (
            f"{lane} is drained but is not a normal-tier lane; strict "
            "tier ordering is ticket 12's and does not exist yet"
        )


def test_every_budget_has_a_lane_in_the_drain_order() -> None:
    """A Budget with no lane is work that can be charged but never queued."""
    for budget in Budget:
        assert lane_for_budget(budget) in DRAIN_ORDER, (
            f"{budget.value} has no normal-tier lane in DRAIN_ORDER, so a sync "
            "charged against it would be enqueued onto a lane nobody drains"
        )
