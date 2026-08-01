"""The feed's keyword filter matches what the palette used to do in JS (A1).

Palette post search used to pull every post in the selected date range into the
browser and filter the array. It now sends `keyword` to `POST /data/posts`.

That is only safe because the two predicates are the same one:

    filterPostsByTextQuery   post.text.toLowerCase().includes(q)
                          || post.channelName.toLowerCase().includes(q)

    _keyword_clause          lower(text) LIKE %q%
                          OR lower(channel_name) LIKE %q%

These tests pin that equivalence — substring (not prefix, not word), matching
either field, case-insensitive both ways — plus the ordering and cap the client
used to apply after filtering.
"""

from __future__ import annotations

from typing import Any

from fastapi.testclient import TestClient
from sqlmodel import Session

from app.core.config import settings
from app.core.db import engine
from app.models_tg import Post

PREFIX = f"{settings.API_V1_STR}/data"


def _auth(client: TestClient) -> dict[str, str]:
    login = client.post(
        f"{settings.API_V1_STR}/login/access-token",
        data={
            "username": settings.FIRST_SUPERUSER,
            "password": settings.FIRST_SUPERUSER_PASSWORD,
        },
    )
    return {"Authorization": f"Bearer {login.json()['access_token']}"}


def _seed(rows: list[tuple[str, int, str, int]]) -> None:
    with Session(engine) as session:
        for channel_name, post_id, text, ts in rows:
            session.add(
                Post(
                    channel_name=channel_name,
                    post_id=post_id,
                    text=text,
                    timestamp=ts,
                )
            )
        session.commit()


def _search(
    client: TestClient, headers: dict[str, str], keyword: str, **over: Any
) -> list[dict[str, Any]]:
    body: dict[str, Any] = {
        "channelNames": ["alpha", "beta"],
        "keyword": keyword,
        "sort": "time",
        "limit": 50,
        **over,
    }
    r = client.post(f"{PREFIX}/posts", json=body, headers=headers)
    assert r.status_code == 200, r.text
    return list(r.json())


def test_keyword_matches_post_text_case_insensitively(client: TestClient) -> None:
    headers = _auth(client)
    _seed(
        [
            ("alpha", 1, "The Quick Brown Fox", 1000),
            ("alpha", 2, "nothing relevant here", 2000),
        ]
    )
    ids = {p["id"] for p in _search(client, headers, "quick BROWN")}
    assert ids == {1}


def test_keyword_matches_channel_name_too(client: TestClient) -> None:
    """The client's predicate ORs over `channelName`; so does the SQL."""
    headers = _auth(client)
    _seed([("alpha", 1, "unrelated body", 1000), ("beta", 2, "also unrelated", 2000)])
    ids = {p["id"] for p in _search(client, headers, "alph")}
    assert ids == {1}


def test_keyword_is_a_substring_match_not_a_prefix_or_word_match(
    client: TestClient,
) -> None:
    """`includes()` is substring; `LIKE %q%` must be too.

    A word- or prefix-based server search would look like an improvement and
    would silently return fewer rows than the palette used to.
    """
    headers = _auth(client)
    _seed([("alpha", 1, "supercalifragilistic", 1000)])
    assert {p["id"] for p in _search(client, headers, "califragil")} == {1}


def test_results_come_back_newest_first(client: TestClient) -> None:
    """The client sorted by `timestamp` descending after filtering."""
    headers = _auth(client)
    _seed(
        [
            ("alpha", 1, "match one", 1000),
            ("alpha", 2, "match two", 3000),
            ("alpha", 3, "match three", 2000),
        ]
    )
    ids = [p["id"] for p in _search(client, headers, "match")]
    assert ids == [2, 3, 1]


def test_the_result_cap_is_applied_server_side(client: TestClient) -> None:
    """This is the point of the change: the browser receives at most the cap.

    Before, it received every post in range and sliced afterwards.
    """
    headers = _auth(client)
    _seed([("alpha", i, f"match {i}", 1000 + i) for i in range(1, 61)])
    results = _search(client, headers, "match", limit=50)
    assert len(results) == 50
    # Newest-first, so the cap keeps the newest 50 — same as slicing a
    # descending-sorted array, which is what the client did.
    assert results[0]["id"] == 60


def test_an_empty_channel_list_means_unscoped_at_the_endpoint(
    client: TestClient,
) -> None:
    """Documented endpoint behaviour, and why the palette guards against it.

    `PostScopeRequest.resolved_channel_names()` maps an empty list to `None`,
    meaning "no restriction" — correct for the feed, where an empty selection
    shows everything.

    For *search* that is the wrong default, and the old client path was
    inconsistent about it: its IndexedDB branch looped over the channel list and
    returned nothing, while its server branch omitted `channelNames` and
    returned the whole corpus. `searchPostsForPalette` now returns early on an
    empty selection rather than relying on either.
    """
    headers = _auth(client)
    _seed([("alpha", 1, "match", 1000)])
    assert len(_search(client, headers, "match", channelNames=[])) == 1
