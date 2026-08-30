"""Ticket 19: a sync log is a fact about a Channel, not about an account.

`SyncLog` and its payload row leave `Scope.USER_OWNED` for `Scope.FOLLOW_SCOPED`.
A sync log answers "did this Channel deliver Posts, and if not why not", and the
second follower of a handle has exactly as much right to that answer as the
first. Scoping it on `user_id` would hand them an empty Logs tab for scrapes that
ran on their own behalf, which is the failure `Post` already avoids.

Four things here are worth more than "the seam works".

* **The owner stamp stops being written, and that is asserted rather than
  assumed.** `upsert_sync_log` keeps its `user_id` parameter because
  `_LOG_IMPORTERS` dispatches all five log types through one uniform signature,
  so the ignoring is invisible at every call site. An ignored parameter decays
  into a written one the first time somebody "fixes" it, so a guard hands it a
  real account and requires the stored row to carry `None`. Plan decision 22 is
  explicit that a nullable owner meaning "scheduled" resurrects the
  `operator.py` ambiguity and fails open on a forgotten stamp.
* **Search is a second read with a second predicate.** The list, the `search`
  clause and the `searchInDetails` semi-join into `tg_sync_log_payloads` are
  three ways into the same table, and the bodies are reachable through the third
  while never being sent by the first. A scope that holds for the plain page and
  leaks through the search box is not a scope, and the ticket asks for search to
  keep working *within* that scope rather than around it. The payload subquery
  itself stays unscoped on purpose: it is semi-joined into a statement already
  narrowed to visible logs, so it can only ever remove rows from that set, and a
  second EXISTS over the corpus would cost a scan to reach the same answer.
* **The write is in scope, and `assert_owner` does not merely stop working on an
  ownerless row.** It fails closed: `owner_id is None` raises, so leaving ticket
  18's takeover guard in place would refuse every sync log write the moment the
  flag flips. The follow check replaces it, which keeps that fix rather than
  dropping it.
* **Deleting one row is now an administrative act.** Ticket 18 left the
  single-row branch ungated because "one row of your own is not an
  administrative act". Once the row is shared telemetry that sentence points the
  other way, and the route guard is asserted in `tests/api/test_admin_route_gating.py`.

Per `CLAUDE.md`, every assertion below was watched to fail before it was
trusted. The mutations that were run are listed here so the next person does not
have to re-derive them:

* classify `SyncLog` back as `USER_OWNED` -> eight tests here fail, and two in
  `test_tenancy_seam.py`
* drop `SyncLogPayload` from `FOLLOW_KEYS` -> `test_both_sync_tables_are_follow_scoped`
  and two seam tests fail
* put `user_id` back in `upsert_sync_log`'s field dict, or stamp the payload row
  -> `test_a_sync_log_stores_no_owner_even_when_handed_one` fails, and so does
  the sync case of `test_a_write_cannot_take_over_another_accounts_row`
* make `_assert_may_write_channel_telemetry` return early -> all three write
  tests fail. Note that neutering its *call site* is **not** a sufficient
  mutation: the `else` branch then runs `assert_owner` against a null owner,
  which refuses for a different reason and leaves only one of the three red.
* declare `FOLLOW_KEYS[SyncLogPayload]` as `sync_log_id` -> only
  `test_both_sync_tables_are_follow_scoped` fails. The seam's own
  `test_enabled_follow_scoped_joins_on_the_declared_key` compiles the predicate
  and asserts it uses *the declared key*, which is a tautology under a mutation
  that changes the declaration, and its sibling only checks the column exists on
  the model, which `sync_log_id` does. That is why the key is asserted here as a
  literal rather than left to the seam.
* drop the create-only check -> both overwrite tests fail
* compare channel names case-insensitively, as the first cut did ->
  `test_the_write_matches_the_channel_name_the_way_the_read_does` fails
* stop calling `collect_channel_sync_logs` ->
  `test_collection_takes_the_sync_logs_too` fails, in
  `tests/jobs/test_retention_collects_unfollowed.py`
"""

from __future__ import annotations

import uuid
from collections.abc import Iterator

import pytest
from fastapi import HTTPException
from sqlmodel import Session, col, delete

from app.core.db import engine
from app.models import User
from app.models_tg import SyncLog, SyncLogPayload
from app.services.follows import ensure_follow
from app.services.logs import create_logs, get_log, list_logs, upsert_sync_log
from app.services.tenancy import FOLLOW_KEYS, SCOPES, Scope
from tests.utils.setting_groups import add_test_channel
from tests.utils.user import create_random_user

MINE = "t19-mine"
THEIRS = "t19-theirs"


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


@pytest.fixture
def unenforced(monkeypatch: pytest.MonkeyPatch) -> None:
    """Turn the seam off for one test — the rollback state, since PR 4.

    The flag-off tests below used to read the ambient default and needed no
    fixture at all. Ticket 21 PR 4 flipped that default, so what they describe
    is now what an operator gets by setting `TENANCY_ENFORCED=false` in `.env`.
    That is still worth asserting: it is the programme's rollback, and a revert
    that only half-reverts is worse than none.
    """
    from app.core import config

    monkeypatch.setattr(config.settings, "TENANCY_ENFORCED", False)


def _split_corpus(session: Session, user: User, other_user: User) -> None:
    """One Channel each, followed by its creator only.

    `add_test_channel` writes the Follow along with the Channel, which is the
    invariant `test_channel_creation_paths.py` holds every creation path to.
    """
    add_test_channel(session, MINE, user_id=user.id)
    add_test_channel(session, THEIRS, user_id=other_user.id)


def _log(
    session: Session,
    log_id: str,
    channel_name: str,
    *,
    owner: uuid.UUID | None = None,
    timestamp: int = 1,
    error: str | None = None,
    response: object = None,
) -> str:
    upsert_sync_log(
        session,
        {
            "id": log_id,
            "channelName": channel_name,
            "timestamp": timestamp,
            "error": error,
            "fullResponse": response,
        },
        owner,
    )
    session.commit()
    return log_id


def _ids(session: Session, viewer: uuid.UUID, **kwargs: object) -> set[str]:
    return {row["id"] for row in list_logs(session, "sync", user_id=viewer, **kwargs)}


# --------------------------------------------------------------------------
# The classification
# --------------------------------------------------------------------------


def test_both_sync_tables_are_follow_scoped() -> None:
    """The parent and its payload row answer the same question, or they drift.

    A payload table takes its parent's scope, which is what `SummaryPayload` and
    `ChatSessionPayload` already do. A child claiming an owner its parent does
    not have is exactly the disagreement the seam exists to prevent, and it
    would surface as a body that is searchable but not readable.
    """
    assert SCOPES[SyncLog] is Scope.FOLLOW_SCOPED
    assert SCOPES[SyncLogPayload] is Scope.FOLLOW_SCOPED
    assert FOLLOW_KEYS[SyncLog] == "channel_name"
    assert FOLLOW_KEYS[SyncLogPayload] == "channel_name"


# --------------------------------------------------------------------------
# Visibility follows the Follow
# --------------------------------------------------------------------------


@pytest.mark.security
@pytest.mark.usefixtures("enforced")
def test_a_second_follower_sees_telemetry_the_first_one_produced(
    session: Session, user: User, other_user: User
) -> None:
    """The whole ticket in one assertion.

    The row was produced by another account's scrape and names no owner. What
    makes it visible is the Follow, so the second person to follow a handle sees
    why it did or did not deliver Posts.
    """
    _split_corpus(session, user, other_user)
    ensure_follow(session, channel_id=THEIRS, user_id=user.id)
    session.commit()
    shared = _log(session, "t19-shared", THEIRS, owner=other_user.id)

    assert shared in _ids(session, user.id)


@pytest.mark.security
@pytest.mark.usefixtures("enforced")
def test_a_channel_you_do_not_follow_is_not_on_your_page(
    session: Session, user: User, other_user: User
) -> None:
    _split_corpus(session, user, other_user)
    mine = _log(session, "t19-list-mine", MINE, owner=user.id)
    theirs = _log(session, "t19-list-theirs", THEIRS, owner=other_user.id)

    visible = _ids(session, user.id)
    assert mine in visible
    assert theirs not in visible, (
        "a sync log for a channel this account does not follow is on its page"
    )


@pytest.mark.security
@pytest.mark.usefixtures("enforced")
def test_the_stamp_is_not_what_makes_it_visible(
    session: Session, user: User, other_user: User
) -> None:
    """Scoping on `user_id` would pass the test above and still be wrong.

    The row here is stamped with the *other* account and sits on a Channel this
    one follows. A `Model.user_id == caller` filter hides it; the follow EXISTS
    shows it. That is the difference between the two implementations, and
    nothing else in this file separates them.
    """
    add_test_channel(session, MINE, user_id=user.id)
    stamped_elsewhere = _log(session, "t19-stamp", MINE, owner=other_user.id)

    assert stamped_elsewhere in _ids(session, user.id)


@pytest.mark.security
@pytest.mark.usefixtures("enforced")
def test_a_row_on_a_followed_channel_is_reachable_by_id(
    session: Session, user: User, other_user: User
) -> None:
    """Scoping that also hides rows you may see is not scoping, it is an outage."""
    _split_corpus(session, user, other_user)
    ensure_follow(session, channel_id=THEIRS, user_id=user.id)
    session.commit()
    shared = _log(session, "t19-byid-shared", THEIRS, owner=other_user.id)

    assert get_log(session, "sync", shared, user_id=user.id)["id"] == shared


@pytest.mark.security
@pytest.mark.usefixtures("enforced")
def test_a_row_on_an_unfollowed_channel_is_not_found_by_id(
    session: Session, user: User, other_user: User
) -> None:
    _split_corpus(session, user, other_user)
    theirs = _log(session, "t19-byid-theirs", THEIRS, owner=other_user.id)

    with pytest.raises(HTTPException) as raised:
        get_log(session, "sync", theirs, user_id=user.id)
    assert raised.value.status_code == 404


@pytest.mark.security
@pytest.mark.usefixtures("enforced")
def test_the_refusal_is_indistinguishable_from_an_absent_row(
    session: Session, user: User, other_user: User
) -> None:
    """404 is only half the answer; the body is the other half.

    A distinguishable detail moves the enumeration oracle the status code closes
    into the payload, which is why `assert_owner` demands the string rather than
    defaulting it.
    """
    _split_corpus(session, user, other_user)
    theirs = _log(session, "t19-oracle", THEIRS, owner=other_user.id)

    with pytest.raises(HTTPException) as on_foreign:
        get_log(session, "sync", theirs, user_id=user.id)
    with pytest.raises(HTTPException) as on_missing:
        get_log(session, "sync", "no-such-sync-log-at-all", user_id=user.id)

    assert on_foreign.value.detail == on_missing.value.detail
    assert on_foreign.value.status_code == on_missing.value.status_code


# --------------------------------------------------------------------------
# Search stays inside the scope
# --------------------------------------------------------------------------


@pytest.mark.security
@pytest.mark.usefixtures("enforced")
def test_search_does_not_reach_past_the_follow(
    session: Session, user: User, other_user: User
) -> None:
    """A scope that holds for the page and leaks through the search box is none.

    Both rows match the term, so an unscoped clause returns both and a scoped
    one returns the followed channel's row alone.
    """
    _split_corpus(session, user, other_user)
    mine = _log(session, "t19-find-mine", MINE, owner=user.id, error="pelican")
    theirs = _log(
        session, "t19-find-theirs", THEIRS, owner=other_user.id, error="pelican"
    )

    found = _ids(session, user.id, search="pelican")
    assert mine in found
    assert theirs not in found


@pytest.mark.security
@pytest.mark.usefixtures("enforced")
def test_searching_the_bodies_does_not_reach_past_the_follow(
    session: Session, user: User, other_user: User
) -> None:
    """`searchInDetails` semi-joins the payload table, which is a third way in.

    The bodies are never shipped by the list, so this clause is the only path
    that reads them for a page. Left unscoped it reports that a matching log
    exists on a Channel the caller cannot see.
    """
    _split_corpus(session, user, other_user)
    mine = _log(
        session, "t19-body-mine", MINE, owner=user.id, response={"note": "capybara"}
    )
    theirs = _log(
        session,
        "t19-body-theirs",
        THEIRS,
        owner=other_user.id,
        response={"note": "capybara"},
    )

    found = _ids(session, user.id, search="capybara", search_in_details=True)
    assert mine in found
    assert theirs not in found


@pytest.mark.security
@pytest.mark.usefixtures("enforced")
def test_the_bodies_are_still_findable_for_a_channel_you_follow(
    session: Session, user: User, other_user: User
) -> None:
    """Scoping the search by breaking it would pass the two tests above.

    The point of moving the match into SQL was that a dropped field stays
    findable, so the followed half has to keep working.
    """
    _split_corpus(session, user, other_user)
    ensure_follow(session, channel_id=THEIRS, user_id=user.id)
    session.commit()
    shared = _log(
        session,
        "t19-body-shared",
        THEIRS,
        owner=other_user.id,
        response={"note": "axolotl"},
    )

    assert shared in _ids(session, user.id, search="axolotl", search_in_details=True)


# --------------------------------------------------------------------------
# The owner stamp
# --------------------------------------------------------------------------


def test_a_sync_log_stores_no_owner_even_when_handed_one(
    session: Session, user: User
) -> None:
    """Decision 22: sync logs carry no owner.

    `upsert_sync_log` keeps the parameter because `_LOG_IMPORTERS` dispatches
    five types through one signature, so nothing at a call site shows that it is
    ignored. This is what stops it from quietly becoming written again.
    """
    add_test_channel(session, MINE, user_id=user.id)
    _log(session, "t19-stampless", MINE, owner=user.id, response={"body": 1})

    row = session.get(SyncLog, "t19-stampless")
    payload = session.get(SyncLogPayload, "t19-stampless")
    assert row is not None
    assert payload is not None
    assert row.user_id is None
    assert payload.user_id is None


def test_the_payload_row_records_its_channel(session: Session, user: User) -> None:
    """The denormalised key, without which the payload cannot be follow-scoped.

    Same reason `timestamp` is denormalised onto this table: the sweep and the
    scope both have to answer without joining the whole log table back in.
    """
    add_test_channel(session, MINE, user_id=user.id)
    _log(session, "t19-payload-key", MINE, owner=user.id, response={"body": 1})

    payload = session.get(SyncLogPayload, "t19-payload-key")
    assert payload is not None
    assert payload.channel_name == MINE


# --------------------------------------------------------------------------
# The write
# --------------------------------------------------------------------------


@pytest.mark.security
@pytest.mark.usefixtures("enforced")
def test_writing_telemetry_for_a_channel_you_do_not_follow_is_refused(
    session: Session, user: User, other_user: User
) -> None:
    """Ticket 18's takeover fix, kept in the new vocabulary.

    `assert_owner` does not merely stop working on an ownerless row, it refuses
    every one of them, so the guard had to be replaced rather than deleted.
    """
    _split_corpus(session, user, other_user)

    with pytest.raises(HTTPException) as raised:
        create_logs(
            session,
            "sync",
            [{"id": "t19-write-theirs", "channelName": THEIRS, "timestamp": 1}],
            user_id=user.id,
        )
    assert raised.value.status_code == 404
    assert session.get(SyncLog, "t19-write-theirs") is None


@pytest.mark.security
@pytest.mark.usefixtures("enforced")
def test_overwriting_a_row_on_a_channel_you_do_not_follow_is_refused(
    session: Session, user: User, other_user: User
) -> None:
    """The takeover shape itself: an existing row, named by a guessed id."""
    _split_corpus(session, user, other_user)
    _log(session, "t19-takeover", THEIRS, owner=other_user.id, error="original")

    with pytest.raises(HTTPException) as raised:
        create_logs(
            session,
            "sync",
            [{"id": "t19-takeover", "channelName": MINE, "timestamp": 2}],
            user_id=user.id,
        )
    assert raised.value.status_code == 404

    row = session.get(SyncLog, "t19-takeover")
    assert row is not None
    assert row.channel_name == THEIRS
    assert row.error == "original"


@pytest.mark.security
@pytest.mark.usefixtures("enforced")
def test_a_follower_cannot_rewrite_telemetry_another_follower_reads(
    session: Session, user: User, other_user: User
) -> None:
    """Found by review. Seeing a row is not permission to flatten it.

    Both accounts follow the Channel, so every visibility check the first cut
    made passes: the incoming name is visible and so is the existing row's. The
    merge then overwrites `status`, `error` and the counts, and the other
    Follower's telemetry says something that never happened, permanently.

    The route gates the single-row *delete* on `DATA_ADMIN` because destroying
    that record is not one Follower's to do. An overwrite destroys the same
    record, so through the API the write is create-only.
    """
    _split_corpus(session, user, other_user)
    ensure_follow(session, channel_id=THEIRS, user_id=user.id)
    session.commit()
    _log(session, "t19-rewrite", THEIRS, owner=other_user.id, error="the real failure")

    with pytest.raises(HTTPException) as raised:
        create_logs(
            session,
            "sync",
            [
                {
                    "id": "t19-rewrite",
                    "channelName": THEIRS,
                    "status": "success",
                    "postsCount": 999,
                    "timestamp": 2,
                }
            ],
            user_id=user.id,
        )
    assert raised.value.status_code == 404

    row = session.get(SyncLog, "t19-rewrite")
    assert row is not None
    assert row.error == "the real failure", "a Follower rewrote shared telemetry"
    assert row.posts_count == 0


@pytest.mark.security
@pytest.mark.usefixtures("enforced")
def test_the_write_matches_the_channel_name_the_way_the_read_does(
    session: Session, user: User
) -> None:
    """Found by review. A looser write guard manufactures unreadable rows.

    `follows.visible_channel_names` lowercases, because its three callers
    compare against handles that `normalize_handle` has already lowercased.
    `scoped_select` does not: it emits `tg_channels.name = tg_sync_logs.channel_name`,
    an exact match. Using the lowercasing one here let an account following
    `MixedCase` write a log naming `mixedcase`, which the EXISTS could then
    never match — invisible to everyone including the account that wrote it.
    """
    add_test_channel(session, "t19-MixedCase", user_id=user.id)

    with pytest.raises(HTTPException) as raised:
        create_logs(
            session,
            "sync",
            [{"id": "t19-case", "channelName": "t19-mixedcase", "timestamp": 1}],
            user_id=user.id,
        )
    assert raised.value.status_code == 404
    assert session.get(SyncLog, "t19-case") is None

    # And the exact spelling still works, or the fix is just a refusal.
    create_logs(
        session,
        "sync",
        [{"id": "t19-case-ok", "channelName": "t19-MixedCase", "timestamp": 1}],
        user_id=user.id,
    )
    assert get_log(session, "sync", "t19-case-ok", user_id=user.id)["id"] == (
        "t19-case-ok"
    )


@pytest.mark.security
@pytest.mark.usefixtures("enforced")
def test_writing_telemetry_for_a_channel_you_follow_is_allowed(
    session: Session, user: User
) -> None:
    """Refusing everything would pass the two tests above."""
    add_test_channel(session, MINE, user_id=user.id)

    result = create_logs(
        session,
        "sync",
        [{"id": "t19-write-mine", "channelName": MINE, "timestamp": 1}],
        user_id=user.id,
    )

    assert result == {"upserted": 1}
    assert session.get(SyncLog, "t19-write-mine") is not None


# --------------------------------------------------------------------------
# With the flag off, nothing moved
# --------------------------------------------------------------------------


@pytest.mark.security
def test_with_the_flag_off_the_page_is_what_it_always_was(
    session: Session, user: User, other_user: User, unenforced: None
) -> None:
    """The promise every migrate ticket in this programme makes."""
    _split_corpus(session, user, other_user)
    mine = _log(session, "t19-off-mine", MINE, owner=user.id, error="pelican")
    theirs = _log(
        session, "t19-off-theirs", THEIRS, owner=other_user.id, error="pelican"
    )

    assert {mine, theirs} <= _ids(session, user.id)
    assert {mine, theirs} <= _ids(session, user.id, search="pelican")
    assert get_log(session, "sync", theirs, user_id=user.id)["id"] == theirs


@pytest.mark.security
def test_with_the_flag_off_the_write_is_what_it_always_was(
    session: Session, user: User, other_user: User, unenforced: None
) -> None:
    _split_corpus(session, user, other_user)

    result = create_logs(
        session,
        "sync",
        [{"id": "t19-off-write", "channelName": THEIRS, "timestamp": 1}],
        user_id=user.id,
    )

    assert result == {"upserted": 1}
    assert session.get(SyncLog, "t19-off-write") is not None
