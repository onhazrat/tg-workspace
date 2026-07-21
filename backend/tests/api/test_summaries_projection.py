"""GET /data/summaries returns a light projection.

Summary `extra` carries `citedPosts` (whole Post objects), `promptText` (a
serialized post corpus) and `chatMessages` (a full conversation). Listing every
summary with those attached re-downloaded all of them on each page load.

The list keeps the small `extra` flags — dropping only the heavy three — because
the history and palette surfaces render them.
"""

from __future__ import annotations

from fastapi.testclient import TestClient

from app.core.config import settings
from app.services.summaries import (
    DEFAULT_SUMMARY_PAGE_SIZE,
    MAX_SUMMARY_PAGE_SIZE,
    SUMMARY_PROMPT_EXCERPT_CHARS,
)

PREFIX = f"{settings.API_V1_STR}/data"
HEAVY = ("citedPosts", "promptText", "chatMessages")


def _auth(client: TestClient) -> dict[str, str]:
    login = client.post(
        f"{settings.API_V1_STR}/login/access-token",
        data={
            "username": settings.FIRST_SUPERUSER,
            "password": settings.FIRST_SUPERUSER_PASSWORD,
        },
    )
    return {"Authorization": f"Bearer {login.json()['access_token']}"}


def _seed(client: TestClient, headers: dict[str, str], count: int = 3) -> None:
    for i in range(count):
        client.put(
            f"{PREFIX}/summaries/sum-{i}",
            json={
                "text": f"summary {i}",
                "channels": ["ch"],
                "startDate": 0,
                "endDate": 100,
                "language": "English",
                "postCount": 5,
                "timestamp": 1000 + i,
                # heavy
                "promptText": "word " * 100,
                "chatMessages": [
                    {"role": "user", "text": "hi"},
                    {"role": "model", "text": "hello"},
                ],
                "citedPosts": {"ch#1": {"id": 1, "channelName": "ch"}},
                # small flags that must survive the projection
                "isStarred": i == 0,
                "note": f"note {i}",
                "autoPublish": True,
            },
            headers=headers,
        )


def test_list_omits_heavy_fields(client: TestClient) -> None:
    headers = _auth(client)
    _seed(client, headers)

    body = client.get(f"{PREFIX}/summaries", headers=headers).json()
    assert body
    for row in body:
        for field in HEAVY:
            assert field not in row, f"{field} leaked into the list projection"


def test_list_keeps_small_extra_flags(client: TestClient) -> None:
    """An allowlist would silently drop these as new flags get added."""
    headers = _auth(client)
    _seed(client, headers)

    row = next(
        r
        for r in client.get(f"{PREFIX}/summaries", headers=headers).json()
        if r["id"] == "sum-0"
    )
    assert row["isStarred"] is True
    assert row["note"] == "note 0"
    assert row["autoPublish"] is True
    assert row["text"] == "summary 0"


def test_list_derives_chat_message_count(client: TestClient) -> None:
    headers = _auth(client)
    _seed(client, headers)

    row = client.get(f"{PREFIX}/summaries", headers=headers).json()[0]
    assert row["chatMessageCount"] == 2


def test_chat_message_count_is_zero_without_chat(client: TestClient) -> None:
    headers = _auth(client)
    client.put(
        f"{PREFIX}/summaries/no-chat",
        json={"text": "t", "channels": [], "timestamp": 1},
        headers=headers,
    )
    row = client.get(f"{PREFIX}/summaries", headers=headers).json()[0]
    assert row["chatMessageCount"] == 0


def test_prompt_excerpt_is_truncated(client: TestClient) -> None:
    headers = _auth(client)
    _seed(client, headers)

    row = client.get(f"{PREFIX}/summaries", headers=headers).json()[0]
    assert len(row["promptExcerpt"]) <= SUMMARY_PROMPT_EXCERPT_CHARS
    assert row["promptExcerpt"].endswith("…")


def test_short_prompt_is_not_truncated(client: TestClient) -> None:
    headers = _auth(client)
    client.put(
        f"{PREFIX}/summaries/short",
        json={"text": "t", "channels": [], "timestamp": 1, "promptText": "hi there"},
        headers=headers,
    )
    row = client.get(f"{PREFIX}/summaries", headers=headers).json()[0]
    assert row["promptExcerpt"] == "hi there"


def test_detail_includes_heavy_fields(client: TestClient) -> None:
    headers = _auth(client)
    _seed(client, headers)

    body = client.get(f"{PREFIX}/summaries/sum-1", headers=headers).json()
    for field in HEAVY:
        assert field in body
    assert len(body["chatMessages"]) == 2
    assert body["citedPosts"]["ch#1"]["id"] == 1


def test_detail_404s_for_unknown_summary(client: TestClient) -> None:
    headers = _auth(client)
    resp = client.get(f"{PREFIX}/summaries/nope", headers=headers)
    assert resp.status_code == 404


def test_list_is_newest_first(client: TestClient) -> None:
    headers = _auth(client)
    _seed(client, headers)

    timestamps = [
        r["timestamp"]
        for r in client.get(f"{PREFIX}/summaries", headers=headers).json()
    ]
    assert timestamps == sorted(timestamps, reverse=True)


def test_list_respects_limit_and_offset(client: TestClient) -> None:
    headers = _auth(client)
    _seed(client, headers, count=6)

    first = client.get(f"{PREFIX}/summaries?limit=2&offset=0", headers=headers).json()
    second = client.get(f"{PREFIX}/summaries?limit=2&offset=2", headers=headers).json()

    assert len(first) == 2
    assert len(second) == 2
    assert {r["id"] for r in first}.isdisjoint({r["id"] for r in second})


def test_default_limit_applies(client: TestClient) -> None:
    headers = _auth(client)
    body = client.get(f"{PREFIX}/summaries", headers=headers).json()
    assert len(body) <= DEFAULT_SUMMARY_PAGE_SIZE


def test_limit_is_bounded(client: TestClient) -> None:
    headers = _auth(client)
    over = client.get(
        f"{PREFIX}/summaries?limit={MAX_SUMMARY_PAGE_SIZE + 1}", headers=headers
    )
    assert over.status_code == 422
    assert (
        client.get(f"{PREFIX}/summaries?offset=-1", headers=headers).status_code == 422
    )


def test_search_matches_prompt_body_without_shipping_it(client: TestClient) -> None:
    """The point of server-side search: prompt bodies stay findable even
    though they are no longer in the list payload."""
    headers = _auth(client)
    client.put(
        f"{PREFIX}/summaries/needle",
        json={
            "text": "unrelated",
            "channels": [],
            "timestamp": 5,
            "promptText": "a corpus containing xyzzy somewhere inside",
        },
        headers=headers,
    )
    client.put(
        f"{PREFIX}/summaries/other",
        json={"text": "nothing here", "channels": [], "timestamp": 6},
        headers=headers,
    )

    body = client.get(f"{PREFIX}/summaries?search=xyzzy", headers=headers).json()
    assert [r["id"] for r in body] == ["needle"]
    assert "promptText" not in body[0]


def test_search_matches_text_channels_model_and_note(client: TestClient) -> None:
    headers = _auth(client)
    client.put(
        f"{PREFIX}/summaries/s1",
        json={
            "text": "alpha body",
            "channels": ["betachannel"],
            "model": "gamma-model",
            "note": "delta note",
            "timestamp": 1,
        },
        headers=headers,
    )

    for term in ("alpha", "betachannel", "gamma", "delta"):
        found = client.get(f"{PREFIX}/summaries?search={term}", headers=headers).json()
        assert [r["id"] for r in found] == ["s1"], f"{term} did not match"


def test_search_is_case_insensitive(client: TestClient) -> None:
    headers = _auth(client)
    client.put(
        f"{PREFIX}/summaries/s1",
        json={"text": "MixedCase Body", "channels": [], "timestamp": 1},
        headers=headers,
    )
    found = client.get(f"{PREFIX}/summaries?search=mixedcase", headers=headers).json()
    assert len(found) == 1


def test_search_does_not_match_cited_post_bodies(client: TestClient) -> None:
    """A blob match on `extra` would over-match relative to the old client
    filter, which never searched citedPosts."""
    headers = _auth(client)
    client.put(
        f"{PREFIX}/summaries/cited",
        json={
            "text": "nothing relevant",
            "channels": [],
            "timestamp": 1,
            "citedPosts": {"ch#1": {"id": 1, "text": "quuxmarker in a cited post"}},
        },
        headers=headers,
    )
    found = client.get(f"{PREFIX}/summaries?search=quuxmarker", headers=headers).json()
    assert found == []


def test_blank_search_returns_everything(client: TestClient) -> None:
    headers = _auth(client)
    _seed(client, headers, count=3)
    assert len(client.get(f"{PREFIX}/summaries?search=", headers=headers).json()) == 3
