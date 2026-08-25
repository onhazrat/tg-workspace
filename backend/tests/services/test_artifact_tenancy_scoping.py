"""Ticket 17: summaries, chats, tag runs, reports, and the History over all four.

With `TENANCY_ENFORCED` on, each family's list shows only the caller's own rows
and every by-id operation on a foreign row answers **404 with that family's own
detail string** — not 403, which would confirm the row exists, and not a
generic `"Not found"`, which would move the same oracle into the body.

Two things here are not the wiring.

**The battery is parametrised over the four families rather than written out
four times.** These are four near-copies of one module — `chat_sessions.py`
says so in its own docstring — and the repo's twin-module rule is that a fix
applied to one of a pair is half a fix. A fifth family added without scoping
fails `test_every_family_is_covered_by_this_battery` rather than passing
silently because nobody wrote its four tests.

**Writes are in scope, not only reads.** `upsert_*` merges into whatever row
its id names, so a scoped read over a writable row would let a second account
overwrite the first's summary by guessing an id — a leak that a read-only guard
passes with full marks.
"""

from __future__ import annotations

import uuid
from collections.abc import Callable
from dataclasses import dataclass
from typing import Any

import pytest
from fastapi import HTTPException
from sqlmodel import Session, col, delete

from app.core.db import engine
from app.models import User
from app.models_tg import ChatSession, DiscoverReport, Summary, TagRun
from app.services.artifacts import ARTIFACT_KINDS, list_artifacts
from app.services.chat_sessions import (
    delete_chat_session,
    get_chat_session,
    list_chat_sessions,
    upsert_chat_session,
)
from app.services.discover_reports import (
    delete_report,
    get_report,
    list_reports,
    update_report_flags,
)
from app.services.summaries import (
    delete_summary,
    get_summary,
    list_summaries,
    upsert_summary,
)
from app.services.tag_runs import (
    delete_tag_run,
    get_tag_run,
    list_tag_runs,
    upsert_tag_run,
)
from tests.utils.user import create_random_user


@pytest.fixture
def session() -> Session:
    with Session(engine) as s:
        yield s


@pytest.fixture
def user(session: Session) -> User:
    created = create_random_user(session)
    yield created
    session.exec(delete(User).where(col(User.id) == created.id))
    session.commit()


@pytest.fixture
def other_user(session: Session) -> User:
    created = create_random_user(session)
    yield created
    session.exec(delete(User).where(col(User.id) == created.id))
    session.commit()


@pytest.fixture
def enforced(monkeypatch: pytest.MonkeyPatch) -> None:
    """Turn the seam on for one test. See `test_tenancy_seam.py`."""
    from app.core import config

    monkeypatch.setattr(config.settings, "TENANCY_ENFORCED", True)


@pytest.fixture
def unenforced(monkeypatch: pytest.MonkeyPatch) -> None:
    """Turn the seam off for one test, rather than assuming it is off.

    The off-state tests below assert what the seam does *not* do, so they are
    the ones a run with `TENANCY_ENFORCED=True` in the environment would fail —
    for the right reason and in the wrong run. Setting it explicitly makes this
    file green in both ambient flag states, and means ticket 21 flipping the
    default does not have to come back here.
    """
    from app.core import config

    monkeypatch.setattr(config.settings, "TENANCY_ENFORCED", False)


# --------------------------------------------------------------------------
# The four families, as data
# --------------------------------------------------------------------------


@dataclass(frozen=True)
class Family:
    """One artifact family and the four operations this ticket scopes.

    `kind` is the discriminator the History leg emits, which is what ties a row
    here to a leg in `services/artifacts.py` — the two lists cannot drift apart
    without `test_every_family_is_covered_by_this_battery` noticing.
    """

    kind: str
    detail: str
    seed: Callable[[Session, str, uuid.UUID], None]
    list_: Callable[[Session, uuid.UUID], list[dict[str, Any]]]
    get: Callable[[Session, str, uuid.UUID], dict[str, Any]]
    write: Callable[[Session, str, uuid.UUID], dict[str, Any]]
    remove: Callable[[Session, str, uuid.UUID], None]


def _seed_summary(session: Session, row_id: str, owner: uuid.UUID) -> None:
    session.add(Summary(id=row_id, user_id=owner, text="body", timestamp=10))
    session.commit()


def _seed_chat(session: Session, row_id: str, owner: uuid.UUID) -> None:
    session.add(ChatSession(id=row_id, user_id=owner, title="chat", timestamp=10))
    session.commit()


def _seed_tag_run(session: Session, row_id: str, owner: uuid.UUID) -> None:
    session.add(TagRun(id=row_id, user_id=owner, created_at=10))
    session.commit()


def _seed_report(session: Session, row_id: str, owner: uuid.UUID) -> None:
    session.add(DiscoverReport(id=row_id, user_id=owner, timestamp=10))
    session.commit()


FAMILIES = (
    Family(
        kind="summary",
        detail="Summary not found",
        seed=_seed_summary,
        list_=lambda s, u: list_summaries(s, user_id=u),
        get=lambda s, i, u: get_summary(s, i, user_id=u),
        write=lambda s, i, u: upsert_summary(s, i, {"text": "overwritten"}, user_id=u),
        remove=lambda s, i, u: delete_summary(s, i, user_id=u),
    ),
    Family(
        kind="chat",
        detail="Chat session not found",
        seed=_seed_chat,
        list_=lambda s, u: list_chat_sessions(s, user_id=u),
        get=lambda s, i, u: get_chat_session(s, i, user_id=u),
        write=lambda s, i, u: upsert_chat_session(
            s, i, {"title": "overwritten"}, user_id=u
        ),
        remove=lambda s, i, u: delete_chat_session(s, i, user_id=u),
    ),
    Family(
        kind="tag",
        detail="Tag run not found",
        seed=_seed_tag_run,
        list_=lambda s, u: list_tag_runs(s, user_id=u),
        get=lambda s, i, u: get_tag_run(s, i, user_id=u),
        write=lambda s, i, u: upsert_tag_run(
            s, i, {"status": "overwritten"}, user_id=u
        ),
        remove=lambda s, i, u: delete_tag_run(s, i, user_id=u),
    ),
    Family(
        # `report not found` is lower-case in `discover_reports.py` and stays
        # that way. `assert_owner` must reuse the string the route already
        # answers for a row that is genuinely absent; "tidying" one of them
        # makes the two distinguishable again, which is the whole point of
        # requiring the argument.
        kind="discovery",
        detail="report not found",
        seed=_seed_report,
        list_=lambda s, u: list_reports(s, user_id=u),
        get=lambda s, i, u: get_report(s, i, user_id=u),
        write=lambda s, i, u: update_report_flags(s, i, {"isStarred": True}, user_id=u),
        remove=lambda s, i, u: delete_report(s, i, user_id=u),
    ),
)

_BY_KIND = {family.kind: family for family in FAMILIES}


def _ids(rows: list[dict[str, Any]]) -> set[str]:
    return {str(row["id"]) for row in rows}


# --------------------------------------------------------------------------
# Lists
# --------------------------------------------------------------------------


@pytest.mark.usefixtures("enforced")
@pytest.mark.parametrize("family", FAMILIES, ids=lambda f: f.kind)
def test_list_hides_another_accounts_rows(
    session: Session, user: User, other_user: User, family: Family
) -> None:
    family.seed(session, f"t17-{family.kind}-mine", user.id)
    family.seed(session, f"t17-{family.kind}-theirs", other_user.id)

    assert _ids(family.list_(session, user.id)) == {f"t17-{family.kind}-mine"}


@pytest.mark.usefixtures("unenforced")
@pytest.mark.parametrize("family", FAMILIES, ids=lambda f: f.kind)
def test_list_is_unfiltered_while_the_flag_is_off(
    session: Session, user: User, other_user: User, family: Family
) -> None:
    """The seam's own discipline: adopting it changes no response until 21.

    History is the one family where this was a real change rather than a
    no-op — it hand-rolled `owner == me OR owner IS NULL` before this ticket,
    and now behaves like the other three in both flag states.
    """
    family.seed(session, f"t17-{family.kind}-mine", user.id)
    family.seed(session, f"t17-{family.kind}-theirs", other_user.id)

    assert _ids(family.list_(session, user.id)) == {
        f"t17-{family.kind}-mine",
        f"t17-{family.kind}-theirs",
    }


# --------------------------------------------------------------------------
# By id: read, write, delete
# --------------------------------------------------------------------------


@pytest.mark.usefixtures("enforced")
@pytest.mark.parametrize("family", FAMILIES, ids=lambda f: f.kind)
def test_reading_another_accounts_row_is_not_found(
    session: Session, user: User, other_user: User, family: Family
) -> None:
    """404 rather than 403, and the family's own detail rather than a generic.

    403 confirms the row exists. A generic `"Not found"` moves that same
    oracle from the status line into the body, because every genuine miss here
    names its resource.
    """
    row_id = f"t17-{family.kind}-theirs"
    family.seed(session, row_id, other_user.id)

    with pytest.raises(HTTPException) as raised:
        family.get(session, row_id, user.id)

    assert raised.value.status_code == 404
    assert raised.value.detail == family.detail


@pytest.mark.usefixtures("enforced")
@pytest.mark.parametrize("family", FAMILIES, ids=lambda f: f.kind)
def test_writing_another_accounts_row_is_refused_and_changes_nothing(
    session: Session, user: User, other_user: User, family: Family
) -> None:
    """A scoped read over a writable row is half a fix.

    `upsert_*` merges into whatever row its id names, so without this the
    second account overwrites the first's artifact by guessing an id — and the
    read guard passes throughout.
    """
    row_id = f"t17-{family.kind}-theirs"
    family.seed(session, row_id, other_user.id)

    with pytest.raises(HTTPException) as raised:
        family.write(session, row_id, user.id)

    assert raised.value.status_code == 404
    assert raised.value.detail == family.detail

    session.rollback()
    assert family.get(session, row_id, other_user.id)["id"] == row_id


@pytest.mark.usefixtures("enforced")
@pytest.mark.parametrize("family", FAMILIES, ids=lambda f: f.kind)
def test_deleting_another_accounts_row_is_refused_and_leaves_it_there(
    session: Session, user: User, other_user: User, family: Family
) -> None:
    row_id = f"t17-{family.kind}-theirs"
    family.seed(session, row_id, other_user.id)

    with pytest.raises(HTTPException) as raised:
        family.remove(session, row_id, user.id)

    assert raised.value.status_code == 404
    assert raised.value.detail == family.detail

    session.rollback()
    assert family.get(session, row_id, other_user.id)["id"] == row_id


@pytest.mark.usefixtures("enforced")
@pytest.mark.parametrize("family", FAMILIES, ids=lambda f: f.kind)
def test_your_own_row_is_still_reachable_under_enforcement(
    session: Session, user: User, family: Family
) -> None:
    """The half of the guard that fails if scoping is simply too tight.

    A predicate that matched nothing would pass every test above.
    """
    row_id = f"t17-{family.kind}-mine"
    family.seed(session, row_id, user.id)

    assert family.get(session, row_id, user.id)["id"] == row_id
    assert family.write(session, row_id, user.id)["id"] == row_id
    family.remove(session, row_id, user.id)

    with pytest.raises(HTTPException):
        family.get(session, row_id, user.id)


@pytest.mark.usefixtures("enforced")
@pytest.mark.parametrize("family", FAMILIES, ids=lambda f: f.kind)
def test_a_genuinely_absent_row_answers_the_same_as_a_foreign_one(
    session: Session, user: User, other_user: User, family: Family
) -> None:
    """The oracle is closed only if the two answers are indistinguishable.

    Asserted against each other rather than against a literal, so a family
    that changes its wording has to change it in both places or fail here.
    """
    foreign_id = f"t17-{family.kind}-theirs"
    family.seed(session, foreign_id, other_user.id)

    with pytest.raises(HTTPException) as foreign:
        family.get(session, foreign_id, user.id)
    with pytest.raises(HTTPException) as absent:
        family.get(session, f"t17-{family.kind}-nonexistent", user.id)

    assert (foreign.value.status_code, foreign.value.detail) == (
        absent.value.status_code,
        absent.value.detail,
    )


# --------------------------------------------------------------------------
# The unified History, over all four at once
# --------------------------------------------------------------------------


@pytest.mark.usefixtures("enforced")
def test_history_shows_every_kind_you_own_and_no_kind_you_do_not(
    session: Session, user: User, other_user: User
) -> None:
    """One assertion over all four legs.

    Per-kind rather than a total count: a union that dropped one leg entirely
    would still satisfy "sees only my rows".
    """
    for family in FAMILIES:
        family.seed(session, f"t17-hist-{family.kind}-mine", user.id)
        family.seed(session, f"t17-hist-{family.kind}-theirs", other_user.id)

    rows = list_artifacts(session, user_id=user.id)

    assert {(row["kind"], row["id"]) for row in rows} == {
        (family.kind, f"t17-hist-{family.kind}-mine") for family in FAMILIES
    }


@pytest.mark.usefixtures("enforced")
@pytest.mark.parametrize("kind", ARTIFACT_KINDS)
def test_history_filtered_to_one_kind_is_scoped_too(
    session: Session, user: User, other_user: User, kind: str
) -> None:
    """`?kind=` builds one leg. A predicate on only the four-leg path passes
    every test above and leaks on every filtered request the UI actually makes.
    """
    family = _BY_KIND[kind]
    family.seed(session, f"t17-one-{kind}-mine", user.id)
    family.seed(session, f"t17-one-{kind}-theirs", other_user.id)

    rows = list_artifacts(session, kind=kind, user_id=user.id)

    assert _ids(rows) == {f"t17-one-{kind}-mine"}


@pytest.mark.usefixtures("enforced")
def test_history_search_does_not_widen_the_scope(
    session: Session, user: User, other_user: User
) -> None:
    """A `WHERE` added beside the scope predicate, never instead of it."""
    _seed_summary(session, "t17-search-mine", user.id)
    _seed_summary(session, "t17-search-theirs", other_user.id)

    rows = list_artifacts(session, search="body", user_id=user.id)

    assert _ids(rows) == {"t17-search-mine"}


@pytest.mark.usefixtures("enforced")
def test_history_starred_filter_does_not_widen_the_scope(
    session: Session, user: User, other_user: User
) -> None:
    for owner, row_id in (
        (user.id, "t17-star-mine"),
        (other_user.id, "t17-star-theirs"),
    ):
        session.add(
            Summary(
                id=row_id,
                user_id=owner,
                text="body",
                timestamp=10,
                extra={"isStarred": True},
            )
        )
    session.commit()

    rows = list_artifacts(session, starred=True, user_id=user.id)

    assert _ids(rows) == {"t17-star-mine"}


def test_every_family_is_covered_by_this_battery() -> None:
    """A fifth artifact kind must arrive with its scoping, or fail here.

    Asserted against `ARTIFACT_KINDS`, which is what `list_artifacts` iterates
    to build its legs — so the two lists cannot drift.
    """
    assert {family.kind for family in FAMILIES} == set(ARTIFACT_KINDS)


# --------------------------------------------------------------------------
# The viewer, not the owner
# --------------------------------------------------------------------------


@pytest.mark.usefixtures("unenforced")
def test_report_is_followed_answers_for_the_viewer_not_the_owner(
    session: Session, user: User, other_user: User, monkeypatch: pytest.MonkeyPatch
) -> None:
    """Ticket 16 left `viewer_id=report.user_id` as a placeholder, commented.

    The first cut of this test asserted only that `user_id` is keyword-only
    with no default — which the signature guard below already asserts over a
    superset of these functions, so reverting `get_report` to
    `viewer_id=report.user_id` left it green. Review caught that. It now
    watches **which id reaches `followed_names`**, which is the only place the
    difference is observable.

    Deliberately run with the flag **off**: under enforcement a foreign report
    is a 404 and the two ids are equal by construction, so the one state where
    viewer and owner can differ is the one that can tell them apart.
    """
    from app.services import discover_reports

    seen: list[uuid.UUID] = []

    def _record(session: Session, *, user_id: uuid.UUID) -> set[str]:
        seen.append(user_id)
        return set()

    monkeypatch.setattr(discover_reports, "followed_names", _record)

    _seed_report(session, "t17-viewer", other_user.id)
    get_report(session, "t17-viewer", user_id=user.id)

    assert seen == [user.id], (
        "isFollowed must be resolved against the account asking, not the "
        "account that saved the report"
    )


# --------------------------------------------------------------------------
# The signature itself
# --------------------------------------------------------------------------


@pytest.mark.parametrize(
    "func",
    [
        list_summaries,
        get_summary,
        upsert_summary,
        delete_summary,
        list_chat_sessions,
        get_chat_session,
        upsert_chat_session,
        delete_chat_session,
        list_tag_runs,
        get_tag_run,
        upsert_tag_run,
        delete_tag_run,
        list_reports,
        get_report,
        update_report_flags,
        delete_report,
        list_artifacts,
    ],
    ids=lambda f: f.__name__,
)
def test_every_scoped_artifact_call_demands_a_user_id(func: object) -> None:
    """No default, for the reason `scoped_select` takes none.

    A defaulted `user_id=None` lets a call site forget the argument and still
    compile, and the seam then has to invent a meaning for "no user" — the
    tempting one being "match rows whose owner is NULL", which hands back every
    row written before the stamp existed.
    """
    import inspect

    param = inspect.signature(func).parameters["user_id"]  # ty: ignore

    assert param.default is inspect.Parameter.empty
    assert param.kind is inspect.Parameter.KEYWORD_ONLY
    assert param.annotation in (uuid.UUID, "uuid.UUID")


@pytest.mark.parametrize(
    "model", [Summary, ChatSession, TagRun, DiscoverReport], ids=lambda m: m.__name__
)
def test_every_artifact_table_is_user_owned(model: type) -> None:
    """The claim above, asserted against the seam rather than a comment.

    None of the four is follow-scoped: an artifact is something an account
    *produced* over a scope, not a copy of the corpus it read.
    """
    from app.services.tenancy import Scope, scope_of

    assert scope_of(model) is Scope.USER_OWNED  # ty: ignore
