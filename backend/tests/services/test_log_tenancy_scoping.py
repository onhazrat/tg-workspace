"""Ticket 18: a log row belongs to the account that produced it.

With `TENANCY_ENFORCED` on, `list_logs` and `get_log` answer for the caller and
for nobody else. With it off they return exactly what they returned before,
which is the promise every migrate ticket in this programme makes and the reason
the flag exists at all.

Three things here are worth more than "the seam works", which `test_follows.py`
already proved for `Post`.

* **Network logs are the deliberate exception, and it is an exception in both
  directions.** They record what the deployment's proxies did, so no account
  owns them; the read crosses accounts through `unscoped_select` and the route
  above demands `Permission.LOGS_READ_ANY` instead. Asserting only "network is
  unscoped" would pass just as well if *every* type were unscoped, so the owned
  four are asserted next to it.
* **`get_log` is a second read with a second failure mode.** Scoping the list
  and forgetting the by-id lookup leaves the rows one URL away, which is the
  shape of bug ticket 16 found four times over. A foreign row answers 404 with
  the string an absent row answers, and `test_the_refusal_is_indistinguishable`
  is what stops that from decaying into a helpful message.
* **The reads demand an owner and have no default for it.** That is the shape
  rule the seam states for `scoped_select`'s own argument, asserted here on both
  functions, because the leak this ticket closes reopens quietly the day a new
  call site can omit whose rows it wants.
"""

from __future__ import annotations

import inspect
import uuid
from collections.abc import Callable, Iterator

import pytest
from fastapi import HTTPException
from sqlmodel import Session, col, delete

from app.core.db import engine
from app.models import User
from app.services.logs import (
    ADMIN_ONLY_LOG_TYPES,
    get_log,
    list_logs,
    upsert_embedding_log,
    upsert_llm_log,
    upsert_network_log,
    upsert_publish_log,
    upsert_sync_log,
)
from tests.utils.user import create_random_user

#: The three types an account produces and therefore owns.
#:
#: `network` is Admin-only and crosses accounts on purpose; it is handled on its
#: own, below. `sync` left this list in **ticket 19**: a sync log answers "did
#: this Channel deliver Posts, and if not why not", which is a fact about the
#: Channel, so it is follow-scoped and carries no owner at all.
#: `tests/services/test_sync_log_channel_telemetry.py` is its guard, and the two
#: files together are what keeps "owned" and "shared" from quietly becoming the
#: same list.
OWNED_TYPES = ["publish", "llm", "embedding"]

_UPSERTS = {
    "publish": upsert_publish_log,
    "sync": upsert_sync_log,
    "llm": upsert_llm_log,
    "embedding": upsert_embedding_log,
    "network": upsert_network_log,
}


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


@pytest.fixture
def enforced(monkeypatch: pytest.MonkeyPatch) -> None:
    """Turn the seam on for one test. See `test_tenancy_seam.py`."""
    from app.core import config

    monkeypatch.setattr(config.settings, "TENANCY_ENFORCED", True)


def _write(
    session: Session, log_type: str, log_id: str, owner: uuid.UUID, timestamp: int = 1
) -> str:
    _UPSERTS[log_type](session, {"id": log_id, "timestamp": timestamp}, owner)
    session.commit()
    return log_id


def _ids(session: Session, log_type: str, viewer: uuid.UUID) -> set[str]:
    return {row["id"] for row in list_logs(session, log_type, user_id=viewer)}


# ------------------------------------------------------------ the owned four


@pytest.mark.security
@pytest.mark.parametrize("log_type", OWNED_TYPES)
def test_a_page_holds_only_your_own_rows(
    session: Session,
    user: User,
    other_user: User,
    enforced: None,
    log_type: str,
) -> None:
    mine = _write(session, log_type, f"tenancy-mine-{log_type}", user.id)
    theirs = _write(session, log_type, f"tenancy-theirs-{log_type}", other_user.id)

    visible = _ids(session, log_type, user.id)
    assert mine in visible
    assert theirs not in visible, (
        f"a {log_type} log belonging to another account is on this page"
    )


@pytest.mark.security
@pytest.mark.parametrize("log_type", OWNED_TYPES)
def test_with_the_flag_off_the_page_is_what_it_always_was(
    session: Session,
    user: User,
    other_user: User,
    log_type: str,
) -> None:
    """The promise of every batch: adopting the seam changes no response yet."""
    mine = _write(session, log_type, f"unscoped-mine-{log_type}", user.id)
    theirs = _write(session, log_type, f"unscoped-theirs-{log_type}", other_user.id)

    visible = _ids(session, log_type, user.id)
    assert {mine, theirs} <= visible


@pytest.mark.security
@pytest.mark.parametrize("log_type", OWNED_TYPES)
def test_your_own_row_is_still_reachable_by_id(
    session: Session, user: User, enforced: None, log_type: str
) -> None:
    """Scoping that also hides your own rows is not scoping, it is an outage."""
    log_id = _write(session, log_type, f"byid-mine-{log_type}", user.id)
    assert get_log(session, log_type, log_id, user_id=user.id)["id"] == log_id


@pytest.mark.security
@pytest.mark.parametrize("log_type", OWNED_TYPES)
def test_someone_elses_row_by_id_is_not_found(
    session: Session,
    user: User,
    other_user: User,
    enforced: None,
    log_type: str,
) -> None:
    log_id = _write(session, log_type, f"byid-theirs-{log_type}", other_user.id)

    with pytest.raises(HTTPException) as raised:
        get_log(session, log_type, log_id, user_id=user.id)
    assert raised.value.status_code == 404


@pytest.mark.security
def test_the_refusal_is_indistinguishable_from_an_absent_row(
    session: Session, user: User, other_user: User, enforced: None
) -> None:
    """404 is only half the answer; the body is the other half.

    A distinguishable detail would move the enumeration oracle the status code
    closes into the payload, which is the mistake `assert_owner` demands a
    `detail` argument to prevent.
    """
    foreign = _write(session, "publish", "byid-oracle", other_user.id)

    with pytest.raises(HTTPException) as on_foreign:
        get_log(session, "publish", foreign, user_id=user.id)
    with pytest.raises(HTTPException) as on_missing:
        get_log(session, "publish", "no-such-log-row-at-all", user_id=user.id)

    assert on_foreign.value.detail == on_missing.value.detail
    assert on_foreign.value.status_code == on_missing.value.status_code


@pytest.mark.security
def test_a_full_page_of_other_peoples_rows_does_not_crowd_yours_out(
    session: Session, user: User, other_user: User, enforced: None
) -> None:
    """A limit counts rows the caller may see, not rows that sort first.

    The other account's three rows are the newest here, so an unnarrowed page of
    three is entirely theirs and the caller's own rows sit one page down,
    unreachable without paging past rows they cannot be shown. That this passes
    is a property of the predicate being in the statement rather than applied to
    the result: the wire projection drops `userId` (see `mapping_to_camel`), so
    there is nothing left in a returned page to filter on afterwards even if
    someone tried.
    """
    for index in range(3):
        _write(session, "publish", f"rank-theirs-{index}", other_user.id, 9000 + index)
    for index in range(3):
        _write(session, "publish", f"rank-mine-{index}", user.id, 100 + index)

    page = list_logs(session, "publish", user_id=user.id, limit=3)
    assert {row["id"] for row in page} == {f"rank-mine-{i}" for i in range(3)}


# --------------------------------------------------------- the admin exception


@pytest.mark.security
def test_network_logs_are_not_narrowed_to_the_caller(
    session: Session, user: User, other_user: User, enforced: None
) -> None:
    """Admin-only, and therefore read across accounts on purpose.

    Scoping them to the caller would hand an Admin an empty proxy log for
    requests the scheduler made, which is the one view they are for.
    """
    assert "network" in ADMIN_ONLY_LOG_TYPES

    mine = _write(session, "network", "net-mine", user.id)
    theirs = _write(session, "network", "net-theirs", other_user.id)
    orphan = _UPSERTS["network"](session, {"id": "net-orphan", "timestamp": 1}, None)
    session.commit()
    assert orphan is None  # the upserts return nothing; the row is committed above

    visible = _ids(session, "network", user.id)
    assert {mine, theirs, "net-orphan"} <= visible


@pytest.mark.security
def test_a_network_log_by_id_is_not_owner_checked(
    session: Session, user: User, other_user: User, enforced: None
) -> None:
    """The gate on network logs is the permission, not the owner column.

    A row the scheduler wrote has a null owner, so an ownership check here would
    404 every one of them for the Admin the route exists to serve.
    """
    theirs = _write(session, "network", "net-byid-theirs", other_user.id)
    assert get_log(session, "network", theirs, user_id=user.id)["id"] == theirs


# ------------------------------------------------------------------ the shape


@pytest.mark.security
@pytest.mark.parametrize("function", [list_logs, get_log], ids=["list_logs", "get_log"])
def test_the_reads_demand_an_owner_with_no_default(
    function: Callable[..., object],
) -> None:
    """A default would let a new call site scope to nobody without saying so.

    Same rule `scoped_select` states for its own argument: every caller here
    already depends on `CurrentUser`, so a real id is always in hand, and the
    only thing a default buys is a silent leak on the day someone forgets.
    """
    parameter = inspect.signature(function).parameters["user_id"]
    assert parameter.kind is inspect.Parameter.KEYWORD_ONLY
    assert parameter.default is inspect.Parameter.empty
