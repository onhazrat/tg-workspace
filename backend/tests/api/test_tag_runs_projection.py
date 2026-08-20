"""GET /data/tag-runs returns a light projection.

Each TagRun carries `promptText` — a full serialized post corpus. Listing every
run with that field attached re-downloaded every historical prompt on each page
load, tens of MB. The list is metadata only; heavy fields come from the detail
endpoint.
"""

from __future__ import annotations

from fastapi.testclient import TestClient

from app.core.config import settings
from app.services.tag_runs import DEFAULT_TAG_RUN_PAGE_SIZE, MAX_TAG_RUN_PAGE_SIZE

PREFIX = f"{settings.API_V1_STR}/data"

HEAVY_FIELDS = ("promptText", "responseText", "suggestions", "allTagsSnapshot")


def _auth(client: TestClient) -> dict[str, str]:
    login = client.post(
        f"{settings.API_V1_STR}/login/access-token",
        data={
            "username": settings.FIRST_SUPERUSER,
            "password": settings.FIRST_SUPERUSER_PASSWORD,
        },
    )
    return {"Authorization": f"Bearer {login.json()['access_token']}"}


def _seed(client: TestClient, headers: dict[str, str], count: int = 4) -> None:
    for i in range(count):
        client.put(
            f"{PREFIX}/tag-runs/run-{i}",
            json={
                "status": "complete",
                "source": "generated",
                "mode": "add",
                "channels": ["ch"],
                "postCount": 10,
                "model": "test-model",
                "promptText": f"corpus-{i}" * 100,
                "responseText": f"response-{i}",
                "suggestions": {"ch": ["tag"]},
                "allTagsSnapshot": ["tag"],
                "createdAt": 1000 + i,
            },
            headers=headers,
        )


def test_list_omits_heavy_fields(client: TestClient) -> None:
    headers = _auth(client)
    _seed(client, headers)

    body = client.get(f"{PREFIX}/tag-runs", headers=headers).json()
    assert body, "expected seeded runs"
    for row in body:
        for field in HEAVY_FIELDS:
            assert field not in row, f"{field} leaked into the list projection"


def test_list_keeps_metadata_fields(client: TestClient) -> None:
    headers = _auth(client)
    _seed(client, headers)

    row = client.get(f"{PREFIX}/tag-runs", headers=headers).json()[0]
    for field in ("id", "createdAt", "status", "source", "mode", "postCount"):
        assert field in row


def test_detail_includes_heavy_fields(client: TestClient) -> None:
    headers = _auth(client)
    _seed(client, headers)

    body = client.get(f"{PREFIX}/tag-runs/run-1", headers=headers).json()
    for field in HEAVY_FIELDS:
        assert field in body
    assert body["responseText"] == "response-1"


def test_detail_404s_for_unknown_run(client: TestClient) -> None:
    headers = _auth(client)
    resp = client.get(f"{PREFIX}/tag-runs/does-not-exist", headers=headers)
    assert resp.status_code == 404


def test_list_is_newest_first(client: TestClient) -> None:
    headers = _auth(client)
    _seed(client, headers)

    body = client.get(f"{PREFIX}/tag-runs", headers=headers).json()
    created = [r["createdAt"] for r in body]
    assert created == sorted(created, reverse=True)


def test_list_respects_limit_and_offset(client: TestClient) -> None:
    headers = _auth(client)
    _seed(client, headers, count=6)

    first = client.get(f"{PREFIX}/tag-runs?limit=2&offset=0", headers=headers).json()
    second = client.get(f"{PREFIX}/tag-runs?limit=2&offset=2", headers=headers).json()

    assert len(first) == 2
    assert len(second) == 2
    assert {r["id"] for r in first}.isdisjoint({r["id"] for r in second})


def test_default_limit_applies(client: TestClient) -> None:
    headers = _auth(client)
    body = client.get(f"{PREFIX}/tag-runs", headers=headers).json()
    assert len(body) <= DEFAULT_TAG_RUN_PAGE_SIZE


def test_limit_is_bounded(client: TestClient) -> None:
    headers = _auth(client)
    over = client.get(
        f"{PREFIX}/tag-runs?limit={MAX_TAG_RUN_PAGE_SIZE + 1}", headers=headers
    )
    assert over.status_code == 422
    assert (
        client.get(f"{PREFIX}/tag-runs?offset=-1", headers=headers).status_code == 422
    )


def test_star_and_note_survive_the_response_model(client: TestClient) -> None:
    """The route must not drop what the service returns.

    `isStarred` and `note` live in `TagRun.extra` server-side, and a response
    model that neither declares them nor allows extras discards them silently:
    the service hands them over, Pydantic throws them away, and the only symptom
    is a star that never sticks. That is what happened here — caught by
    `client-split.conform.ts` rather than by any test, which is why this one
    exists.

    They are declared rather than allowed through an open model because
    `frontend/src/types.ts` derives `TagRun` from this schema, and `Omit<>` over
    a top-level index signature collapses every field to `unknown`.
    """
    headers = _auth(client)
    client.put(
        f"{PREFIX}/tag-runs/run-starred",
        json={"channels": ["ch"], "isStarred": True, "note": "worth keeping"},
        headers=headers,
    )

    listed = client.get(f"{PREFIX}/tag-runs", headers=headers).json()
    row = next(r for r in listed if r["id"] == "run-starred")

    assert row["isStarred"] is True
    assert row["note"] == "worth keeping"

    detail = client.get(f"{PREFIX}/tag-runs/run-starred", headers=headers).json()
    assert detail["isStarred"] is True


def test_an_unstarred_run_reports_false_not_null(client: TestClient) -> None:
    """A declared boolean defaults; it does not arrive as `null`."""
    headers = _auth(client)
    client.put(
        f"{PREFIX}/tag-runs/run-plain",
        json={"channels": ["ch"]},
        headers=headers,
    )

    listed = client.get(f"{PREFIX}/tag-runs", headers=headers).json()
    row = next(r for r in listed if r["id"] == "run-plain")

    assert row["isStarred"] is False
    assert row["note"] is None
