"""The Discover probe API after orchestration moved server-side (IDEA-011 D9).

The client no longer starts, polls or cancels a sweep — there is no job id to
hold. What is left is one cheap read for the progress display, one mutation for
recheck, and a paged listing.
"""

from __future__ import annotations

from fastapi.testclient import TestClient
from sqlmodel import Session

from app.core.config import settings
from app.core.db import engine
from app.services.discover_probes import enqueue_handles, record_probe_result

DATA = f"{settings.API_V1_STR}/data"

OK_PAGE = {
    "isTelegramPage": True,
    "isUnavailableOnWebView": False,
    "kind": "channel",
    "displayName": "Alpha News",
}
BOT_PAGE = {
    "isTelegramPage": True,
    "isUnavailableOnWebView": True,
    "kind": "bot",
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


def test_the_queue_endpoint_reports_progress_without_a_job_id(
    client: TestClient,
) -> None:
    with Session(engine) as session:
        enqueue_handles(session, ["waiting_one", "waiting_two", "flaky"])
        record_probe_result(session, "flaky", None, error="timeout")
        record_probe_result(session, "alpha_news", OK_PAGE)
        record_probe_result(session, "helper_bot", BOT_PAGE)

    r = client.get(f"{DATA}/discover/probe/queue", headers=_auth(client))
    assert r.status_code == 200
    body = r.json()
    assert body["queued"] == 2
    assert body["retrying"] == 1
    assert body["resolved"] == 1
    assert body["unavailable"] == 1
    # Pause state is the ordinary job toggle, so every tab agrees about it.
    assert body["enabled"] is True
    assert body["running"] is False


def test_the_queue_endpoint_is_empty_on_a_fresh_install(client: TestClient) -> None:
    r = client.get(f"{DATA}/discover/probe/queue", headers=_auth(client))
    assert r.json()["queued"] == 0


def test_pausing_the_probe_job_shows_up_in_the_queue_read(client: TestClient) -> None:
    headers = _auth(client)
    try:
        toggled = client.put(
            f"{settings.API_V1_STR}/jobs/discover_probe",
            json={"enabled": False},
            headers=headers,
        )
        assert toggled.status_code == 200
        body = client.get(f"{DATA}/discover/probe/queue", headers=headers).json()
        assert body["enabled"] is False
    finally:
        client.put(
            f"{settings.API_V1_STR}/jobs/discover_probe",
            json={"enabled": True},
            headers=headers,
        )


def test_recheck_requeues_and_reports_what_it_requeued(client: TestClient) -> None:
    with Session(engine) as session:
        record_probe_result(session, "helper_bot", BOT_PAGE)

    r = client.post(
        f"{DATA}/discover/probe/recheck",
        json={"handles": ["@Helper_Bot"]},
        headers=_auth(client),
    )
    assert r.status_code == 200
    assert r.json() == {"requeued": ["helper_bot"]}


def test_recheck_makes_the_row_pending_again(client: TestClient) -> None:
    headers = _auth(client)
    with Session(engine) as session:
        record_probe_result(session, "helper_bot", BOT_PAGE)

    before = client.get(f"{DATA}/discover/probe/queue", headers=headers).json()
    assert before["unavailable"] == 1
    assert before["queued"] == 0

    client.post(
        f"{DATA}/discover/probe/recheck",
        json={"handles": ["helper_bot"]},
        headers=headers,
    )

    after = client.get(f"{DATA}/discover/probe/queue", headers=headers).json()
    assert after["unavailable"] == 0
    assert after["queued"] == 1


def test_the_probe_listing_is_paged(client: TestClient) -> None:
    with Session(engine) as session:
        for i in range(5):
            record_probe_result(session, f"h{i:02d}", OK_PAGE)

    headers = _auth(client)
    page = client.get(f"{DATA}/discover/probes?limit=2", headers=headers)
    assert [row["handle"] for row in page.json()] == ["h00", "h01"]

    second = client.get(f"{DATA}/discover/probes?limit=2&offset=2", headers=headers)
    assert [row["handle"] for row in second.json()] == ["h02", "h03"]

    # The cap is enforced by the route, not left to the caller.
    assert (
        client.get(f"{DATA}/discover/probes?limit=99999", headers=headers).status_code
        == 422
    )


def test_the_old_job_routes_are_gone(client: TestClient) -> None:
    """Nothing starts, polls or cancels a sweep any more.

    `/discover/probe/{id}` in particular had to go rather than being left to
    404 politely: a client holding a job id was the whole mechanism being
    removed, and an endpoint that still answered would invite rebuilding it.
    """
    headers = _auth(client)
    gone = (
        client.post(f"{DATA}/discover/probe", json={"handles": ["a"]}, headers=headers),
        client.get(f"{DATA}/discover/probe/active", headers=headers),
        client.get(f"{DATA}/discover/probe/some-job-id", headers=headers),
        client.post(f"{DATA}/discover/probe/some-job-id/cancel", headers=headers),
    )
    assert [response.status_code for response in gone] == [404, 404, 404, 404]
