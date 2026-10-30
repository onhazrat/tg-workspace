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
from sqlmodel import Session

from app.core.config import settings
from app.core.db import engine
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
