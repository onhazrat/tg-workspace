"""Ticket 32: your bot credentials and chat destinations are yours.

`list_bot_credentials` and `list_chat_destinations` were a bare `select(Model)`
with no `user_id` parameter at all, while every *write* on the same two families
has passed `user_id` since ticket 31. One family answering two different
questions about whose rows these are depending on the verb is the drift
`tenancy.py` exists to prevent.

**The ticket called these "the last unscoped read family in `app/`" and that is
not true**, so do not read this file as an all-clear. `list_setting_groups`
hand-rolls `user_id == me OR user_id IS NULL` over `ChannelSettingGroup`,
`load_groups_by_id` reads the same table unfiltered, and `_running_job_from_row`
reads `SyncJob` across accounts — all three `USER_OWNED`, none audited. The
correction lives here rather than only in the ticket because this is the file
whoever flips the flag will open.

Three things here are not the wiring.

**The battery is parametrised over both families.** They are the same handful
of functions twice over in one module, and the repo's twin-module rule is that
a fix applied to one of a pair is half a fix.

**The flag-off test is the one that catches a hand-rolled filter.** A call site
that adopts `.where(Model.user_id == user_id)` instead of `scoped_select`
passes the enforced test with full marks and fails this one, because it filters
in a flag state where the seam promises not to. That is the difference between
reading through the seam and merely reaching the same answer today.

**An ownerless row is pinned in both flag states, because it is ticket 21's
bill.** `user_id` is nullable on both tables, so the credential a
single-operator deployment has been publishing with since before the stamp
existed is visible now and invisible the moment enforcement flips. Pinning it
here means 21 finds a red test rather than an operator finding a publish that
silently stopped.
"""

from __future__ import annotations

import inspect
import uuid
from collections.abc import Callable
from dataclasses import dataclass
from typing import Any

import pytest
from sqlmodel import Session, col, delete

from app.core.db import engine
from app.models import User
from app.models_tg import BotCredential, ChatDestination
from app.services.credentials import list_bot_credentials, list_chat_destinations
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

    The off-state tests assert what the seam does *not* do, so they are the ones
    a run with `TENANCY_ENFORCED=True` in the environment would fail — for the
    right reason and in the wrong run.
    """
    from app.core import config

    monkeypatch.setattr(config.settings, "TENANCY_ENFORCED", False)


# --------------------------------------------------------------------------
# The two families, as data
# --------------------------------------------------------------------------


@dataclass(frozen=True)
class Family:
    kind: str
    seed: Callable[[Session, str, uuid.UUID | None], None]
    list_: Callable[[Session, uuid.UUID], list[dict[str, Any]]]


def _seed_bot(session: Session, row_id: str, owner: uuid.UUID | None) -> None:
    session.add(
        BotCredential(
            id=row_id, user_id=owner, name=row_id, token_encrypted="enc:token"
        )
    )
    session.commit()


def _seed_dest(session: Session, row_id: str, owner: uuid.UUID | None) -> None:
    session.add(
        ChatDestination(id=row_id, user_id=owner, name=row_id, chat_id="-100123")
    )
    session.commit()


FAMILIES = (
    Family(
        kind="bot-credential",
        seed=_seed_bot,
        list_=lambda s, u: list_bot_credentials(s, user_id=u),
    ),
    Family(
        kind="chat-destination",
        seed=_seed_dest,
        list_=lambda s, u: list_chat_destinations(s, user_id=u),
    ),
)

LIST_FUNCTIONS = (list_bot_credentials, list_chat_destinations)


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
    """What this stops leaking is the other account's credential *ids*.

    Not its token — `bot_to_camel` returns `hasToken` and never the ciphertext.
    The ids are what matter: they are client-chosen, and the auto-publish path
    still resolves one by id without an owner check.
    """
    family.seed(session, f"t32-{family.kind}-mine", user.id)
    family.seed(session, f"t32-{family.kind}-theirs", other_user.id)

    assert _ids(family.list_(session, user.id)) == {f"t32-{family.kind}-mine"}


@pytest.mark.usefixtures("unenforced")
@pytest.mark.parametrize("family", FAMILIES, ids=lambda f: f.kind)
def test_list_is_unfiltered_while_the_flag_is_off(
    session: Session, user: User, other_user: User, family: Family
) -> None:
    """Adopting the seam changes no response until ticket 21 flips the flag.

    This is also the test a hand-rolled `.where(user_id == …)` fails: such a
    filter narrows in both flag states, which is a changed response on today's
    shipping config and exactly what the batches are not allowed to do.
    """
    family.seed(session, f"t32-{family.kind}-mine", user.id)
    family.seed(session, f"t32-{family.kind}-theirs", other_user.id)

    assert _ids(family.list_(session, user.id)) == {
        f"t32-{family.kind}-mine",
        f"t32-{family.kind}-theirs",
    }


@pytest.mark.usefixtures("enforced")
@pytest.mark.parametrize("family", FAMILIES, ids=lambda f: f.kind)
def test_your_own_row_still_reaches_you(
    session: Session, user: User, family: Family
) -> None:
    """The failure mode of a scoping change is a list that scopes to nothing."""
    family.seed(session, f"t32-{family.kind}-mine", user.id)

    assert _ids(family.list_(session, user.id)) == {f"t32-{family.kind}-mine"}


# --------------------------------------------------------------------------
# The signature, and the row nobody owns
# --------------------------------------------------------------------------


@pytest.mark.parametrize("func", LIST_FUNCTIONS, ids=lambda f: f.__name__)
def test_user_id_is_a_required_keyword(func: Callable[..., Any]) -> None:
    """Ticket 16's rule, for its reason.

    Both functions took `(session)` alone, so an *optional* owner would leave
    every existing caller passing nothing and still passing tests. With no
    default, a call site that forgets one fails at the signature rather than
    silently reading everybody's rows.
    """
    parameter = inspect.signature(func).parameters["user_id"]

    assert parameter.kind is inspect.Parameter.KEYWORD_ONLY
    assert parameter.default is inspect.Parameter.empty


@pytest.mark.usefixtures("unenforced")
@pytest.mark.parametrize("family", FAMILIES, ids=lambda f: f.kind)
def test_an_ownerless_row_is_visible_while_the_flag_is_off(
    session: Session, user: User, family: Family
) -> None:
    family.seed(session, f"t32-{family.kind}-legacy", None)

    assert f"t32-{family.kind}-legacy" in _ids(family.list_(session, user.id))


@pytest.mark.usefixtures("enforced")
@pytest.mark.parametrize("family", FAMILIES, ids=lambda f: f.kind)
def test_an_ownerless_row_needs_ticket_21s_backfill(
    session: Session, user: User, family: Family
) -> None:
    """Pinned, not fixed here — the fix is an owner backfill, which is 21's.

    `user_id` is nullable on both tables, so a row written before the stamp
    existed belongs to nobody and enforcement hides it from everybody. Matching
    NULL as "mine" is the fallback the seam refuses by construction: it would
    hand every account the deployment's own credential — its id, and with it the
    auto-publish path that sends as that bot. So the row stays hidden and this
    test says so out loud, which is what stops ticket 21 from flipping the flag
    and discovering it in production.
    """
    family.seed(session, f"t32-{family.kind}-legacy", None)

    assert _ids(family.list_(session, user.id)) == set()
