"""The exact wire shape of the Discover reads.

The Discover services are covered well under `tests/services/`, but those tests
call the service functions directly. Response models sit at the HTTP boundary,
so a model that declares too few keys (silently truncating the payload) or too
many (materialising explicit `null`s that were never sent) passes every one of
them. These tests assert the key sets at the boundary instead, which is where
that class of mistake actually shows up.

The distinction they exist to protect is `probe`: `POST /discover/candidates`
does not emit the key at all, while a saved report resolves it on every read and
emits `null` for a handle nothing has looked at yet. Collapsing the two models
into one optional field would add `"probe": null` to the stateless aggregate and
change a payload nobody asked to change.
"""

from __future__ import annotations

from typing import Any

from fastapi.testclient import TestClient
from sqlmodel import Session

from app.core.config import settings
from app.core.db import engine
from app.models_tg import Post
from app.services.discover_probes import record_probe_result
from tests.utils.tenancy import follow_channels

DATA = f"{settings.API_V1_STR}/data"

CARRIER = "carrier_one"
TARGET = "target_two"

OK_PAGE = {
    "isTelegramPage": True,
    "isUnavailableOnWebView": False,
    "kind": "channel",
    "displayName": "Target Two",
    "subscribers": "12.3K",
}

CANDIDATE_KEYS = {
    "name",
    "displayName",
    "counts",
    "total",
    "seenIn",
    "seenInCount",
    "lastSeen",
    "isFollowed",
    "isIgnored",
    "samplePost",
}
REPORT_BASE_KEYS = {
    "id",
    "scope",
    "scopeCounts",
    "postsInScope",
    "timestamp",
    "candidateCount",
    # Declared rather than left to an open `extra` bag, so History's
    # starred-only filter spans all four artifact kinds instead of silently
    # skipping this one.
    "isStarred",
    "note",
}
SCOPE_KEYS = {
    "channels",
    "startDate",
    "endDate",
    "signals",
    "keyword",
    "forwarded",
    "media",
    "maxPerChannel",
    "maxPerChannelMode",
    "seed",
    "scopedPostCount",
}


def _auth(client: TestClient) -> dict[str, str]:
    login = client.post(
        f"{settings.API_V1_STR}/login/access-token",
        data={
            "username": settings.FIRST_SUPERUSER,
            "password": settings.FIRST_SUPERUSER_PASSWORD,
        },
    )
    return {"Authorization": f"Bearer {login.json()['access_token']}"}


def _seed_forward() -> None:
    """One post in `CARRIER` forwarding `TARGET`, so exactly one candidate."""
    with Session(engine) as session:
        session.add(
            Post(
                channel_name=CARRIER,
                post_id=1,
                text="a forwarded post",
                timestamp=1000,
                forwarded_from=TARGET,
                forwarded_from_name="Target Two",
            )
        )
        session.commit()
        # Ticket 21: the carrier is `FOLLOW_SCOPED`, so under enforcement the
        # Discover routes below aggregate nothing from it. No `user_id` here —
        # these read through the test client as `FIRST_SUPERUSER`, which is the
        # operator `follow_channels` defaults to.
        follow_channels(session, CARRIER)


def _candidates(client: TestClient, headers: dict[str, str]) -> list[dict[str, Any]]:
    r = client.post(
        f"{DATA}/discover/candidates",
        json={"channelNames": [CARRIER]},
        headers=headers,
    )
    assert r.status_code == 200, r.text
    return list(r.json()["candidates"])


def _report(client: TestClient, headers: dict[str, str]) -> dict[str, Any]:
    r = client.post(
        f"{DATA}/discover/reports",
        json={"channelNames": [CARRIER]},
        headers=headers,
    )
    assert r.status_code == 200, r.text
    return dict(r.json())


def test_stateless_candidates_keep_their_exact_key_set(client: TestClient) -> None:
    headers = _auth(client)
    _seed_forward()

    candidates = _candidates(client, headers)
    assert len(candidates) == 1
    assert set(candidates[0]) == CANDIDATE_KEYS


def test_stateless_candidates_do_not_carry_a_probe_key(client: TestClient) -> None:
    """The aggregate has never joined the probe table; declaring the key
    optional on a shared model would start emitting `"probe": null` here."""
    headers = _auth(client)
    _seed_forward()

    assert "probe" not in _candidates(client, headers)[0]


def test_candidate_nesting_survives_the_response_model(client: TestClient) -> None:
    headers = _auth(client)
    _seed_forward()

    candidate = _candidates(client, headers)[0]
    assert candidate["name"] == TARGET
    assert candidate["displayName"] == "Target Two"
    assert candidate["counts"] == {"forward": 1, "mention": 0, "link": 0}
    assert candidate["total"] == 1
    assert candidate["seenInCount"] == 1
    assert candidate["seenIn"] == [
        {
            "channelName": CARRIER,
            "counts": {"forward": 1, "mention": 0, "link": 0},
            "total": 1,
        }
    ]
    assert candidate["samplePost"] == {
        "channelName": CARRIER,
        "postId": 1,
        "timestamp": 1000,
    }


def test_the_aggregate_reports_scope_counts_and_posts_in_scope(
    client: TestClient,
) -> None:
    headers = _auth(client)
    _seed_forward()

    body = client.post(
        f"{DATA}/discover/candidates",
        json={"channelNames": [CARRIER]},
        headers=headers,
    ).json()
    assert set(body) == {"candidates", "scopeCounts", "postsInScope"}
    assert body["scopeCounts"] == {
        "forwardPosts": 1,
        "mentionPosts": 0,
        "linkPosts": 0,
    }
    assert body["postsInScope"] == 1


def test_a_saved_report_adds_probe_and_nothing_else(client: TestClient) -> None:
    headers = _auth(client)
    _seed_forward()

    candidate = _report(client, headers)["candidates"][0]
    assert set(candidate) == CANDIDATE_KEYS | {"probe"}
    # Enqueued but never fetched must read as "not checked", not as a verdict.
    assert candidate["probe"] is None


def test_a_resolved_probe_is_joined_into_the_report_read(client: TestClient) -> None:
    headers = _auth(client)
    _seed_forward()
    report_id = _report(client, headers)["id"]

    with Session(engine) as session:
        record_probe_result(session, TARGET, OK_PAGE)

    r = client.get(f"{DATA}/discover/reports/{report_id}", headers=headers)
    assert r.status_code == 200
    probe = r.json()["candidates"][0]["probe"]
    assert set(probe) == {
        "handle",
        "status",
        "kind",
        "displayName",
        "bio",
        "subscribers",
        "photoUrl",
        "attempts",
        "lastError",
        "checkedAt",
    }
    assert probe["status"] == "ok"
    assert probe["kind"] == "channel"
    assert probe["subscribers"] == "12.3K"


def test_the_full_report_keeps_its_scope_snapshot(client: TestClient) -> None:
    headers = _auth(client)
    _seed_forward()

    report = _report(client, headers)
    assert set(report) == REPORT_BASE_KEYS | {"candidates"}
    assert set(report["scope"]) == SCOPE_KEYS
    assert report["scope"]["channels"] == [CARRIER]
    assert report["candidateCount"] == 1


def test_the_report_list_ships_a_count_not_the_candidates(client: TestClient) -> None:
    """`candidates` is the corpus-sized field; the list must never carry it."""
    headers = _auth(client)
    _seed_forward()
    _report(client, headers)

    rows = client.get(f"{DATA}/discover/reports", headers=headers).json()
    assert len(rows) == 1
    assert set(rows[0]) == REPORT_BASE_KEYS
    assert "candidates" not in rows[0]
    assert rows[0]["candidateCount"] == 1


def test_dismissals_round_trip_with_their_declared_shape(client: TestClient) -> None:
    headers = _auth(client)

    added = client.post(
        f"{DATA}/discover/ignored",
        json={"handles": [TARGET], "reason": "not interesting"},
        headers=headers,
    )
    assert added.status_code == 200
    assert added.json() == {"ignored": [TARGET]}

    rows = client.get(f"{DATA}/discover/ignored", headers=headers).json()
    assert len(rows) == 1
    assert set(rows[0]) == {"handle", "reason", "createdAt"}
    assert rows[0]["handle"] == TARGET
    assert rows[0]["reason"] == "not interesting"
    assert isinstance(rows[0]["createdAt"], int)

    removed = client.request(
        "DELETE",
        f"{DATA}/discover/ignored",
        json={"handles": [TARGET]},
        headers=headers,
    )
    assert removed.status_code == 200
    assert removed.json() == {"removed": [TARGET]}


def test_re_dismissing_stays_idempotent_through_the_response_model(
    client: TestClient,
) -> None:
    headers = _auth(client)
    body = {"handles": [TARGET]}
    client.post(f"{DATA}/discover/ignored", json=body, headers=headers)

    again = client.post(f"{DATA}/discover/ignored", json=body, headers=headers)
    assert again.status_code == 200
    assert again.json() == {"ignored": []}


def test_the_probe_listing_keeps_its_key_set(client: TestClient) -> None:
    headers = _auth(client)
    with Session(engine) as session:
        record_probe_result(session, TARGET, OK_PAGE)

    rows = client.get(f"{DATA}/discover/probes", headers=headers).json()
    assert len(rows) == 1
    assert set(rows[0]) == {
        "handle",
        "status",
        "kind",
        "displayName",
        "bio",
        "subscribers",
        "photoUrl",
        "attempts",
        "lastError",
        "checkedAt",
    }


def test_recheck_returns_the_handles_it_queued_not_a_count(client: TestClient) -> None:
    """The UI repaints the named rows as pending, so it needs the handles."""
    headers = _auth(client)
    with Session(engine) as session:
        record_probe_result(session, TARGET, OK_PAGE)

    r = client.post(
        f"{DATA}/discover/probe/recheck",
        json={"handles": [TARGET]},
        headers=headers,
    )
    assert r.status_code == 200
    assert r.json() == {"requeued": [TARGET]}


def test_the_queue_read_keeps_its_key_set(client: TestClient) -> None:
    body = client.get(f"{DATA}/discover/probe/queue", headers=_auth(client)).json()
    assert set(body) == {
        "queued",
        "retrying",
        "resolved",
        "unavailable",
        "enabled",
        "running",
    }
