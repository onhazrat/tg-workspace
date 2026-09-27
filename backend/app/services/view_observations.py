"""Aggregate for `tg_view_observations` (REACH-05, ADR-024).

The only module that writes the table. A View observation is one sighting of a
Post's View count with its age at the sighting, kept so the Settling curve can
be fitted from how View counts climb. Two rules bound the table:

* **The Observation stride** picks which Posts are observed at all:
  `(post_id - 1) % stride == 0`, `post_id` being Telegram's per-Channel id.
  A Post selected at stride `2s` is selected at stride `s`, so doubling the
  stride only removes rows and halving it only adds future ones. The stride
  is deployment state in `tg_app_settings` (`settings_registry`), written by
  the stride controller (REACH-06); no row reads as 1, every Post.
* **The 14-day window**: a Post's rows are deleted together once it is 14 days
  past publication, by its own retention rule rather than a window on an
  existing one, and a sighting already past the window is never written.
* **The row cap** (`VIEW_OBSERVATION_ROW_CAP`): an hourly job
  (`jobs/view_observation_stride.py`) forecasts the table 6 hours ahead and
  doubles or halves the stride through `next_stride`, deleting the rows a
  doubling no longer selects (REACH-06).

A sighting whose page showed no View count is not a sighting of anything and
is skipped. A replayed sighting (the same Post at the same instant, which an
import of this deployment's own export produces) is a primary-key conflict
and is dropped.
"""

from __future__ import annotations

import uuid
from collections.abc import Iterable
from typing import Any, NamedTuple, cast

from sqlalchemy import delete, func, select
from sqlalchemy.dialects.postgresql import insert
from sqlmodel import Session, col

from app.models_tg import Post, ViewObservation
from app.services.settings_registry import VIEW_OBSERVATIONS_KEY
from app.services.settings_store import get_global_setting, put_global_setting

#: How long after publication a Post's sightings are kept.
OBSERVATION_WINDOW_MS = 14 * 24 * 60 * 60 * 1000

#: How far ahead the stride controller forecasts, and the span its inflow is
#: measured over.
FORECAST_HORIZON_MS = 6 * 60 * 60 * 1000


class Sighting(NamedTuple):
    """What the Post write path saw of one Post, before the stride decides."""

    post_uuid: uuid.UUID
    post_id: int
    views_count: int | None
    published_at: int
    observed_at: int


def observation_stride(session: Session) -> int:
    """The current Observation stride, 1 when unset or unreadable.

    `PUT /data/settings/{key}` writes any JSON to a global key, so a hand-edited
    row reaches this line; it runs on every sync page and must not raise.
    """
    stored = get_global_setting(session, VIEW_OBSERVATIONS_KEY).get("stride")
    if isinstance(stored, int) and not isinstance(stored, bool) and stored >= 1:
        return stored
    return 1


def is_observed(post_id: int, stride: int) -> bool:
    """Whether the stride selects this Telegram post id."""
    return (post_id - 1) % stride == 0


def next_stride(rows: int, inflow: int, expiring: int, cap: int, stride: int) -> int:
    """The stride for the next hour, from a forecast `FORECAST_HORIZON_MS` ahead.

    `inflow` is the rows written over the last horizon and `expiring` the rows
    whose Posts pass the 14-day window within the next one. Doubles when the
    forecast exceeds the cap. Halves only when the forecast at *doubled*
    inflow, which is what halving the stride roughly does to inflow, stays
    under half the cap: the two thresholds sit a full doubling apart, so the
    rows a doubling removes cannot at once earn a halving back.
    """
    if rows + inflow - expiring > cap:
        return stride * 2
    if stride > 1 and rows + 2 * inflow - expiring < cap / 2:
        return stride // 2
    return stride


class TableLoad(NamedTuple):
    """What `next_stride` reads about the table, in one scan of it."""

    rows: int
    inflow: int
    expiring: int


def table_load(session: Session, now_ms: int) -> TableLoad:
    """Rows now, written over the last horizon, and expiring within the next.

    `expiring` also counts rows already past the window that the retention
    sweep has not reached yet, which is right: they are gone before the
    forecast's horizon too.
    """
    since = now_ms - FORECAST_HORIZON_MS
    expire_before = now_ms + FORECAST_HORIZON_MS - OBSERVATION_WINDOW_MS
    rows, inflow, expiring = session.execute(
        select(
            func.count(),
            func.count().filter(col(ViewObservation.observed_at) >= since),
            func.count().filter(col(ViewObservation.published_at) < expire_before),
        ).select_from(ViewObservation)
    ).one()
    return TableLoad(rows, inflow, expiring)


def apply_stride(session: Session, old: int, new: int) -> int:
    """Store `new` as the stride, and on a doubling delete what it deselects.

    Commits, and the delete lands in the same transaction as the stride. A
    halving deletes nothing: a Post selected at `s` is selected at `s / 2`, so
    halving only lets future sightings in. Returns the rows deleted.
    """
    deleted = 0
    if new > old:
        # `DELETE ... USING tg_posts`: the selection is on Telegram's post id,
        # which only the Post carries.
        result = session.execute(
            delete(ViewObservation).where(
                col(ViewObservation.post_uuid) == col(Post.id),
                (col(Post.post_id) - 1) % new != 0,
            )
        )
        deleted = cast(Any, result).rowcount or 0
    put_global_setting(session, VIEW_OBSERVATIONS_KEY, {"stride": new})
    return deleted


def record_view_observations(session: Session, sightings: Iterable[Sighting]) -> int:
    """Write a row for each sighting the stride selects. Does not commit.

    Flushes first, because a Post first captured on this page is still pending
    in the session and its sighting's foreign key has to find it. Returns the
    rows offered to the insert.
    """
    in_window = [
        s
        for s in sightings
        if s.views_count is not None
        and s.observed_at - s.published_at < OBSERVATION_WINDOW_MS
    ]
    if not in_window:
        return 0
    stride = observation_stride(session)
    rows = [
        {
            "post_uuid": s.post_uuid,
            "observed_at": s.observed_at,
            "views_count": s.views_count,
            "published_at": s.published_at,
        }
        for s in in_window
        if is_observed(s.post_id, stride)
    ]
    if not rows:
        return 0
    session.flush()
    session.execute(insert(ViewObservation).values(rows).on_conflict_do_nothing())
    return len(rows)


def prune_view_observations(session: Session, now_ms: int) -> int:
    """Delete the rows of every Post 14 days past publication. Does not commit."""
    result = session.execute(
        delete(ViewObservation).where(
            col(ViewObservation.published_at) < now_ms - OBSERVATION_WINDOW_MS
        )
    )
    return cast(Any, result).rowcount or 0
