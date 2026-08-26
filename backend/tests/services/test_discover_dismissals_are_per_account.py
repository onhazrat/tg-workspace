"""A dismissal is one account's judgement (ticket 30).

`tg_discover_ignored` was keyed by `handle` alone, so the first account to
dismiss `@foo` dismissed it for everybody. The fix is a composite primary key,
not a scoped read, and the difference matters: `ignore_channels` skips any
handle that already has a row, so scoping only the read would leave B's
dismissal writing nothing while a scoped read told B the handle was not
dismissed. B could never dismiss it and the button would silently do nothing.
`test_a_second_account_can_dismiss_what_the_first_already_dismissed` is that
regression, and it is the one test here that fails for a *functional* reason
rather than a visibility one.

## Why these run under both flag states

Every other tenancy guard asserts that scoping is invisible while
`TENANCY_ENFORCED` is off. This family is the exception, deliberately: the
owner is half the primary key, so filtering on it is row **identity**, not
visibility. A flag cannot gate identity — with the filter gated off, two
accounts would collide on one row again and the composite key would be
decoration. So `discover_ignored.py` filters on `user_id` directly rather than
through `scoped_select`, and every test below is parametrised over both flag
states to say so. Ticket 30's checkbox asks for exactly this ("both flag states
are green").

## Mutation-tested

Each guard was watched failing before being trusted:

* drop `user_id` from the primary key → the key test fails
* gate the filter behind `tenancy_enforced()` → the flag-off parametrisation
  fails, the flag-on one still passes (this is the shape a half-fix takes)
* restore the global `existing` set in `ignore_channels` → the second-account
  regression fails
* let `unignore_channels` resolve a row by handle alone → the cross-account
  delete test fails
* resolve `isIgnored` from every row in either computation site → the live and
  saved-report tests fail
"""

from __future__ import annotations

import uuid
from collections.abc import Iterator
from typing import Any

import pytest
from sqlmodel import Session, col, delete, select

from app.core.db import engine
from app.models import User
from app.models_tg import DiscoverIgnoredChannel, Post
from app.services.discover import compute_discover_candidates
from app.services.discover_ignored import (
    ignore_channels,
    ignored_handles,
    list_ignored,
    unignore_channels,
)
from app.services.discover_reports import create_report, report_to_camel
from app.services.follows import ensure_follow
from app.services.post_filters import PostFilters
from tests.utils.setting_groups import add_test_channel
from tests.utils.user import create_random_user

BOTH_FLAG_STATES = pytest.mark.parametrize("enforced", [False, True])


@pytest.fixture
def session() -> Iterator[Session]:
    with Session(engine) as s:
        yield s


@pytest.fixture
def user(session: Session) -> Iterator[User]:
    created = create_random_user(session)
    yield created
    session.exec(delete(User).where(col(User.id) == created.id))
    session.commit()


@pytest.fixture
def other_user(session: Session) -> Iterator[User]:
    created = create_random_user(session)
    yield created
    session.exec(delete(User).where(col(User.id) == created.id))
    session.commit()


def _set_flag(monkeypatch: pytest.MonkeyPatch, value: bool) -> None:
    """Turn the seam on or off for one test. See `test_tenancy_seam.py`."""
    from app.core import config

    monkeypatch.setattr(config.settings, "TENANCY_ENFORCED", value)


def _seed_posts(session: Session, sources: list[str], *followers: uuid.UUID) -> None:
    """Posts forwarded from `sources`, under a channel every follower follows.

    The follows are what keep these tests honest under enforcement: ticket 16
    scoped the candidate aggregation to Posts under followed Channels, so
    without them the flag-on runs would find no candidates at all and pass
    `isIgnored` assertions vacuously.
    """
    add_test_channel(session, "carrier", user_id=followers[0] if followers else None)
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
    for follower in followers:
        ensure_follow(session, channel_id="carrier", user_id=follower)
    session.commit()


def _candidate_flags(session: Session, viewer: uuid.UUID) -> dict[str, bool]:
    result = compute_discover_candidates(
        session, channel_names=["carrier"], user_id=viewer
    )
    return {c["name"]: bool(c["isIgnored"]) for c in result["candidates"]}


# --------------------------------------------------------------------------
# The key itself
# --------------------------------------------------------------------------


def test_the_primary_key_is_the_handle_and_the_owner() -> None:
    """Both halves, or one account's dismissal is still everybody's."""
    table = DiscoverIgnoredChannel.__table__  # type: ignore[attr-defined]
    assert {c.name for c in table.primary_key.columns} == {"handle", "user_id"}


def test_the_owner_is_a_cascading_foreign_key_and_never_null() -> None:
    """A composite primary key cannot hold NULL, so the column must be real.

    The cascade is what makes deleting an account take its dismissals with it;
    without it the FK would refuse the delete instead.
    """
    table = DiscoverIgnoredChannel.__table__  # type: ignore[attr-defined]
    assert table.c.user_id.nullable is False

    fks = [fk for fk in table.foreign_keys if fk.column.table.name == "user"]
    assert len(fks) == 1, "expected exactly one FK to the user table"
    assert fks[0].ondelete == "CASCADE"


def test_deleting_an_account_takes_its_dismissals(session: Session, user: User) -> None:
    assert user.id is not None
    ignore_channels(session, ["alpha_news"], user_id=user.id)
    assert ignored_handles(session, user_id=user.id) == {"alpha_news"}

    session.exec(delete(User).where(col(User.id) == user.id))
    session.commit()

    remaining = session.exec(
        select(DiscoverIgnoredChannel).where(
            col(DiscoverIgnoredChannel.user_id) == user.id
        )
    ).all()
    assert remaining == []


def test_the_aggregate_demands_an_owner_with_no_default() -> None:
    """A default owner is how a dismissal silently lands on the wrong account.

    `scoped_select`'s `user_id` is required for the same reason: a caller
    holding an optional id has to decide what that means, in the open.
    """
    import inspect

    for fn in (ignored_handles, list_ignored, ignore_channels, unignore_channels):
        param = inspect.signature(fn).parameters["user_id"]
        assert param.default is inspect.Parameter.empty, (
            f"{fn.__name__} gives user_id a default"
        )


# --------------------------------------------------------------------------
# The regression the ticket names
# --------------------------------------------------------------------------


@BOTH_FLAG_STATES
def test_a_second_account_can_dismiss_what_the_first_already_dismissed(
    session: Session,
    user: User,
    other_user: User,
    enforced: bool,
    monkeypatch: pytest.MonkeyPatch,
) -> None:
    """The functional half. Scoping only the read leaves B unable to dismiss.

    `ignore_channels` reported `[]` for B — no row written, nothing added — and
    a scoped read then told B the handle was not dismissed. The button did
    nothing, for ever, with no error anywhere.
    """
    _set_flag(monkeypatch, enforced)
    assert user.id is not None and other_user.id is not None

    assert ignore_channels(session, ["alpha_news"], user_id=user.id) == ["alpha_news"]
    assert ignore_channels(session, ["alpha_news"], user_id=other_user.id) == [
        "alpha_news"
    ]

    assert ignored_handles(session, user_id=user.id) == {"alpha_news"}
    assert ignored_handles(session, user_id=other_user.id) == {"alpha_news"}


@BOTH_FLAG_STATES
def test_re_dismissing_is_still_idempotent_for_one_account(
    session: Session,
    user: User,
    enforced: bool,
    monkeypatch: pytest.MonkeyPatch,
) -> None:
    """Per-account, not per-deployment. The UI still treats this as a toggle."""
    _set_flag(monkeypatch, enforced)
    assert user.id is not None

    assert ignore_channels(session, ["alpha_news"], user_id=user.id) == ["alpha_news"]
    assert ignore_channels(session, ["alpha_news"], user_id=user.id) == []


# --------------------------------------------------------------------------
# Opposite verdicts, neither visible to the other
# --------------------------------------------------------------------------


@BOTH_FLAG_STATES
def test_two_accounts_hold_opposite_verdicts_on_one_handle(
    session: Session,
    user: User,
    other_user: User,
    enforced: bool,
    monkeypatch: pytest.MonkeyPatch,
) -> None:
    _set_flag(monkeypatch, enforced)
    assert user.id is not None and other_user.id is not None

    ignore_channels(session, ["alpha_news"], user_id=user.id)

    assert ignored_handles(session, user_id=user.id) == {"alpha_news"}
    assert ignored_handles(session, user_id=other_user.id) == set()


@BOTH_FLAG_STATES
def test_listing_shows_only_the_callers_dismissals(
    session: Session,
    user: User,
    other_user: User,
    enforced: bool,
    monkeypatch: pytest.MonkeyPatch,
) -> None:
    _set_flag(monkeypatch, enforced)
    assert user.id is not None and other_user.id is not None

    ignore_channels(session, ["alpha_news"], user_id=user.id)
    ignore_channels(session, ["beta_daily"], user_id=other_user.id)

    assert [row["handle"] for row in list_ignored(session, user_id=user.id)] == [
        "alpha_news"
    ]
    assert [row["handle"] for row in list_ignored(session, user_id=other_user.id)] == [
        "beta_daily"
    ]


@BOTH_FLAG_STATES
def test_undoing_never_reaches_another_accounts_dismissal(
    session: Session,
    user: User,
    other_user: User,
    enforced: bool,
    monkeypatch: pytest.MonkeyPatch,
) -> None:
    """The `session.get(..., handle)` lookup deleted whichever row it found.

    Reported as removed, too — so the caller saw a success for a row that was
    never theirs and their own verdict was untouched.
    """
    _set_flag(monkeypatch, enforced)
    assert user.id is not None and other_user.id is not None

    ignore_channels(session, ["alpha_news"], user_id=user.id)

    assert unignore_channels(session, ["alpha_news"], user_id=other_user.id) == []
    assert ignored_handles(session, user_id=user.id) == {"alpha_news"}

    assert unignore_channels(session, ["alpha_news"], user_id=user.id) == ["alpha_news"]
    assert ignored_handles(session, user_id=user.id) == set()


@BOTH_FLAG_STATES
def test_undoing_one_account_leaves_the_others_verdict_standing(
    session: Session,
    user: User,
    other_user: User,
    enforced: bool,
    monkeypatch: pytest.MonkeyPatch,
) -> None:
    """Both dismissed it; one changed their mind. The other still means it."""
    _set_flag(monkeypatch, enforced)
    assert user.id is not None and other_user.id is not None

    ignore_channels(session, ["alpha_news"], user_id=user.id)
    ignore_channels(session, ["alpha_news"], user_id=other_user.id)

    unignore_channels(session, ["alpha_news"], user_id=user.id)

    assert ignored_handles(session, user_id=user.id) == set()
    assert ignored_handles(session, user_id=other_user.id) == {"alpha_news"}


# --------------------------------------------------------------------------
# Both places `isIgnored` is computed
# --------------------------------------------------------------------------


@BOTH_FLAG_STATES
def test_live_candidates_answer_isignored_for_the_viewer(
    session: Session,
    user: User,
    other_user: User,
    enforced: bool,
    monkeypatch: pytest.MonkeyPatch,
) -> None:
    _set_flag(monkeypatch, enforced)
    assert user.id is not None and other_user.id is not None
    _seed_posts(session, ["alpha_news", "beta_daily"], user.id, other_user.id)

    ignore_channels(session, ["alpha_news"], user_id=user.id)

    assert _candidate_flags(session, user.id)["alpha_news"] is True
    assert _candidate_flags(session, other_user.id)["alpha_news"] is False


@BOTH_FLAG_STATES
def test_a_saved_report_answers_isignored_for_the_viewer(
    session: Session,
    user: User,
    other_user: User,
    enforced: bool,
    monkeypatch: pytest.MonkeyPatch,
) -> None:
    """The second computation site, and the one ticket 16's review nearly missed.

    `report_to_camel` resolves `isIgnored` live rather than from the stored
    row, so a saved report and a live candidate list must agree for the same
    viewer — and disagree between two viewers.
    """
    _set_flag(monkeypatch, enforced)
    assert user.id is not None and other_user.id is not None
    _seed_posts(session, ["alpha_news", "beta_daily"], user.id, other_user.id)

    ignore_channels(session, ["alpha_news"], user_id=user.id)

    report = _make_report(session, user.id)

    mine = _report_flags(session, report, viewer=user.id)
    theirs = _report_flags(session, report, viewer=other_user.id)

    assert mine["alpha_news"] is True
    assert theirs["alpha_news"] is False


def _make_report(session: Session, owner: uuid.UUID) -> Any:
    from app.models_tg import DiscoverReport

    created = create_report(
        session,
        channel_names=["carrier"],
        start_date=None,
        end_date=None,
        signals=None,
        filters=PostFilters(),
        max_per_channel=0,
        user_id=owner,
    )
    return session.get(DiscoverReport, created["id"])


def _report_flags(session: Session, report: Any, viewer: uuid.UUID) -> dict[str, bool]:
    payload = report_to_camel(session, report, viewer_id=viewer)
    return {c["name"]: bool(c["isIgnored"]) for c in payload["candidates"]}
