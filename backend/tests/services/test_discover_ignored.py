"""Dismissed Discover candidates (IDEA-011 D8).

The point of the feature is that a rejection *persists across runs*, so the
cases that matter are the ones spanning a report boundary.

These are the feature's own tests and say nothing about tenancy — ticket 30's
`test_discover_dismissals_are_per_account.py` covers that. They do need a real
account, though: `user_id` became half the primary key and a cascading foreign
key, so `ANY_READER` — which deliberately names no account — would now fail the
constraint rather than standing in for a caller.
"""

from __future__ import annotations

import uuid
from collections.abc import Iterator

import pytest
from sqlmodel import Session, col, delete

from app.core.db import engine
from app.models import User
from app.models_tg import Post
from app.services.discover import compute_discover_candidates
from app.services.discover_ignored import (
    ignore_channels,
    ignored_handles,
    list_ignored,
    unignore_channels,
)
from app.services.discover_reports import create_report, get_report
from app.services.follows import ensure_follow
from app.services.post_filters import PostFilters
from tests.utils.setting_groups import add_test_channel
from tests.utils.user import create_random_user


@pytest.fixture
def session() -> Iterator[Session]:
    with Session(engine) as s:
        yield s


@pytest.fixture
def owner(session: Session) -> Iterator[uuid.UUID]:
    """One real account. Every dismissal below belongs to it."""
    created = create_random_user(session)
    assert created.id is not None
    yield created.id
    session.exec(delete(User).where(col(User.id) == created.id))
    session.commit()


def _seed(session: Session, sources: list[str], owner: uuid.UUID) -> None:
    """Posts forwarded from `sources`, under a channel `owner` follows.

    The follow is not decoration. Ticket 16 scoped the candidate aggregation to
    Posts under followed Channels, so without it these tests find no candidates
    once enforcement is on and every `isIgnored` assertion below passes
    vacuously — or raises `IndexError` on an empty list, which is how this was
    noticed.
    """
    add_test_channel(session, "carrier", user_id=owner)
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
    ensure_follow(session, channel_id="carrier", user_id=owner)
    session.commit()


def _make_report(session: Session, owner: uuid.UUID) -> dict:
    return create_report(
        session,
        channel_names=["carrier"],
        start_date=None,
        end_date=None,
        signals=None,
        filters=PostFilters(),
        max_per_channel=0,
        user_id=owner,
    )


def test_ignoring_marks_the_candidate_in_new_reports(
    session: Session, owner: uuid.UUID
) -> None:
    _seed(session, ["alpha_news", "beta_daily"], owner)
    ignore_channels(session, ["alpha_news"], user_id=owner)

    result = compute_discover_candidates(
        session, channel_names=["carrier"], user_id=owner
    )
    by_name = {c["name"]: c for c in result["candidates"]}
    assert by_name["alpha_news"]["isIgnored"] is True
    assert by_name["beta_daily"]["isIgnored"] is False


def test_dismissal_applies_to_reports_generated_before_it(
    session: Session, owner: uuid.UUID
) -> None:
    """Dismissing is current state, not history — every saved report reflects it."""
    _seed(session, ["alpha_news"], owner)
    report = _make_report(session, owner)
    assert report["candidates"][0]["isIgnored"] is False

    ignore_channels(session, ["alpha_news"], user_id=owner)

    refetched = get_report(session, report["id"], user_id=owner)
    assert refetched["candidates"][0]["isIgnored"] is True


def test_undo_restores_the_candidate_everywhere(
    session: Session, owner: uuid.UUID
) -> None:
    _seed(session, ["alpha_news"], owner)
    report = _make_report(session, owner)
    ignore_channels(session, ["alpha_news"], user_id=owner)
    unignore_channels(session, ["alpha_news"], user_id=owner)

    refetched = get_report(session, report["id"], user_id=owner)
    assert refetched["candidates"][0]["isIgnored"] is False
    assert ignored_handles(session, user_id=owner) == set()


def test_handles_are_normalized(session: Session, owner: uuid.UUID) -> None:
    """`@Alpha_News` and `alpha_news` are the same channel."""
    _seed(session, ["alpha_news"], owner)
    ignore_channels(session, ["@Alpha_News"], user_id=owner)

    assert ignored_handles(session, user_id=owner) == {"alpha_news"}
    result = compute_discover_candidates(
        session, channel_names=["carrier"], user_id=owner
    )
    assert result["candidates"][0]["isIgnored"] is True


def test_ignoring_is_idempotent(session: Session, owner: uuid.UUID) -> None:
    assert ignore_channels(session, ["alpha_news"], user_id=owner) == ["alpha_news"]
    # Second call adds nothing and must not raise on the primary key.
    assert ignore_channels(session, ["alpha_news"], user_id=owner) == []
    assert len(list_ignored(session, user_id=owner)) == 1


def test_ignoring_dedupes_within_one_call(session: Session, owner: uuid.UUID) -> None:
    added = ignore_channels(
        session, ["alpha_news", "@alpha_news", "beta"], user_id=owner
    )
    assert sorted(added) == ["alpha_news", "beta"]


def test_unignoring_an_unknown_handle_is_a_no_op(
    session: Session, owner: uuid.UUID
) -> None:
    assert unignore_channels(session, ["never_seen"], user_id=owner) == []


def test_ignoring_does_not_remove_the_candidate_from_the_report(
    session: Session, owner: uuid.UUID
) -> None:
    """Dismissal is a *flag*, so the row stays available under the Ignored filter.

    Deleting it from the stored report would make the dismissal irreversible in
    practice — there would be nothing left to un-dismiss from.
    """
    _seed(session, ["alpha_news", "beta_daily"], owner)
    ignore_channels(session, ["alpha_news"], user_id=owner)
    report = _make_report(session, owner)

    assert report["candidateCount"] == 2
    assert {c["name"] for c in report["candidates"]} == {
        "alpha_news",
        "beta_daily",
    }


def test_list_reports_reason_and_creation_time(
    session: Session, owner: uuid.UUID
) -> None:
    ignore_channels(session, ["alpha_news"], reason="off topic", user_id=owner)
    rows = list_ignored(session, user_id=owner)
    assert rows[0]["handle"] == "alpha_news"
    assert rows[0]["reason"] == "off topic"
    assert rows[0]["createdAt"] > 0
