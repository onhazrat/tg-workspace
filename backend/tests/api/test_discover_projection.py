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

import uuid
from typing import Any

from fastapi.testclient import TestClient
from sqlmodel import Session

from app.core.config import settings
from app.core.db import engine
from app.models_tg import DiscoverReport, Post
from app.services.channel_directory import record_probe_result
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
    "reference",
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
#: A saved report's `scope`, which is the shared `FrozenScope` plus this
#: family's own keys (AW-06).
#:
#: `start` / `end` / `durationMinutes` / `posts` come from the base model, so
#: this set is the place a filter added to `FrozenScope` and forgotten in a
#: projection shows up.
#:
#: `signals` stays after AW-07 — it picks which kinds of signal a report
#: describes, not which Posts it reads. `startDate` / `endDate` do not: they are
#: the superseded spelling of `start` / `end`, kept only until AW-08 moves the
#: scope card.
SCOPE_KEYS = {
    "channels",
    "start",
    "end",
    "durationMinutes",
    "posts",
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
    "sort",
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


#: A report is an Artifact, so it must name a window (AW-06). `/candidates`
#: above deliberately does not: it computes and forgets, and "both sides open"
#: is a corpus pass rather than a Scope anybody chose.
#:
#: A century wide, because the Posts seeded above sit at epoch-relative
#: timestamps. These tests are about response *shape*, so the window has to be
#: the one thing that cannot be why a candidate is missing.
ANY_WINDOW = {
    "mode": "live",
    "durationMinutes": 100 * 365 * 24 * 60,
    "endGapMinutes": 0,
}


def _report(client: TestClient, headers: dict[str, str]) -> dict[str, Any]:
    r = client.post(
        f"{DATA}/discover/reports",
        json={"channelNames": [CARRIER], "window": ANY_WINDOW},
        headers=headers,
    )
    assert r.status_code == 200, r.text
    return dict(r.json())


def test_a_saved_report_must_name_a_window(client: TestClient) -> None:
    """Where the stateless twin one function up is happy without one.

    The difference is that this one *records* its answer, and a stored Scope
    reading "everything, at some unrecorded moment" is not a description of
    which Posts produced a result.
    """
    r = client.post(
        f"{DATA}/discover/reports",
        json={"channelNames": [CARRIER]},
        headers=_auth(client),
    )

    assert r.status_code == 422


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
    assert candidate["reference"] == {
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
        "photos",
        "videos",
        "files",
        "links",
        "telegramChatId",
        "photoUrl",
        "attempts",
        "lastError",
        "checkedAt",
        # Ticket 02. The six stored statistics and the two derived at read.
        "lastPostAt",
        "sampleCount",
        "postsPerWeek",
        "medianViews",
        "forwardShare",
        "script",
        "mediaMix",
        "mediaDensity",
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


def test_a_report_saved_before_the_rename_still_opens(client: TestClient) -> None:
    """A Reference stored under its pre-rename name still reads as a Reference.

    Candidates are frozen into `tg_discover_reports.candidates` as JSON at
    generate time and the response field is required with no default, so a
    report written before the rename would fail validation on every read if the
    stored key were trusted verbatim. Normalising at the read seam rather than
    migrating the JSON is what also covers an old export imported *after* the
    rename, which never passes through a migration at all.
    """
    headers = _auth(client)
    _seed_forward()
    report_id = _report(client, headers)["id"]

    # Written out in full rather than derived from today's candidate, so the
    # fixture keeps saying what the old shape was after this code moves on.
    with Session(engine) as session:
        report = session.get(DiscoverReport, uuid.UUID(report_id))
        assert report is not None
        report.candidates = [
            {
                "name": TARGET,
                "displayName": "Target Two",
                "counts": {"forward": 1, "mention": 0, "link": 0},
                "total": 1,
                "seenIn": [
                    {
                        "channelName": CARRIER,
                        "counts": {"forward": 1, "mention": 0, "link": 0},
                        "total": 1,
                    }
                ],
                "seenInCount": 1,
                "lastSeen": 1000,
                "isFollowed": False,
                "isIgnored": False,
                "samplePost": {
                    "channelName": CARRIER,
                    "postId": 1,
                    "timestamp": 1000,
                },
            }
        ]
        session.add(report)
        session.commit()

    r = client.get(f"{DATA}/discover/reports/{report_id}", headers=headers)
    assert r.status_code == 200, r.text
    candidate = r.json()["candidates"][0]
    assert set(candidate) == CANDIDATE_KEYS | {"probe"}
    assert candidate["reference"] == {
        "channelName": CARRIER,
        "postId": 1,
        "timestamp": 1000,
    }


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
        "photos",
        "videos",
        "files",
        "links",
        "telegramChatId",
        "photoUrl",
        "attempts",
        "lastError",
        "checkedAt",
        # Ticket 02. The six stored statistics and the two derived at read.
        "lastPostAt",
        "sampleCount",
        "postsPerWeek",
        "medianViews",
        "forwardShare",
        "script",
        "mediaMix",
        "mediaDensity",
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
        # Ticket 04. What the probe lane has *spent*, beside what it has left to
        # do: the counts alone say nothing about cost, and the harvest sweep
        # means handles now arrive without anybody asking for them.
        "requestsToday",
        "requestsWeek",
        # Ticket 05 removed the two cursor marks that sat here. The sweep tracks
        # its progress on `Post.harvested`, so there is no position to report,
        # and "how much is left" would be a count over the unharvested index on
        # every read of this dashboard.
        "harvestEnabled",
        "harvestRunning",
    }
