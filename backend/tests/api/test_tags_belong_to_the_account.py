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


def test_a_tag_run_still_tags_only_followed_channels(
    client: TestClient, superuser_token_headers: dict[str, str]
) -> None:
    """Tag runs apply through the bulk route, which refuses an unfollowed Channel.

    ADR-029 leaves AI-tagging unfollowed Channels to its own decision, because
    it would spend the Account's AI Key on Channels it does not follow.
    """
    headers = superuser_token_headers
    client.put(
        f"{DATA}/channels/run_scope", json={"name": "run_scope"}, headers=headers
    )
    client.delete(f"{DATA}/channels/run_scope", headers=headers)

    refused = client.patch(
        f"{DATA}/channels/bulk-tags",
        json={
            "updates": [
                {
                    "channelId": "run_scope",
                    "tags": [{"name": "Ai", "source": "ai", "assignedAt": 1}],
                }
            ]
        },
        headers=headers,
    )
    assert refused.status_code == 404

    client.put(
        f"{DATA}/channels/run_scope", json={"name": "run_scope"}, headers=headers
    )
    assert _listed(client, headers, "run_scope")["tags"] == []


def test_case_never_splits_a_tag_and_the_first_spelling_wins(
    client: TestClient, superuser_token_headers: dict[str, str]
) -> None:
    headers = superuser_token_headers
    response = client.put(
        f"{DATA}/channels/case_tags",
        json={"name": "case_tags", "tags": [" News ", "news", "NEWS"]},
        headers=headers,
    )
    assert response.status_code == 200, response.text[:300]
    assert [t["name"] for t in response.json()["tags"]] == ["News"]


def test_group_names_stay_reserved_on_every_write(
    client: TestClient, superuser_token_headers: dict[str, str]
) -> None:
    """`group:` Tags are derived from Setting groups and never stored."""
    headers = superuser_token_headers
    client.put(
        f"{DATA}/channels/group_tags",
        json={"name": "group_tags", "tags": ["kept"]},
        headers=headers,
    )
    reserved = {"name": "group:Daily", "source": "manual", "assignedAt": 1}

    put = client.put(
        f"{DATA}/channels/group_tags", json={"tags": [reserved]}, headers=headers
    )
    bulk = client.patch(
        f"{DATA}/channels/bulk-tags",
        json={"updates": [{"channelId": "group_tags", "tags": [reserved]}]},
        headers=headers,
    )
    imported = client.post(
        f"{DATA}/import",
        json={"tags": [{"handle": "group_tags", **reserved}]},
        headers=headers,
    )

    assert (put.status_code, bulk.status_code, imported.status_code) == (400, 400, 400)
    tags = _listed(client, headers, "group_tags")["tags"]
    assert [t["name"] for t in tags] == ["kept"]
