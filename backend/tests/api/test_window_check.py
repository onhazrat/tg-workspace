"""The live check: which Channels of a Scope are Incomplete, and why (CW-01).

`POST /data/posts/window-check` answers, for the caller's Channels and an
Analysis window, each Channel's verdict and the window's Unproven Posts
(ADR-043). It reads data and never syncs. E is the window's End or now,
whichever is earlier; a Channel is Complete when all three tests hold:

1. head: a sync read its newest page at or after E, or a Post after E is held;
2. start: a Post at or before the window's Start is held, or a walk reached
   the Channel's first Post;
3. continuity: every id between that Post and the head is held or a
   confirmed gap.

Every world below is a fixed window from `S` to `E`, ending two hours ago,
seeded as the Operator unless it says otherwise.
"""

from __future__ import annotations

import time
import uuid
from collections.abc import Iterator
from typing import Any

import pytest
from fastapi.testclient import TestClient
from sqlmodel import Session, col, delete, select

from app import crud
from app.core.config import settings
from app.core.db import engine
from app.models import User, UserUpdate
from app.models_tg import (
    Channel,
    ChannelSettingGroup,
    Post,
    PostSyncState,
    SyncJob,
    SyncLog,
)
from app.services.follows import get_operator_user_id
from app.services.telegram_web import UNAVAILABLE_WEB_VIEW_MESSAGE
from tests.utils.setting_groups import add_test_channel
from tests.utils.user import create_random_user, user_authentication_headers
from tests.utils.utils import get_superuser_token_headers

URL = f"{settings.API_V1_STR}/data/posts/window-check"
MINUTE = 60_000
HOUR = 60 * MINUTE
DAY = 24 * HOUR
NOW = int(time.time() * 1000) // MINUTE * MINUTE
E = NOW - 2 * HOUR
S = E - 8 * HOUR


@pytest.fixture
def operator(client: TestClient) -> dict[str, str]:
    return get_superuser_token_headers(client)


@pytest.fixture
def session() -> Iterator[Session]:
    with Session(engine) as s:
        yield s


def _owner(session: Session) -> uuid.UUID:
    owner = get_operator_user_id(session)
    assert owner is not None
    return owner


def _channel(
    session: Session,
    name: str,
    posts: list[tuple[int, int]] = (),  # type: ignore[assignment]
    *,
    user_id: uuid.UUID | None = None,
    group: dict[str, Any] | None = None,
    **fields: Any,
) -> None:
    """A followed Channel holding `posts`, each `(post id, published at)`."""
    owner = user_id or _owner(session)
    if group is not None:
        row = ChannelSettingGroup(
            id=str(uuid.uuid4()), user_id=owner, name=f"g-{uuid.uuid4()}", **group
        )
        session.add(row)
        session.flush()
        fields["setting_group_id"] = row.id
    add_test_channel(session, name, name=name, user_id=owner, **fields)
    for post_id, ts in posts:
        session.add(Post(channel_name=name, post_id=post_id, timestamp=ts))
    session.commit()


def _gap(session: Session, name: str, *ids: int) -> None:
    for post_id in ids:
        session.add(PostSyncState(channel_name=name, post_id=post_id, confirmed_at=1))
    session.commit()


def _log(
    session: Session,
    name: str,
    status: str,
    error: str | None = None,
    *,
    at: int = NOW - HOUR,
) -> None:
    session.add(
        SyncLog(
            id=str(uuid.uuid4()),
            channel_name=name,
            status=status,
            error=error,
            timestamp=at,
        )
    )
    session.commit()


def _check(
    client: TestClient,
    headers: dict[str, str],
    *names: str,
    start: int = S,
    end: int = E,
    frozen_at: int | None = None,
) -> dict[str, Any]:
    response = client.post(
        URL,
        json={
            "channelNames": list(names),
            "window": {"mode": "fixed", "start": start, "end": end},
            "frozenAt": frozen_at,
        },
        headers=headers,
    )
    assert response.status_code == 200, response.text
    body: dict[str, Any] = response.json()
    return body


def _verdict(body: dict[str, Any], name: str) -> dict[str, Any]:
    (found,) = [c for c in body["channels"] if c["name"] == name]
    return found


#: Before the Start, inside the window, after its End: all three tests hold.
WHOLE = [(1, S - HOUR), (2, S + HOUR), (3, E + HOUR)]


def test_a_channel_with_head_start_and_continuity_is_complete(
    client: TestClient, operator: dict[str, str], session: Session
) -> None:
    _channel(session, "cw_whole", WHOLE)

    body = _check(client, operator, "cw_whole")

    verdict = _verdict(body, "cw_whole")
    assert (verdict["reasons"], verdict["reason"]) == ([], None)
    assert verdict["stretches"] == []
    assert (verdict["heldPosts"], body["heldPosts"]) == (1, 1)
    assert (body["start"], body["end"]) == (S, E)
    assert (body["unprovenPosts"], body["unprovenFloor"]) == (0, False)


# --- each test failing alone -------------------------------------------------


def test_no_head_read_after_the_end_is_not_synced_to_the_end(
    client: TestClient, operator: dict[str, str], session: Session
) -> None:
    """The stretch runs from the last proven moment (the head read here) to E."""
    _channel(session, "cw_lag", WHOLE[:2], head_read_at=S + 5 * HOUR)
    _channel(session, "cw_read", WHOLE[:2], head_read_at=E)

    body = _check(client, operator, "cw_lag", "cw_read")

    lag = _verdict(body, "cw_lag")
    assert (lag["reasons"], lag["reason"]) == (["end"], "end")
    assert lag["stretches"] == [{"kind": "end", "from": S + 5 * HOUR, "to": E}]
    assert lag["headReadAt"] == S + 5 * HOUR
    assert lag["syncable"] is True
    assert _verdict(body, "cw_read")["reasons"] == []


def test_no_post_at_or_before_the_start_is_history_short_of_the_start(
    client: TestClient, operator: dict[str, str], session: Session
) -> None:
    """Unless a walk reached the Channel's first Post: then there is no older."""
    _channel(session, "cw_young", WHOLE[1:])
    _channel(session, "cw_born", WHOLE[1:], history_reached_channel_start=True)

    body = _check(client, operator, "cw_young", "cw_born")

    young = _verdict(body, "cw_young")
    assert young["reasons"] == ["start"]
    assert young["stretches"] == [{"kind": "start", "from": S, "to": S + HOUR}]
    assert _verdict(body, "cw_born")["reasons"] == []


def test_an_id_neither_held_nor_a_confirmed_gap_is_a_hole(
    client: TestClient, operator: dict[str, str], session: Session
) -> None:
    holed = [(1, S - HOUR), (2, S + HOUR), (5, S + 3 * HOUR), (6, E + HOUR)]
    _channel(session, "cw_holed", holed)
    _channel(session, "cw_gapped", holed)
    _gap(session, "cw_gapped", 3, 4)

    body = _check(client, operator, "cw_holed", "cw_gapped")

    hole = _verdict(body, "cw_holed")
    assert hole["reasons"] == ["hole"]
    assert hole["missingIds"] == 2
    assert hole["stretches"] == [{"kind": "hole", "from": S + HOUR, "to": S + 3 * HOUR}]
    assert _verdict(body, "cw_gapped")["reasons"] == []


# --- the reasons no test names -----------------------------------------------

#: Synced to the Start and continuous, but never read past `S + 5 h`.
UNREAD_END = {"head_read_at": S + 5 * HOUR}


def test_a_failed_last_sync_is_shown_first_with_its_error(
    client: TestClient, operator: dict[str, str], session: Session
) -> None:
    """Only on an Incomplete Channel: a Complete one's failure changes nothing."""
    _channel(session, "cw_failed", WHOLE[:2], **UNREAD_END)
    _channel(session, "cw_fine", WHOLE)
    _log(session, "cw_failed", "failed", "proxy down")
    _log(session, "cw_fine", "failed", "proxy down")

    body = _check(client, operator, "cw_failed", "cw_fine")

    failed = _verdict(body, "cw_failed")
    assert (failed["reasons"], failed["reason"]) == (["failed", "end"], "failed")
    assert (failed["error"], failed["syncable"]) == ("proxy down", True)
    assert _verdict(body, "cw_fine")["reasons"] == []


def test_a_sync_that_failed_after_the_frozen_moment_shows_failed(
    client: TestClient, operator: dict[str, str], session: Session
) -> None:
    """The gate waits past its click, so the last sync is read up to now:
    one it waited on that failed shows its error (story 39).

    **Mutation:** read the logs only up to the frozen moment and it reads "end".
    """
    _channel(session, "cw_waited", WHOLE[:2], **UNREAD_END)
    _log(session, "cw_waited", "failed", "proxy down", at=NOW - MINUTE)

    body = _check(client, operator, "cw_waited", frozen_at=NOW - 30 * MINUTE)

    verdict = _verdict(body, "cw_waited")
    assert (verdict["reason"], verdict["error"]) == ("failed", "proxy down")


def test_a_frozen_channel_is_incomplete_and_no_sync_can_fix_it(
    client: TestClient, operator: dict[str, str], session: Session
) -> None:
    _channel(session, "cw_frozen", WHOLE[:2], group={"is_frozen": True}, **UNREAD_END)

    verdict = _verdict(_check(client, operator, "cw_frozen"), "cw_frozen")

    assert (verdict["reasons"], verdict["syncable"]) == (["end", "frozen"], False)


def test_unavailable_from_its_group_or_its_last_error_replaces_failed(
    client: TestClient, operator: dict[str, str], session: Session
) -> None:
    _channel(
        session,
        "cw_marked",
        WHOLE[:2],
        group={"is_unavailable_on_web_view": True},
        **UNREAD_END,
    )
    _channel(session, "cw_gone", WHOLE[:2], **UNREAD_END)
    _log(session, "cw_gone", "failed", UNAVAILABLE_WEB_VIEW_MESSAGE)

    body = _check(client, operator, "cw_marked", "cw_gone")

    for name in ("cw_marked", "cw_gone"):
        verdict = _verdict(body, name)
        assert (verdict["reasons"], verdict["syncable"]) == (
            ["end", "unavailable"],
            False,
        ), name


def test_history_short_of_a_start_past_the_scrape_cutoff_is_retention(
    client: TestClient, operator: dict[str, str], session: Session
) -> None:
    """No sync walks back past the cutoff, so a sync cannot fix it."""
    old = NOW - 100 * DAY
    _channel(session, "cw_old", [(1, old + HOUR), (2, NOW - HOUR)], head_read_at=NOW)

    body = _check(client, operator, "cw_old", start=old, end=old + 2 * HOUR)

    verdict = _verdict(body, "cw_old")
    assert (verdict["reasons"], verdict["syncable"]) == (["retention"], False)


@pytest.mark.parametrize(
    ("next_due", "behind"),
    [
        pytest.param(NOW + HOUR, True, id="due-later"),
        pytest.param(NOW - HOUR, False, id="past-due"),
    ],
)
def test_lag_is_behind_until_its_next_scheduled_sync_is_past_due(
    client: TestClient,
    operator: dict[str, str],
    session: Session,
    next_due: int,
    behind: bool,
) -> None:
    """Both keep the reason; Behind is a grouping, not a reason."""
    _channel(session, "cw_due", WHOLE[:2], next_regular_sync_at=next_due, **UNREAD_END)

    verdict = _verdict(_check(client, operator, "cw_due"), "cw_due")

    assert (verdict["reasons"], verdict["behind"]) == (["end"], behind)


def test_lag_with_another_problem_is_never_behind(
    client: TestClient, operator: dict[str, str], session: Session
) -> None:
    _channel(
        session,
        "cw_both",
        [(1, S - HOUR), (3, S + HOUR)],
        next_regular_sync_at=NOW + HOUR,
        **UNREAD_END,
    )

    verdict = _verdict(_check(client, operator, "cw_both"), "cw_both")

    assert (verdict["reasons"], verdict["behind"]) == (["end", "hole"], False)


# --- Unproven Posts ------------------------------------------------------------

#: Last read a day before E, in a window starting two days before it.
READ = E - 24 * HOUR
S2 = E - 48 * HOUR
#: One Post eight days before the read, then one every 12 h for the week
#: before it: 14 Posts in 168 h, a pace of one Post per 12 h.
PACED = [(1, READ - 8 * 24 * HOUR)] + [
    (15 - k, READ - k * 12 * HOUR) for k in range(14)
]
HOLED = [(1, S - HOUR), (2, S + HOUR), (5, S + 3 * HOUR), (6, E + HOUR)]


def test_a_hole_counts_its_missing_ids_exactly(
    client: TestClient, operator: dict[str, str], session: Session
) -> None:
    """No pace needed: a hole-only Channel's unknown pace is no floor."""
    _channel(session, "cw_holed", HOLED)

    body = _check(client, operator, "cw_holed")

    assert (body["unprovenPosts"], body["unprovenFloor"]) == (2, False)


def test_lag_counts_at_the_channels_own_pace(
    client: TestClient, operator: dict[str, str], session: Session
) -> None:
    """24 h unproven at one Post per 12 h is about 2 Posts."""
    _channel(session, "cw_paced", PACED, head_read_at=READ)

    body = _check(client, operator, "cw_paced", start=S2)

    verdict = _verdict(body, "cw_paced")
    assert verdict["stretches"] == [{"kind": "end", "from": READ, "to": E}]
    assert verdict["pacePerHour"] == pytest.approx(1 / 12)
    assert verdict["unprovenPosts"] == pytest.approx(2)
    assert (body["heldPosts"], body["unprovenPosts"]) == (3, 2)
    assert body["unprovenFloor"] is False


def test_an_unknown_pace_makes_the_total_a_floor(
    client: TestClient, operator: dict[str, str], session: Session
) -> None:
    """Never read, so no pace: its lag may hide any number of Posts."""
    _channel(session, "cw_holed", HOLED)
    _channel(session, "cw_unread", WHOLE[:2])

    body = _check(client, operator, "cw_holed", "cw_unread")

    assert _verdict(body, "cw_unread")["pacePerHour"] is None
    assert (body["unprovenPosts"], body["unprovenFloor"]) == (2, True)


def test_no_posts_expected_only_when_every_pace_is_known(
    client: TestClient, operator: dict[str, str], session: Session
) -> None:
    """Silent all week: a known pace of zero, so its lag hides nothing."""
    _channel(session, "cw_silent", PACED[:1], head_read_at=READ)

    body = _check(client, operator, "cw_silent", start=S2)

    assert _verdict(body, "cw_silent")["reasons"] == ["end"]
    assert _verdict(body, "cw_silent")["pacePerHour"] == 0
    assert (body["unprovenPosts"], body["unprovenFloor"]) == (0, False)


# --- Follow-scoped isolation -----------------------------------------------------


@pytest.fixture
def other(client: TestClient) -> Iterator[tuple[uuid.UUID, dict[str, str]]]:
    with Session(engine) as session:
        user = create_random_user(session)
        crud.update_user(
            session=session, db_user=user, user_in=UserUpdate(password="cw01-pass")
        )
        user_id, email = user.id, user.email
    yield (
        user_id,
        user_authentication_headers(client=client, email=email, password="cw01-pass"),
    )
    with Session(engine) as session:
        session.exec(delete(User).where(col(User.id) == user_id))
        session.commit()


def test_another_accounts_channels_and_settings_never_reach_the_check(
    client: TestClient,
    operator: dict[str, str],
    session: Session,
    other: tuple[uuid.UUID, dict[str, str]],
) -> None:
    """A Channel only they follow is not judged, and their frozen group says
    nothing about a Channel both follow."""
    other_id, _ = other
    _channel(session, "cw_theirs", HOLED, user_id=other_id)
    _channel(session, "cw_shared", WHOLE[:2], **UNREAD_END)
    _channel(session, "cw_shared", user_id=other_id, group={"is_frozen": True})

    body = _check(client, operator, "cw_theirs", "cw_shared")

    assert [c["name"] for c in body["channels"]] == ["cw_shared"]
    assert _verdict(body, "cw_shared")["reasons"] == ["end"]
    assert body["heldPosts"] == 1


# --- syncs in flight -------------------------------------------------------------


def _syncing(
    session: Session, owner: uuid.UUID, started: int, *names: str, done: str = ""
) -> None:
    """A sync job of `owner`'s, running since `started`, still syncing `names`
    and already done with `done`."""
    entries = [
        {
            "channelId": session.exec(
                select(Channel.id).where(Channel.name == n)
            ).one(),
            "channelName": n,
            "status": "success" if n == done else "running",
        }
        for n in (*names, *([done] if done else []))
    ]
    session.add(
        SyncJob(
            id=str(uuid.uuid4()),
            user_id=owner,
            status="running",
            channels=entries,
            created_at=started,
        )
    )
    session.commit()


@pytest.mark.parametrize(
    ("head_read_at", "again"),
    [
        # Read at or after its start: its own read, before E. It cannot pass.
        pytest.param(E - 10 * MINUTE, True, id="read its head before E"),
        # An earlier sync's read: this one's is still to come, after E.
        pytest.param(E - 40 * MINUTE, False, id="head still to read"),
    ],
)
def test_any_accounts_sync_in_flight_is_answered_per_channel(
    client: TestClient,
    operator: dict[str, str],
    session: Session,
    other: tuple[uuid.UUID, dict[str, str]],
    head_read_at: int,
    again: bool,
) -> None:
    """The gate joins it, or queues another behind it (CW-03's rule, asked
    in one place). A Channel the job already finished is not in flight.

    **Mutation:** judge by when the job started, not by the head read, and
    "read its head before E" is answered False.
    """
    started = E - 30 * MINUTE
    _channel(session, "cw_flying", WHOLE[:2], head_read_at=head_read_at)
    _channel(session, "cw_landed", WHOLE[:2], head_read_at=head_read_at)
    _syncing(session, other[0], started, "cw_flying", done="cw_landed")

    body = _check(client, operator, "cw_flying", "cw_landed")

    flying = _verdict(body, "cw_flying")
    assert (flying["syncingSince"], flying["syncAgain"]) == (started, again)
    landed = _verdict(body, "cw_landed")
    assert (landed["syncingSince"], landed["syncAgain"]) == (None, False)


# --- the gate's own moment ----------------------------------------------


def test_the_gate_checks_again_at_its_own_moment(
    client: TestClient, operator: dict[str, str], session: Session
) -> None:
    """After its sync the gate asks the live check about the window as it froze
    at the click, so the toast counts what the record will hold."""
    _channel(session, "cg_whole", WHOLE)
    clicked = NOW - 10 * 60_000
    live = {"mode": "live", "durationMinutes": 60, "endGapMinutes": 0}

    response = client.post(
        URL,
        headers=operator,
        json={"channelNames": ["cg_whole"], "window": live, "frozenAt": clicked},
    )

    assert response.status_code == 200, response.text
    body = response.json()
    assert (body["frozenAt"], body["end"], body["start"]) == (
        clicked,
        clicked,
        clicked - HOUR,
    )
