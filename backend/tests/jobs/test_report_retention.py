"""Retention for saved Discover reports.

Reports are the one table that grows per user action with no natural bound — each
Generate stores its whole candidate list, tail included, as a JSON blob — and
until now nothing pruned them.
"""

from __future__ import annotations

from sqlmodel import Session, col, select

from app.core.db import engine
from app.jobs.retention import _prune_discover_reports
from app.jobs.settings import load_retention_settings, save_setting
from app.models_tg import DiscoverReport, utc_now

DAY_MS = 24 * 60 * 60 * 1000


def _now_ms() -> int:
    return int(utc_now().timestamp() * 1000)


def _report(session: Session, report_id: str, *, age_days: int = 0) -> None:
    session.add(
        DiscoverReport(
            id=report_id,
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
        _report(session, "fresh", age_days=1)
        _report(session, "stale", age_days=120)

        assert _prune_discover_reports(session, max_days=90, max_count=0) == 1
        assert _remaining(session) == ["fresh"]


def test_only_the_newest_n_reports_survive_the_count_cap() -> None:
    """The cap that actually bounds size — an age window alone does not.

    A burst of reports generated in one afternoon is all within any age window,
    so without a count cap the table grows as fast as someone clicks Generate.
    """
    with Session(engine) as session:
        for i in range(5):
            _report(session, f"r{i}", age_days=i)

        assert _prune_discover_reports(session, max_days=0, max_count=2) == 3
        assert _remaining(session) == ["r0", "r1"]


def test_zero_disables_each_cap_independently() -> None:
    """Disabling is the opt-out, which is why the job needs no floor guard."""
    with Session(engine) as session:
        _report(session, "ancient", age_days=5000)
        _report(session, "also_ancient", age_days=4000)

        assert _prune_discover_reports(session, max_days=0, max_count=0) == 0
        assert len(_remaining(session)) == 2


def test_the_caps_combine_without_double_counting() -> None:
    with Session(engine) as session:
        _report(session, "keep", age_days=1)
        _report(session, "too_old", age_days=200)
        _report(session, "surplus", age_days=2)

        # too_old goes on age; surplus goes because only 1 may remain.
        assert _prune_discover_reports(session, max_days=90, max_count=1) == 2
        assert _remaining(session) == ["keep"]


def test_the_newest_report_is_not_protected() -> None:
    """Policy is policy: Discover falls back to its empty state.

    The alternative — a hard floor of one — would mean an operator who set a tight
    window still keeps a report they asked to have deleted.
    """
    with Session(engine) as session:
        _report(session, "only_one", age_days=200)

        assert _prune_discover_reports(session, max_days=90, max_count=0) == 1
        assert _remaining(session) == []


def test_retention_settings_expose_both_report_caps() -> None:
    with Session(engine) as session:
        loaded = load_retention_settings(session)
        assert loaded["reportRetentionDays"] == 90
        assert loaded["reportRetentionMax"] == 50


def test_stored_report_caps_override_the_defaults() -> None:
    with Session(engine) as session:
        save_setting(
            session,
            "retention",
            {"reportRetentionDays": 0, "reportRetentionMax": 3},
        )
        loaded = load_retention_settings(session)
        assert loaded["reportRetentionDays"] == 0
        assert loaded["reportRetentionMax"] == 3
        # Untouched keys still fall back to their defaults.
        assert loaded["postRetentionDays"] == 90
