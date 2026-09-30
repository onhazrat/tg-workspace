"""One Estimated View count, three implementations, one fixture (PFB-03, ADR-025).

The Python reach function, the SQL expression the feed filters and orders on,
and the browser twin semantic results go through all read
`tests/fixtures/estimated_views.json`. The browser half is
`frontend/src/lib/posts/estimated-views.test.ts`. Three copies of one formula
drifting apart is the likeliest defect here, and the feed tests alone would not
see the browser's.

The expected numbers in the fixture were computed by hand from the formula, not
by any of the three.

## Watched to fail

* divide by the raw share instead of the share anchored at the settling age
* `>` instead of `>=` at the settling age or the estimation floor
* interpolate the fitted curve in linear rather than log age
* and the fixture itself against a deliberately wrong curve, below
"""

from __future__ import annotations

import json
from pathlib import Path
from typing import Any

import pytest
from sqlalchemy import Float, literal, select
from sqlmodel import Session

from app.core.db import engine
from app.services.post_filters import estimated_views_sql
from app.services.reach import (
    CurvePoints,
    ReachSettings,
    estimated_views,
)

FIXTURE = json.loads(
    (Path(__file__).parents[1] / "fixtures" / "estimated_views.json").read_text()
)
CASES: list[dict[str, Any]] = FIXTURE["cases"]


def _curve(name: str) -> CurvePoints:
    spec = FIXTURE["curves"][name]
    return CurvePoints.from_wire(spec)


def _settings(case: dict[str, Any]) -> ReachSettings:
    return ReachSettings(
        settling_age_hours=case["settings"]["settlingAgeHours"],
        estimation_floor_hours=case["settings"]["estimationFloorHours"],
    )


def _python(case: dict[str, Any], curve: CurvePoints) -> float | None:
    return estimated_views(case["views"], case["ageHours"], _settings(case), curve)


def _sql(case: dict[str, Any], curve: CurvePoints) -> float | None:
    expr = estimated_views_sql(
        literal(case["views"], Float),
        literal(case["ageHours"], Float),
        curve,
        _settings(case),
    )
    with Session(engine) as session:
        value = session.execute(select(expr)).scalar_one()
    return None if value is None else float(value)


IMPLEMENTATIONS = {"python": _python, "sql": _sql}


@pytest.mark.parametrize("implementation", IMPLEMENTATIONS)
@pytest.mark.parametrize("case", CASES, ids=[c["name"] for c in CASES])
def test_each_implementation_matches_the_fixture(
    implementation: str, case: dict[str, Any]
) -> None:
    got = IMPLEMENTATIONS[implementation](case, _curve(case["curve"]))

    if case["expected"] is None:
        assert got is None
    else:
        assert got == pytest.approx(case["expected"], rel=1e-9)


@pytest.mark.parametrize("implementation", IMPLEMENTATIONS)
def test_a_wrong_curve_fails_the_fixture(implementation: str) -> None:
    """The fixture can tell a wrong curve from the right one, in each copy.

    A fixture every curve passes is no guard at all, so each implementation is
    run once against a curve that is wrong on purpose and must disagree with
    at least one estimated case.
    """
    wrong = CurvePoints("steps", ((0.0, 0.5), (12.0, 0.9)))
    mismatches = [
        case
        for case in CASES
        if case["expected"] not in (None, case["views"])
        and IMPLEMENTATIONS[implementation](case, wrong)
        != pytest.approx(case["expected"], rel=1e-9)
    ]

    assert mismatches
