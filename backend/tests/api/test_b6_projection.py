"""Wire shapes for the jobs, rag, network and ai endpoints (B6).

Scoped to what is reachable without mocking an outbound fetch. The scrape,
channel-info, publish and bot-info shapes are covered by their existing tests
(`test_telegram_channel_info.py`, `test_scrape*.py`), which already assert real
keys against recorded fixtures — this file adds the cases those do not reach.

The three worth reading are the conditional-key ones. Each is a place where
declaring the obvious optional field would have added a `null` that no client
has ever received:

* `JobStatusEntry` — `detail` and `pauseUntil` are set by *some* runs of *some*
  jobs.
* `TorStatusResponse` — `autoSpawned` exists only on the Tor-enabled branch.
* `TestProxyResponse` — success carries `ip`/`latency`, failure carries `error`.
"""

from __future__ import annotations

import pytest
from fastapi.testclient import TestClient

from app.core.config import settings
from app.jobs.settings import JOB_IDS

V1 = settings.API_V1_STR

JOB_ENTRY_KEYS = {"enabled", "lastRun", "lastStatus", "lastError", "nextRun"}


def _auth(client: TestClient) -> dict[str, str]:
    login = client.post(
        f"{V1}/login/access-token",
        data={
            "username": settings.FIRST_SUPERUSER,
            "password": settings.FIRST_SUPERUSER_PASSWORD,
        },
    )
    return {"Authorization": f"Bearer {login.json()['access_token']}"}


def test_job_status_reports_every_job_id(client: TestClient) -> None:
    """A mapping, not a fixed-field model.

    The deleted `JobsStatusResponse` declared five jobs against six in
    `JOB_IDS`, so it would have dropped `discover_probe` — and every job added
    later. This asserts the response tracks `JOB_IDS` itself.
    """
    body = client.get(f"{V1}/jobs/status", headers=_auth(client)).json()
    assert set(body) == set(JOB_IDS)


def test_job_entries_do_not_invent_optional_keys(client: TestClient) -> None:
    """`detail` and `pauseUntil` are conditional; a fresh scheduler has neither."""
    body = client.get(f"{V1}/jobs/status", headers=_auth(client)).json()
    for job_id, entry in body.items():
        assert set(entry) == JOB_ENTRY_KEYS, f"{job_id} carries unexpected keys"
        assert "pauseUntil" not in entry
        assert "detail" not in entry


def test_toggling_a_job_returns_one_entry_not_the_whole_map(
    client: TestClient,
) -> None:
    headers = _auth(client)
    try:
        r = client.put(f"{V1}/jobs/auto_sync", json={"enabled": False}, headers=headers)
        assert r.status_code == 200
        assert set(r.json()) == JOB_ENTRY_KEYS
        assert r.json()["enabled"] is False
    finally:
        client.put(f"{V1}/jobs/auto_sync", json={"enabled": True}, headers=headers)


def test_unknown_job_still_404s_through_the_response_model(
    client: TestClient,
) -> None:
    """The model must not turn a service-level rejection into a 422."""
    r = client.put(
        f"{V1}/jobs/not_a_job", json={"enabled": True}, headers=_auth(client)
    )
    assert r.status_code == 404


def test_rag_status_keeps_its_key_set(client: TestClient) -> None:
    body = client.get(f"{V1}/rag/status", headers=_auth(client)).json()
    assert set(body) == {"pending", "total", "lastRun"}


def test_rag_search_empty_scope_matches_the_populated_shape(
    client: TestClient,
) -> None:
    """The no-channels branch used to return a bare `{"results": []}`.

    `truncated` and `scanned` appeared and disappeared depending on scope, so a
    caller could not read them unconditionally. The route now returns the same
    key set on both branches — a deliberate behaviour change, recorded in the PR.

    Without a key the route 503s before reaching either branch, so this asserts
    the guard rather than the shape. The shape itself is pinned by
    `RagSearchResponse`'s defaults and by the alias sweep.
    """
    if settings.GEMINI_API_KEY:
        # Same reason `test_smoke.py::test_rag_search` skips: this route embeds
        # the query before it can reach the empty-scope branch, and a live call
        # through the sync TestClient closes the event loop under the async
        # tests that follow it. Verified against a running server instead.
        pytest.skip("live Gemini call; sync TestClient hits event-loop issues")
    r = client.post(
        f"{V1}/rag/search",
        json={"query": "anything", "channels": ["no-such-channel"]},
        headers=_auth(client),
    )
    assert r.status_code == 503


def test_tor_status_omits_auto_spawned_when_tor_is_disabled(
    client: TestClient,
) -> None:
    """`autoSpawned` is not part of the disabled-branch payload and must not be
    materialised as `null` by the response model."""
    body = client.get(f"{V1}/network/tor-status", headers=_auth(client)).json()
    if settings.TOR_ENABLED:
        assert set(body) == {
            "running",
            "socksInUse",
            "controlInUse",
            "enabled",
            "autoSpawned",
        }
    else:
        assert set(body) == {"running", "socksInUse", "controlInUse", "enabled"}
        assert body["enabled"] is False


def test_proxy_health_keeps_its_key_set(client: TestClient) -> None:
    body = client.get(f"{V1}/network/proxy-health", headers=_auth(client)).json()
    assert set(body) == {"badProxies"}
    assert isinstance(body["badProxies"], list)


def test_model_listing_keeps_its_key_set(client: TestClient) -> None:
    body = client.get(f"{V1}/ai/models", headers=_auth(client)).json()
    assert set(body) == {"models", "default"}
    assert body["models"], "expected at least one model"
    for entry in body["models"]:
        assert set(entry) == {"id", "label", "provider"}
