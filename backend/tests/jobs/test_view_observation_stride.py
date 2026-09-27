"""The Observation stride adapts to the row cap (REACH-06, ADR-024).

The decision is a pure function of (rows now, inflow over the last 6 hours,
rows expiring within the next 6, cap, stride); the hourly job gathers those
numbers from `tg_view_observations`, stores the answer, and on a doubling
deletes the rows the new stride no longer selects.

## Watched to fail

* `>=` for `>` on the doubling test → the at-the-cap case doubles
* halve on the plain forecast instead of doubled inflow → the between case halves
* drop `stride > 1` → the floor case answers 0
* delete on the old stride's selection → the doubling keeps posts 3 and 7
* delete on a halving too → the halving loses rows
* skip the setting write → the stored stride stays where it was
* count no inflow, or count the young rows as expiring → the doubling holds
"""

from __future__ import annotations

import asyncio
import time
from unittest.mock import patch

import pytest
from sqlmodel import Session, col, select

from app.core.config import settings
from app.core.db import engine
from app.jobs.view_observation_stride import run_view_observation_stride
from app.models_tg import Post, ViewObservation
from app.services.settings_registry import VIEW_OBSERVATIONS_KEY
from app.services.settings_store import put_global_setting
from app.services.view_observations import next_stride, observation_stride
from tests.utils.tenancy import follow_channels

CAP = 1_000_000
HOUR_MS = 60 * 60 * 1000
CHANNEL = "stridechan"


@pytest.mark.parametrize(
    ("rows", "inflow", "expiring", "stride", "expected"),
    [
        # Forecast 1,050,000 over the cap: double.
        (900_000, 200_000, 50_000, 1, 2),
        (900_000, 200_000, 50_000, 8, 16),
        # Forecast exactly at the cap holds; only exceeding it doubles.
        (900_000, 150_000, 50_000, 4, 4),
        # Doubled-inflow forecast 400,000 + 200,000 - 100,000 = 500,000 is not
        # under half the cap: hold, though the plain forecast is far under it.
        (400_000, 100_000, 100_000, 4, 4),
        # Doubled-inflow forecast 499,999: halve.
        (399_999, 100_000, 100_000, 4, 2),
        # Never below 1.
        (0, 0, 0, 1, 1),
    ],
)
def test_the_stride_follows_the_forecast(
    rows: int, inflow: int, expiring: int, stride: int, expected: int
) -> None:
    assert next_stride(rows, inflow, expiring, CAP, stride) == expected


def test_a_quiet_hour_after_a_busy_one_does_not_flap() -> None:
    # A busy evening pushes the forecast over the cap.
    stride = next_stride(900_000, 200_000, 50_000, CAP, 1)
    assert stride == 2
    # The doubling deleted about half the table and the evening went quiet:
    # inflow halves again, and the plain forecast (475,000) sits under half the
    # cap. Halving on that would win the rows back and double again tomorrow.
    assert next_stride(450_000, 50_000, 25_000, CAP, stride) == 2


def _seed(stride: int) -> None:
    """Posts 1..8 of one Channel, one sighting each, an hour old."""
    now = int(time.time() * 1000)
    with Session(engine) as session:
        follow_channels(session, CHANNEL)
        put_global_setting(session, VIEW_OBSERVATIONS_KEY, {"stride": stride})
        for post_id in range(1, 9):
            post = Post(
                channel_name=CHANNEL,
                post_id=post_id,
                text=f"post {post_id}",
                timestamp=now - 2 * HOUR_MS,
            )
            session.add(post)
            session.flush()
            session.add(
                ViewObservation(
                    post_uuid=post.id,
                    observed_at=now - HOUR_MS,
                    views_count=100,
                    published_at=now - 2 * HOUR_MS,
                )
            )
        session.commit()


def _observed_post_ids() -> list[int]:
    with Session(engine) as session:
        return sorted(
            session.exec(
                select(Post.post_id).join(
                    ViewObservation, col(ViewObservation.post_uuid) == col(Post.id)
                )
            ).all()
        )


def _stored_stride() -> int:
    with Session(engine) as session:
        return observation_stride(session)


def _tick(cap: int) -> dict[str, int]:
    with patch.object(settings, "VIEW_OBSERVATION_ROW_CAP", cap):
        return asyncio.run(run_view_observation_stride())


def test_a_doubling_deletes_exactly_the_rows_no_longer_selected(db: Session) -> None:
    # Stride 2, but rows for every Post: the doubling to 4 keeps 1 and 5 only,
    # which a delete on the old stride's selection (1, 3, 5, 7) would not.
    _seed(stride=2)

    # 8 rows plus 8 inflow is 16, over a cap of 10.
    result = _tick(cap=10)

    assert result["stride"] == 4
    assert result["deleted"] == 6
    assert _observed_post_ids() == [1, 5]
    assert _stored_stride() == 4


def test_a_halving_deletes_nothing(db: Session) -> None:
    _seed(stride=4)

    # 8 rows plus twice 8 inflow is 24, under half a cap of 100.
    result = _tick(cap=100)

    assert result["stride"] == 2
    assert result["deleted"] == 0
    assert _observed_post_ids() == list(range(1, 9))
    assert _stored_stride() == 2
