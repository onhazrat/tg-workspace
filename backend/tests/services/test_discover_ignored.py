"""Dismissed Discover candidates (IDEA-011 D8).

The point of the feature is that a rejection *persists across runs*, so the
cases that matter are the ones spanning a report boundary.
"""

from __future__ import annotations

from sqlmodel import Session

from app.core.db import engine
from app.models_tg import Post
from app.services.discover import compute_discover_candidates
from app.services.discover_ignored import (
    ignore_channels,
    ignored_handles,
    list_ignored,
    unignore_channels,
)
from app.services.discover_reports import create_report, get_report
from app.services.post_filters import PostFilters
from tests.utils.tenancy import ANY_READER


def _seed(session: Session, sources: list[str]) -> None:
    for i, source in enumerate(sources):
        session.add(
            Post(
                channel_name="carrier",
                post_id=i,
                text=f"Post {i}",
                timestamp=1000 + i,
                forwarded_from=source,
            )
        )
    session.commit()


def _make_report(session: Session) -> dict:
    return create_report(
        session,
        channel_names=["carrier"],
        start_date=None,
        end_date=None,
        signals=None,
        filters=PostFilters(),
        max_per_channel=0,
        user_id=ANY_READER,
    )


def test_ignoring_marks_the_candidate_in_new_reports() -> None:
    with Session(engine) as session:
        _seed(session, ["alpha_news", "beta_daily"])
        ignore_channels(session, ["alpha_news"])

        result = compute_discover_candidates(
            session, channel_names=["carrier"], user_id=ANY_READER
        )
        by_name = {c["name"]: c for c in result["candidates"]}
        assert by_name["alpha_news"]["isIgnored"] is True
        assert by_name["beta_daily"]["isIgnored"] is False


def test_dismissal_applies_to_reports_generated_before_it() -> None:
    """Dismissing is current state, not history — every saved report reflects it."""
    with Session(engine) as session:
        _seed(session, ["alpha_news"])
        report = _make_report(session)
        assert report["candidates"][0]["isIgnored"] is False

        ignore_channels(session, ["alpha_news"])

        refetched = get_report(session, report["id"], user_id=ANY_READER)
        assert refetched["candidates"][0]["isIgnored"] is True


def test_undo_restores_the_candidate_everywhere() -> None:
    with Session(engine) as session:
        _seed(session, ["alpha_news"])
        report = _make_report(session)
        ignore_channels(session, ["alpha_news"])
        unignore_channels(session, ["alpha_news"])

        refetched = get_report(session, report["id"], user_id=ANY_READER)
        assert refetched["candidates"][0]["isIgnored"] is False
        assert ignored_handles(session) == set()


def test_handles_are_normalized() -> None:
    """`@Alpha_News` and `alpha_news` are the same channel."""
    with Session(engine) as session:
        _seed(session, ["alpha_news"])
        ignore_channels(session, ["@Alpha_News"])

        assert ignored_handles(session) == {"alpha_news"}
        result = compute_discover_candidates(
            session, channel_names=["carrier"], user_id=ANY_READER
        )
        assert result["candidates"][0]["isIgnored"] is True


def test_ignoring_is_idempotent() -> None:
    with Session(engine) as session:
        assert ignore_channels(session, ["alpha_news"]) == ["alpha_news"]
        # Second call adds nothing and must not raise on the primary key.
        assert ignore_channels(session, ["alpha_news"]) == []
        assert len(list_ignored(session)) == 1


def test_ignoring_dedupes_within_one_call() -> None:
    with Session(engine) as session:
        added = ignore_channels(session, ["alpha_news", "@alpha_news", "beta"])
        assert sorted(added) == ["alpha_news", "beta"]


def test_unignoring_an_unknown_handle_is_a_no_op() -> None:
    with Session(engine) as session:
        assert unignore_channels(session, ["never_seen"]) == []


def test_ignoring_does_not_remove_the_candidate_from_the_report() -> None:
    """Dismissal is a *flag*, so the row stays available under the Ignored filter.

    Deleting it from the stored report would make the dismissal irreversible in
    practice — there would be nothing left to un-dismiss from.
    """
    with Session(engine) as session:
        _seed(session, ["alpha_news", "beta_daily"])
        ignore_channels(session, ["alpha_news"])
        report = _make_report(session)

        assert report["candidateCount"] == 2
        assert {c["name"] for c in report["candidates"]} == {
            "alpha_news",
            "beta_daily",
        }


def test_list_reports_reason_and_creation_time() -> None:
    with Session(engine) as session:
        ignore_channels(session, ["alpha_news"], reason="off topic")
        rows = list_ignored(session)
        assert rows[0]["handle"] == "alpha_news"
        assert rows[0]["reason"] == "off topic"
        assert rows[0]["createdAt"] > 0
