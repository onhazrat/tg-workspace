"""Integration tests for Discover bulk-follow jobs."""

from __future__ import annotations

import asyncio
import json
import time
from unittest.mock import AsyncMock, patch

import pytest
from fastapi.testclient import TestClient
from sqlmodel import Session, select

from app.core.config import settings
from app.core.db import engine
from app.models_tg import Channel, ChannelSettingGroup
from app.services import bulk_follow
from app.services.bulk_follow import (
    clear_follow_jobs_for_tests,
    get_follow_job,
    run_follow_job_by_id,
)
from app.services.follows import get_follow, get_operator_user_id
from app.services.proxy_pool import ProxyWorkerPool
from app.services.scraper_jobs import clear_jobs_for_tests, get_job
from tests.utils.partition import direct_partition

DATA = f"{settings.API_V1_STR}/data"
PREFIX = f"{DATA}/channels/bulk-follow"


#: How wide the Partition is for these tests. Two, so the concurrency
#: assertion below has something to observe.
FAKE_PARTITION_WIDTH = 2


@pytest.fixture(autouse=True)
def _worker(monkeypatch: pytest.MonkeyPatch) -> None:
    """Stand in for the sync worker, which is not running in this process.

    `POST /channels/bulk-follow` used to `asyncio.create_task(run_follow_job)`
    in the API. Ticket 36 moved the runner to the worker (ADR-012 D7) — the
    route publishes a trigger and `bulk_follow._consume_follow_triggers`, which
    only `app/worker.py` starts, picks it up. So in a `TestClient` process
    nothing runs the job, and every test here would poll a `pending` row until
    its timeout.

    Running it from the trigger call rather than restoring the old
    `create_task` keeps the route under test: it still creates the row first
    and still hands off, and what this replaces is only the process boundary.
    `test_the_worker_runs_a_triggered_follow_job` covers the real consumer.
    """
    partition = direct_partition(FAKE_PARTITION_WIDTH)

    async def fake_partition() -> ProxyWorkerPool:
        return partition

    monkeypatch.setattr(bulk_follow, "get_partition", fake_partition)

    async def run_here(follow_job_id: str) -> None:
        task = asyncio.create_task(run_follow_job_by_id(follow_job_id))
        _standin_tasks.add(task)
        task.add_done_callback(_standin_tasks.discard)

    monkeypatch.setattr("app.api.routes.data.channels.request_follow_job_run", run_here)


_standin_tasks: set[asyncio.Task[None]] = set()


def _auth(client: TestClient) -> dict[str, str]:
    login = client.post(
        f"{settings.API_V1_STR}/login/access-token",
        data={
            "username": settings.FIRST_SUPERUSER,
            "password": settings.FIRST_SUPERUSER_PASSWORD,
        },
    )
    token = login.json()["access_token"]
    return {"Authorization": f"Bearer {token}"}


def _info(
    name: str,
    *,
    unavailable: bool = False,
    display: str | None = None,
) -> dict:
    return {
        "channelName": name,
        "displayName": display or name.title(),
        "photoUrl": f"https://example.com/{name}.jpg",
        "isUnavailableOnWebView": unavailable,
        "telemetry": {
            "success": True,
            "totalDuration": 50,
            "attempts": [{"proxyUrl": "direct", "success": True}],
        },
    }


def _wait_follow_done(
    client: TestClient, headers: dict[str, str], job_id: str, *, timeout_s: float = 10
) -> dict:
    deadline = time.time() + timeout_s
    while time.time() < deadline:
        r = client.get(f"{PREFIX}/{job_id}", headers=headers)
        assert r.status_code == 200
        data = r.json()
        if data["status"] in ("completed", "failed", "cancelled"):
            return data
        time.sleep(0.05)
    raise AssertionError(f"Follow job {job_id} did not finish in time")


def test_bulk_follow_mixed_results_and_discovered_via(client: TestClient) -> None:
    clear_follow_jobs_for_tests()
    clear_jobs_for_tests()
    headers = _auth(client)

    client.put(
        f"{DATA}/channels/already-followed",
        json={"name": "already-followed", "displayName": "Already"},
        headers=headers,
    )

    async def fake_info(channel_name: str, **_kwargs):
        if channel_name == "new-ok":
            return _info("new-ok", display="New OK")
        if channel_name == "new-restricted":
            return _info("new-restricted", unavailable=True)
        if channel_name == "broken":
            raise RuntimeError("scrape boom")
        return _info(channel_name)

    from app.services.scraper_jobs import create_job as real_create_job

    created_sync_modes: list[str] = []

    async def spy_create_job(**kwargs):
        created_sync_modes.append(kwargs.get("sync_mode", "auto"))
        return await real_create_job(**kwargs)

    with (
        patch(
            "app.services.bulk_follow.get_channel_info",
            new_callable=AsyncMock,
            side_effect=fake_info,
        ),
        patch(
            "app.services.scraper_jobs.create_job",
            side_effect=spy_create_job,
        ),
        patch(
            "app.services.sync_orchestrator.scrape_channel_page",
            new_callable=AsyncMock,
            return_value={
                "channelName": "new-ok",
                "displayName": "New OK",
                "photoUrl": None,
                "bio": "",
                "subscribers": "1",
                "posts": [],
                "latestId": 0,
                "nextBeforeId": None,
                "telemetry": {"success": True, "totalDuration": 1, "attempts": []},
            },
        ),
    ):
        r = client.post(
            PREFIX,
            json={
                "channels": [
                    {
                        "name": "@new-ok",
                        "discoveredVia": {
                            "channelName": "source-ch",
                            "postId": 42,
                            "timestamp": 1_700_000_000_000,
                        },
                    },
                    {"name": "already-followed"},
                    {"name": "new-restricted"},
                    {"name": "broken"},
                    {"name": "@new-ok"},  # dedupe
                ]
            },
            headers=headers,
        )
        assert r.status_code == 200
        job_id = r.json()["followJobId"]
        assert job_id

        final = _wait_follow_done(client, headers, job_id)
        assert final["status"] == "completed"
        assert final["total"] == 4
        assert final["added"] == 1
        assert final["skipped"] == 1
        assert final["unavailable"] == 1
        assert final["failed"] == 1
        assert final["syncJobId"]
        assert created_sync_modes == ["bulk"]

        by_name = {row["name"]: row for row in final["results"]}
        assert by_name["new-ok"]["status"] == "added"
        assert by_name["already-followed"]["status"] == "skipped"
        assert by_name["already-followed"]["reason"] == "already_followed"
        assert by_name["new-restricted"]["status"] == "unavailable"
        assert by_name["broken"]["status"] == "error"
        assert "boom" in (by_name["broken"].get("error") or "")

        sync_job = get_job(final["syncJobId"])
        assert sync_job is not None
        assert set(sync_job.channels.keys()) == {"new-ok"}

    with Session(engine) as session:
        operator_id = get_operator_user_id(session)
        assert operator_id is not None
        ok = session.get(Channel, "new-ok")
        assert ok is not None
        # Ticket 22: provenance, the follow timestamp and the setting group all
        # live on the follow now. How *you* came to follow a handle is yours —
        # on the Channel it reported one account's discovery for everybody.
        ok_follow = get_follow(session, user_id=operator_id, channel_id="new-ok")
        assert ok_follow is not None
        assert ok_follow.discovered_via == {
            "channelName": "source-ch",
            "postId": 42,
            "timestamp": 1_700_000_000_000,
        }
        assert ok_follow.followed_at is not None
        default_group = session.exec(
            select(ChannelSettingGroup).where(
                ChannelSettingGroup.id == ok_follow.setting_group_id
            )
        ).first()
        assert default_group is not None
        assert default_group.is_unavailable_on_web_view is False

        restricted = session.get(Channel, "new-restricted")
        assert restricted is not None
        restricted_follow = get_follow(
            session, user_id=operator_id, channel_id="new-restricted"
        )
        assert restricted_follow is not None
        group = session.exec(
            select(ChannelSettingGroup).where(
                ChannelSettingGroup.id == restricted_follow.setting_group_id
            )
        ).first()
        assert group is not None
        assert group.is_unavailable_on_web_view is True

        assert session.get(Channel, "broken") is None

    client.delete(f"{DATA}/channels/already-followed", headers=headers)
    client.delete(f"{DATA}/channels/new-ok", headers=headers)
    client.delete(f"{DATA}/channels/new-restricted", headers=headers)
    clear_follow_jobs_for_tests()
    clear_jobs_for_tests()


def test_bulk_follow_no_sync_when_only_skipped_or_unavailable(
    client: TestClient,
) -> None:
    clear_follow_jobs_for_tests()
    clear_jobs_for_tests()
    headers = _auth(client)

    client.put(
        f"{DATA}/channels/skip-me",
        json={"name": "skip-me", "displayName": "Skip"},
        headers=headers,
    )

    with patch(
        "app.services.bulk_follow.get_channel_info",
        new_callable=AsyncMock,
        return_value=_info("only-restricted", unavailable=True),
    ):
        r = client.post(
            PREFIX,
            json={
                "channels": [
                    {"name": "skip-me"},
                    {"name": "only-restricted"},
                ]
            },
            headers=headers,
        )
        job_id = r.json()["followJobId"]
        final = _wait_follow_done(client, headers, job_id)
        assert final["status"] == "completed"
        assert final["added"] == 0
        assert final["syncJobId"] is None

    client.delete(f"{DATA}/channels/skip-me", headers=headers)
    client.delete(f"{DATA}/channels/only-restricted", headers=headers)
    clear_follow_jobs_for_tests()
    clear_jobs_for_tests()


def test_bulk_follow_sse_events(client: TestClient) -> None:
    clear_follow_jobs_for_tests()
    clear_jobs_for_tests()
    headers = _auth(client)

    with (
        patch(
            "app.services.bulk_follow.get_channel_info",
            new_callable=AsyncMock,
            return_value=_info("sse-follow"),
        ),
        patch(
            "app.services.sync_orchestrator.scrape_channel_page",
            new_callable=AsyncMock,
            return_value={
                "channelName": "sse-follow",
                "displayName": "SSE",
                "photoUrl": None,
                "bio": "",
                "subscribers": "1",
                "posts": [],
                "latestId": 0,
                "nextBeforeId": None,
                "telemetry": {"success": True, "totalDuration": 1, "attempts": []},
            },
        ),
    ):
        r = client.post(
            PREFIX,
            json={"channels": [{"name": "sse-follow"}]},
            headers=headers,
        )
        job_id = r.json()["followJobId"]

        events: list[dict] = []
        with client.stream(
            "GET", f"{PREFIX}/{job_id}/events", headers=headers
        ) as stream_r:
            assert stream_r.status_code == 200
            assert "text/event-stream" in stream_r.headers.get("content-type", "")
            for line in stream_r.iter_lines():
                if not line.startswith("data: "):
                    continue
                payload = line.removeprefix("data: ")
                if payload == "[DONE]":
                    break
                events.append(json.loads(payload))

        assert len(events) >= 1
        assert events[0]["followJobId"] == job_id
        assert events[-1]["status"] == "completed"
        assert events[-1]["results"][0]["status"] == "added"
        assert events[-1]["syncJobId"]

    client.delete(f"{DATA}/channels/sse-follow", headers=headers)
    clear_follow_jobs_for_tests()
    clear_jobs_for_tests()


def test_bulk_follow_cancel(client: TestClient) -> None:
    clear_follow_jobs_for_tests()
    clear_jobs_for_tests()
    headers = _auth(client)

    async def slow_info(*_args, **_kwargs):
        await asyncio.sleep(5)
        return _info("cancel-follow")

    with patch(
        "app.services.bulk_follow.get_channel_info",
        new_callable=AsyncMock,
        side_effect=slow_info,
    ):
        r = client.post(
            PREFIX,
            json={"channels": [{"name": "cancel-follow"}]},
            headers=headers,
        )
        job_id = r.json()["followJobId"]

        cancel_r = client.post(f"{PREFIX}/{job_id}/cancel", headers=headers)
        assert cancel_r.status_code == 200
        assert cancel_r.json()["status"] == "cancelled"

        job = get_follow_job(job_id)
        assert job is not None
        assert job.cancel_event.is_set()

    clear_follow_jobs_for_tests()
    clear_jobs_for_tests()


def test_bulk_follow_not_found(client: TestClient) -> None:
    headers = _auth(client)
    r = client.get(f"{PREFIX}/does-not-exist", headers=headers)
    assert r.status_code == 404


def test_bulk_follow_empty_rejected(client: TestClient) -> None:
    headers = _auth(client)
    r = client.post(PREFIX, json={"channels": []}, headers=headers)
    assert r.status_code == 400


def test_bulk_follow_concurrency_bound(client: TestClient) -> None:
    clear_follow_jobs_for_tests()
    clear_jobs_for_tests()
    headers = _auth(client)

    in_flight = 0
    max_in_flight = 0
    lock = asyncio.Lock()

    async def tracked_info(channel_name: str, **_kwargs):
        nonlocal in_flight, max_in_flight
        async with lock:
            in_flight += 1
            max_in_flight = max(max_in_flight, in_flight)
        await asyncio.sleep(0.15)
        async with lock:
            in_flight -= 1
        return _info(channel_name)

    names = [f"conc-{i}" for i in range(FAKE_PARTITION_WIDTH + 3)]

    with (
        patch(
            "app.services.bulk_follow.get_channel_info",
            new_callable=AsyncMock,
            side_effect=tracked_info,
        ),
        patch(
            "app.services.sync_orchestrator.run_sync_job",
            new_callable=AsyncMock,
        ),
    ):
        r = client.post(
            PREFIX,
            json={"channels": [{"name": n} for n in names]},
            headers=headers,
        )
        job_id = r.json()["followJobId"]
        final = _wait_follow_done(client, headers, job_id, timeout_s=15)
        assert final["status"] == "completed"
        assert final["added"] == len(names)
        # The Partition's width, not a semaphore of the job's own: the probe
        # phase takes Slots since ADR-012, so this is the same number that
        # bounds every other kind of scraping in the process.
        assert max_in_flight <= FAKE_PARTITION_WIDTH
        assert max_in_flight >= 1

    for name in names:
        client.delete(f"{DATA}/channels/{name}", headers=headers)
    clear_follow_jobs_for_tests()
    clear_jobs_for_tests()


def test_bulk_follow_error_isolation(client: TestClient) -> None:
    clear_follow_jobs_for_tests()
    clear_jobs_for_tests()
    headers = _auth(client)

    async def mixed(channel_name: str, **_kwargs):
        if channel_name == "bad-one":
            raise RuntimeError("isolated failure")
        return _info(channel_name)

    with (
        patch(
            "app.services.bulk_follow.get_channel_info",
            new_callable=AsyncMock,
            side_effect=mixed,
        ),
        patch(
            "app.services.sync_orchestrator.run_sync_job",
            new_callable=AsyncMock,
        ),
    ):
        r = client.post(
            PREFIX,
            json={
                "channels": [
                    {"name": "good-one"},
                    {"name": "bad-one"},
                    {"name": "good-two"},
                ]
            },
            headers=headers,
        )
        final = _wait_follow_done(client, headers, r.json()["followJobId"])
        assert final["added"] == 2
        assert final["failed"] == 1
        assert final["syncJobId"]

    client.delete(f"{DATA}/channels/good-one", headers=headers)
    client.delete(f"{DATA}/channels/good-two", headers=headers)
    clear_follow_jobs_for_tests()
    clear_jobs_for_tests()
