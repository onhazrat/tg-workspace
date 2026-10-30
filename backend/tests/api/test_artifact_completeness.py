"""Each Artifact keeps, for good, whether its window was Complete (CW-02).

The four creation paths (Summary, Chat, Tag run, Discovery report) take the
gate's outcome beside their Scope: the choice, the Channels the person
skipped, the ones whose sync timed out, the ones Left out, and the moment the
action froze. The server runs the check itself at that moment, overlays
skipped and timed out on its own verdicts, and stores the record in the
frozen Scope (ADR-043). An Artifact read returns it; History's list carries
only what its pill needs.
"""

from __future__ import annotations

import uuid
from collections.abc import Iterator
from typing import Any

import pytest
from fastapi.testclient import TestClient
from sqlmodel import Session, col, select

from app.core.config import settings
from app.core.db import engine
from app.models_tg import Channel, PostSyncState, SyncLog
from tests.api.test_window_check import (
    HOUR,
    NOW,
    WHOLE,
    E,
    S,
    _channel,
)
from tests.utils.utils import get_superuser_token_headers

PREFIX = f"{settings.API_V1_STR}/data"
WINDOW = {"mode": "fixed", "start": S, "end": E}
#: Synced to the Start and continuous, but never read past `S + 5 h`.
LAGGING = {"head_read_at": S + 5 * HOUR}


@pytest.fixture
def operator(client: TestClient) -> dict[str, str]:
    return get_superuser_token_headers(client)


@pytest.fixture
def session() -> Iterator[Session]:
    with Session(engine) as s:
        yield s


def _gate(choice: str, **lists: list[str]) -> dict[str, Any]:
    return {"choice": choice, "frozenAt": NOW, **lists}


def _scope(names: list[str], gate: dict[str, Any] | None) -> dict[str, Any]:
    scope: dict[str, Any] = {"channels": names, "window": WINDOW}
    if gate is not None:
        scope["gate"] = gate
    return scope


#: Each Artifact kind: how to open one at a Scope, and where to read it back.
def _open(
    client: TestClient,
    headers: dict[str, str],
    kind: str,
    names: list[str],
    gate: dict[str, Any] | None,
) -> dict[str, Any]:
    artifact_id = str(uuid.uuid4())
    if kind == "summary":
        path, body = "summaries", {"id": artifact_id, "scope": _scope(names, gate)}
    elif kind == "chat":
        path, body = "chat-sessions", {"id": artifact_id, "scope": _scope(names, gate)}
    elif kind == "tag":
        path, body = "tag-runs", {"id": artifact_id, "scope": _scope(names, gate)}
    else:
        path = "discover/reports"
        body = {"channelNames": names, "window": WINDOW}
        if gate is not None:
            body["gate"] = gate
    created = client.post(f"{PREFIX}/{path}", headers=headers, json=body)
    assert created.status_code == 200, created.text
    if kind == "discovery":
        artifact_id = created.json()["id"]
    read = client.get(f"{PREFIX}/{path}/{artifact_id}", headers=headers)
    assert read.status_code == 200, read.text
    out: dict[str, Any] = read.json()
    return out


def _record(artifact: dict[str, Any]) -> dict[str, Any] | None:
    found: dict[str, Any] | None = artifact["scope"].get("completeness")
    return found


KINDS = ["summary", "chat", "tag", "discovery"]


@pytest.mark.parametrize("kind", KINDS)
def test_a_skip_records_the_servers_reasons_with_skipped_first(
    client: TestClient, operator: dict[str, str], session: Session, kind: str
) -> None:
    """The client names what it skipped; the reasons are the server's own."""
    _channel(session, "cg_lag", WHOLE[:2], **LAGGING)
    _channel(session, "cg_whole", WHOLE)

    record = _record(
        _open(
            client,
            operator,
            kind,
            ["cg_lag", "cg_whole"],
            _gate("skipped", skipped=["cg_lag"]),
        )
    )

    assert record is not None
    assert record["choice"] == "skipped"
    assert record["channelCount"] == 2
    ((lag,),) = [record["channels"]]
    assert (lag["name"], lag["reasons"], lag["reason"]) == (
        "cg_lag",
        ["skipped", "end"],
        "skipped",
    )
    assert lag["stretches"] == [{"kind": "end", "from": S + 5 * HOUR, "to": E}]
    assert record["leftOut"] == []
    assert record["incompleteCount"] == 1
    assert record["fixable"] is True


@pytest.mark.parametrize("kind", KINDS)
@pytest.mark.parametrize(
    ("choice", "lists", "shown"),
    [
        ("synced", {}, "end"),
        ("continued_early", {"timedOut": ["cg_lag"]}, "timed_out"),
        ("nothing_to_sync", {}, "end"),
    ],
)
def test_each_choice_is_read_back_as_sent_over_the_servers_check(
    client: TestClient,
    operator: dict[str, str],
    session: Session,
    kind: str,
    choice: str,
    lists: dict[str, list[str]],
    shown: str,
) -> None:
    _channel(session, "cg_lag", WHOLE[:2], **LAGGING)

    record = _record(_open(client, operator, kind, ["cg_lag"], _gate(choice, **lists)))

    assert record is not None
    assert record["choice"] == choice
    assert [c["reason"] for c in record["channels"]] == [shown]
    assert (record["start"], record["end"], record["frozenAt"]) == (S, E, NOW)


@pytest.mark.parametrize("kind", KINDS)
def test_complete_only_names_its_left_out_channels_on_a_complete_window(
    client: TestClient, operator: dict[str, str], session: Session, kind: str
) -> None:
    """The client narrowed the selection; the Left out are not Incomplete."""
    _channel(session, "cg_whole", WHOLE)

    record = _record(
        _open(
            client,
            operator,
            kind,
            ["cg_whole"],
            _gate("complete_only", leftOut=["cg_lag", "cg_frozen"]),
        )
    )

    assert record is not None
    assert (record["choice"], record["leftOut"]) == (
        "complete_only",
        ["cg_lag", "cg_frozen"],
    )
    assert (record["channels"], record["incompleteCount"]) == ([], 0)
    assert (record["unprovenPosts"], record["fixable"]) == (0, False)


def test_the_reasons_are_the_servers_whatever_the_client_skipped(
    client: TestClient, operator: dict[str, str], session: Session
) -> None:
    """A skip names a Channel; it never makes a Complete one Incomplete, and a
    Channel the client said nothing of keeps the reasons the server found."""
    _channel(session, "cg_whole", WHOLE)
    _channel(session, "cg_frozen", WHOLE[:2], group={"is_frozen": True}, **LAGGING)

    record = _record(
        _open(
            client,
            operator,
            "summary",
            ["cg_whole", "cg_frozen"],
            _gate("skipped", skipped=["cg_whole"]),
        )
    )

    assert record is not None
    ((frozen,),) = [record["channels"]]
    assert (frozen["name"], frozen["reasons"], frozen["syncable"]) == (
        "cg_frozen",
        ["end", "frozen"],
        False,
    )
    assert record["fixable"] is False


def test_a_skip_changes_no_shared_row(
    client: TestClient, operator: dict[str, str], session: Session
) -> None:
    """Not the Channel, its sync state, its sync logs or its failure count."""
    _channel(session, "cg_lag", WHOLE[:2], **LAGGING)

    def shared() -> tuple[Any, ...]:
        session.expire_all()
        channel = session.exec(select(Channel).where(Channel.name == "cg_lag")).one()
        return (
            channel.model_dump(),
            session.exec(select(SyncLog).where(SyncLog.channel_name == "cg_lag")).all(),
            session.exec(
                select(PostSyncState).where(col(PostSyncState.channel_name) == "cg_lag")
            ).all(),
        )

    before = shared()
    _open(client, operator, "summary", ["cg_lag"], _gate("skipped", skipped=["cg_lag"]))

    assert shared() == before


@pytest.mark.parametrize("kind", KINDS)
def test_an_artifact_made_without_the_gate_reads_not_checked(
    client: TestClient, operator: dict[str, str], session: Session, kind: str
) -> None:
    """`null`, never an empty record: not checked is not Complete."""
    _channel(session, "cg_lag", WHOLE[:2], **LAGGING)

    artifact = _open(client, operator, kind, ["cg_lag"], None)

    assert "completeness" in artifact["scope"]
    assert _record(artifact) is None


def test_the_window_freezes_at_the_gates_moment_never_later_than_now(
    client: TestClient, operator: dict[str, str], session: Session
) -> None:
    """A Live window is read at the click, not when the request lands after a
    sync; a moment in the future is now."""
    _channel(session, "cg_whole", WHOLE)
    live = {"mode": "live", "durationMinutes": 60, "endGapMinutes": 0}

    def opened(frozen_at: int) -> dict[str, Any]:
        gate = {"choice": "complete", "frozenAt": frozen_at}
        artifact_id = str(uuid.uuid4())
        body = {
            "id": artifact_id,
            "scope": {"channels": ["cg_whole"], "window": live, "gate": gate},
        }
        created = client.post(f"{PREFIX}/summaries", headers=operator, json=body)
        assert created.status_code == 200, created.text
        read = client.get(f"{PREFIX}/summaries/{artifact_id}", headers=operator)
        scope: dict[str, Any] = read.json()["scope"]
        return scope

    clicked = NOW - 10 * 60_000
    early = opened(clicked + 5_000)
    assert early["end"] == clicked
    assert early["completeness"]["frozenAt"] == clicked + 5_000

    later = opened(NOW + 365 * 24 * HOUR)
    assert NOW <= later["end"] < NOW + 2 * HOUR
    assert later["completeness"]["frozenAt"] < NOW + 2 * HOUR


def test_historys_list_carries_only_the_pills_fields(
    client: TestClient, operator: dict[str, str], session: Session
) -> None:
    _channel(session, "cg_lag", WHOLE[:2], **LAGGING)
    _open(client, operator, "summary", ["cg_lag"], _gate("skipped", skipped=["cg_lag"]))
    _open(client, operator, "tag", ["cg_lag"], None)

    listed = client.get(f"{PREFIX}/artifacts", headers=operator)
    assert listed.status_code == 200, listed.text

    marks = {row["kind"]: row["scope"]["completeness"] for row in listed.json()}
    assert marks == {
        "summary": {
            "unprovenPosts": marks["summary"]["unprovenPosts"],
            "unprovenFloor": marks["summary"]["unprovenFloor"],
            "fixable": True,
            "incompleteCount": 1,
        },
        "tag": None,
    }


def test_the_gate_checks_again_at_its_own_moment(
    client: TestClient, operator: dict[str, str], session: Session
) -> None:
    """After its sync the gate asks the live check about the window as it froze
    at the click, so the toast counts what the record will hold."""
    _channel(session, "cg_whole", WHOLE)
    clicked = NOW - 10 * 60_000
    live = {"mode": "live", "durationMinutes": 60, "endGapMinutes": 0}

    response = client.post(
        f"{PREFIX}/posts/window-check",
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
