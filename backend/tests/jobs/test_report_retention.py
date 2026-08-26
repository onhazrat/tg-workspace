"""Retention for saved Discover reports.

Reports are the one table that grows per user action with no natural bound — each
Generate stores its whole candidate list, tail included, as a JSON blob — and
until now nothing pruned them.
"""

from __future__ import annotations

import uuid

from sqlmodel import Session, col, select

from app.core.db import engine
from app.jobs.retention import _prune_discover_reports
from app.jobs.settings import load_retention_settings, save_settings_section
from app.models_tg import DiscoverReport, utc_now
from tests.utils.user import create_random_user

DAY_MS = 24 * 60 * 60 * 1000


def _now_ms() -> int:
    return int(utc_now().timestamp() * 1000)


def _owner(session: Session) -> uuid.UUID:
    return create_random_user(session).id


def _report(
    session: Session,
    report_id: str,
    *,
    user_id: uuid.UUID,
    age_days: int = 0,
) -> None:
    session.add(
        DiscoverReport(
            id=report_id,
            user_id=user_id,
            channels=["carrier"],
            candidates=[{"name": "alpha_news", "total": 1}],
            timestamp=_now_ms() - age_days * DAY_MS,
        )
    )
    session.commit()


def _remaining(session: Session) -> list[str]:
    rows = session.exec(
        select(DiscoverReport).order_by(col(DiscoverReport.timestamp).desc())
    ).all()
    return [row.id for row in rows]


def test_reports_past_the_age_window_are_deleted() -> None:
    with Session(engine) as session:
        me = _owner(session)
        _report(session, "fresh", user_id=me, age_days=1)
        _report(session, "stale", user_id=me, age_days=120)

        assert (
            _prune_discover_reports(session, user_id=me, max_days=90, max_count=0) == 1
        )
        assert _remaining(session) == ["fresh"]


def test_only_the_newest_n_reports_survive_the_count_cap() -> None:
    """The cap that actually bounds size — an age window alone does not.

    A burst of reports generated in one afternoon is all within any age window,
    so without a count cap the table grows as fast as someone clicks Generate.
    """
    with Session(engine) as session:
        me = _owner(session)
        for i in range(5):
            _report(session, f"r{i}", user_id=me, age_days=i)

        assert (
            _prune_discover_reports(session, user_id=me, max_days=0, max_count=2) == 3
        )
        assert _remaining(session) == ["r0", "r1"]


def test_zero_disables_each_cap_independently() -> None:
    """Disabling is the opt-out, which is why the job needs no floor guard."""
    with Session(engine) as session:
        me = _owner(session)
        _report(session, "ancient", user_id=me, age_days=5000)
        _report(session, "also_ancient", user_id=me, age_days=4000)

        assert (
            _prune_discover_reports(session, user_id=me, max_days=0, max_count=0) == 0
        )
        assert len(_remaining(session)) == 2


def test_the_caps_combine_without_double_counting() -> None:
    with Session(engine) as session:
        me = _owner(session)
        _report(session, "keep", user_id=me, age_days=1)
        _report(session, "too_old", user_id=me, age_days=200)
        _report(session, "surplus", user_id=me, age_days=2)

        # too_old goes on age; surplus goes because only 1 may remain.
        assert (
            _prune_discover_reports(session, user_id=me, max_days=90, max_count=1) == 2
        )
        assert _remaining(session) == ["keep"]


def test_the_newest_report_is_not_protected() -> None:
    """Policy is policy: Discover falls back to its empty state.

    The alternative — a hard floor of one — would mean an operator who set a tight
    window still keeps a report they asked to have deleted.
    """
    with Session(engine) as session:
        me = _owner(session)
        _report(session, "only_one", user_id=me, age_days=200)

        assert (
            _prune_discover_reports(session, user_id=me, max_days=90, max_count=0) == 1
        )
        assert _remaining(session) == []


def test_retention_settings_expose_both_report_caps() -> None:
    with Session(engine) as session:
        loaded = load_retention_settings(session)
        assert loaded["reportRetentionDays"] == 90
        assert loaded["reportRetentionMax"] == 50


def test_stored_report_caps_override_the_defaults() -> None:
    """And they are stored per account since ticket 20.

    The facade still answers in the old blob shape, so the endpoint and the
    generated client did not change; underneath, the caps went to this
    account's `retention_prefs` row and the corpus window stayed global.
    """
    with Session(engine) as session:
        me = _owner(session)
        save_settings_section(
            session,
            "retention",
            {"reportRetentionDays": 0, "reportRetentionMax": 3},
            user_id=me,
        )
        loaded = load_retention_settings(session, user_id=me)
        assert loaded["reportRetentionDays"] == 0
        assert loaded["reportRetentionMax"] == 3
        # Untouched keys still fall back to their defaults.
        assert loaded["postRetentionDays"] == 90


def test_report_caps_do_not_reach_another_accounts_reports() -> None:
    """The point of the split: my count cap prunes my reports and only mine.

    Applied across the whole table, one account generating a burst pushed every
    other account's newest report past the offset and deleted it.
    """
    with Session(engine) as session:
        me = _owner(session)
        you = _owner(session)
        _report(session, "mine_new", user_id=me, age_days=1)
        _report(session, "mine_old", user_id=me, age_days=2)
        _report(session, "yours_old", user_id=you, age_days=300)

        assert (
            _prune_discover_reports(session, user_id=me, max_days=90, max_count=1) == 1
        )
        assert sorted(_remaining(session)) == ["mine_new", "yours_old"]
