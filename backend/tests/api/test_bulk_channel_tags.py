from __future__ import annotations

from fastapi.testclient import TestClient

from app.core.config import settings

PREFIX = f"{settings.API_V1_STR}/data"


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


def test_bulk_channel_tags_add_mode_merges_tags(client: TestClient) -> None:
    headers = _auth(client)
    client.put(
        f"{PREFIX}/channels/bulk-tag-a",
        json={"name": "bulk-tag-a", "tags": ["Existing"]},
        headers=headers,
    )
    client.put(
        f"{PREFIX}/channels/bulk-tag-b",
        json={"name": "bulk-tag-b", "tags": []},
        headers=headers,
    )

    assigned_at = 1_700_000_000_000
    r = client.patch(
        f"{PREFIX}/channels/bulk-tags",
        json={
            "updates": [
                {
                    "channelId": "bulk-tag-a",
                    "tags": [
                        {"name": "Existing", "source": "manual", "assignedAt": 0},
                        {"name": "Politics", "source": "ai", "assignedAt": assigned_at},
                    ],
                },
                {
                    "channelId": "bulk-tag-b",
                    "tags": [
                        {"name": "Sports", "source": "ai", "assignedAt": assigned_at},
                    ],
                },
            ]
        },
        headers=headers,
    )
    assert r.status_code == 200
    body = r.json()
    assert body["updated"] == 2
    assert len(body["channels"]) == 2

    by_id = {row["id"]: row for row in body["channels"]}
    assert [tag["name"] for tag in by_id["bulk-tag-a"]["tags"]] == [
        "Existing",
        "Politics",
    ]
    assert by_id["bulk-tag-a"]["tags"][1]["source"] == "ai"
    assert by_id["bulk-tag-b"]["tags"] == [
        {"name": "Sports", "source": "ai", "assignedAt": assigned_at},
    ]

    listed = client.get(f"{PREFIX}/channels", headers=headers).json()
    persisted = {row["id"]: row for row in listed if row["id"].startswith("bulk-tag-")}
    assert persisted["bulk-tag-a"]["tags"] == by_id["bulk-tag-a"]["tags"]
    assert persisted["bulk-tag-b"]["tags"] == by_id["bulk-tag-b"]["tags"]


def test_bulk_channel_tags_remove_mode_replaces_tags(client: TestClient) -> None:
    headers = _auth(client)
    client.put(
        f"{PREFIX}/channels/bulk-tag-remove",
        json={
            "name": "bulk-tag-remove",
            "tags": [
                {"name": "Politics", "source": "ai", "assignedAt": 1},
                {"name": "Sports", "source": "manual", "assignedAt": 2},
            ],
        },
        headers=headers,
    )

    r = client.patch(
        f"{PREFIX}/channels/bulk-tags",
        json={
            "updates": [
                {
                    "channelId": "bulk-tag-remove",
                    "tags": [{"name": "Sports", "source": "manual", "assignedAt": 2}],
                }
            ]
        },
        headers=headers,
    )
    assert r.status_code == 200
    tags = r.json()["channels"][0]["tags"]
    assert tags == [{"name": "Sports", "source": "manual", "assignedAt": 2}]


def test_bulk_channel_tags_rejects_missing_channels(client: TestClient) -> None:
    headers = _auth(client)
    r = client.patch(
        f"{PREFIX}/channels/bulk-tags",
        json={
            "updates": [
                {
                    "channelId": "missing-channel-id",
                    "tags": [{"name": "Tech", "source": "ai", "assignedAt": 1}],
                }
            ]
        },
        headers=headers,
    )
    assert r.status_code == 404
    assert "missing-channel-id" in r.json()["detail"]


def test_bulk_channel_tags_rejects_empty_updates(client: TestClient) -> None:
    headers = _auth(client)
    r = client.patch(
        f"{PREFIX}/channels/bulk-tags",
        json={"updates": []},
        headers=headers,
    )
    assert r.status_code == 400
