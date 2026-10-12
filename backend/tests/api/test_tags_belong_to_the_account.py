"""A Tag belongs to the Account, not the Follow (ADR-029, DFP-03).

A Tag used to live in a JSON column on the Follow, so unfollowing a Channel
deleted what the Account had said about it. These tests drive the HTTP routes
the Channels tab uses and assert what the list then shows: the move is meant to
change nothing a reader of the tab can see, except that Tags now outlive the
Follow.
"""

from __future__ import annotations

from typing import Any

from fastapi.testclient import TestClient

from app.core.config import settings

DATA = f"{settings.API_V1_STR}/data"


def _listed(client: TestClient, headers: dict[str, str], channel_id: str) -> Any:
    rows = client.get(f"{DATA}/channels", headers=headers).json()
    return next((row for row in rows if row["id"] == channel_id), None)


def test_unfollowing_keeps_the_tags_and_refollowing_shows_them(
    client: TestClient, superuser_token_headers: dict[str, str]
) -> None:
    headers = superuser_token_headers
    tag = {"name": "News", "source": "ai", "assignedAt": 1_700_000_000_000}
    created = client.put(
        f"{DATA}/channels/keep_tags",
        json={"name": "keep_tags", "tags": [tag]},
        headers=headers,
    )
    assert created.status_code == 200, created.text[:300]

    unfollowed = client.delete(f"{DATA}/channels/keep_tags", headers=headers)
    assert unfollowed.status_code == 200, unfollowed.text[:300]
    assert _listed(client, headers, "keep_tags") is None

    refollowed = client.put(
        f"{DATA}/channels/keep_tags", json={"name": "keep_tags"}, headers=headers
    )
    assert refollowed.status_code == 200, refollowed.text[:300]
    assert refollowed.json()["tags"] == [tag]
    assert _listed(client, headers, "keep_tags")["tags"] == [tag]
