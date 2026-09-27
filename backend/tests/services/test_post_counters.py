"""A Post's View count and reaction chips are columns (REACH-01, ADR-024).

The parser still writes them into media; the Post write path is the one place
that lifts them out, and the read path falls back to the media keys for a Post
the backfill script has not reached. The script is
`tests/scripts/test_move_post_counters_to_columns.py`; a Directory sample keeps
its counters in media, which `test_directory_samples.py` pins.

## Watched to fail

* stop stripping the keys in `_post_media_from_item` -> the scraped-Post test
* drop `**_counter_fields(...)` from the insert branch -> the scraped-Post test;
  from the update branch -> the re-scrape test
* drop the insert default for `views_observed_at` -> the no-counters test
* drop the media fallback in `_post_counters` -> the legacy-row test
* drop a field from `post_to_camel` or `PostResponse` -> the round-trip test
* keep a chip with no integer `count` -> the malformed-chip test
"""

from __future__ import annotations

from typing import Any

from fastapi.testclient import TestClient
from sqlmodel import Session, select

from app.core.config import settings
from app.core.db import engine
from app.models_tg import Post
from app.services.posts import bulk_upsert_posts_impl
from app.services.sync_orchestrator import _posts_to_save

CHANNEL = "counterchan"
PREFIX = f"{settings.API_V1_STR}/data"
CHIPS = [
    {"emoji": "👍", "count": 12},
    {"customEmojiId": "5368324170671202286", "count": 3},
    {"count": 40, "isPaid": True},
]


def _scraped(media: dict[str, Any] | None, post_id: int = 9) -> dict[str, Any]:
    """One Post as the scrape path hands it to the upsert."""
    parsed = {
        "id": post_id,
        "text": "hello",
        "date": "2026-09-27T00:00:00+00:00",
        "timestamp": 1_790_000_000_000,
        "media": media,
    }
    return _posts_to_save(CHANNEL, [parsed])[0]


def _upsert(item: dict[str, Any]) -> dict[str, Any]:
    with Session(engine) as session:
        bulk_upsert_posts_impl([item], session)
        session.commit()
        row = session.exec(select(Post).where(Post.channel_name == CHANNEL)).one()
        return row.model_dump()


def _lookup(client: TestClient, headers: dict[str, str]) -> dict[str, Any]:
    looked_up = client.post(
        f"{PREFIX}/posts/lookup",
        json={"posts": [{"channelName": CHANNEL, "postId": 9}]},
        headers=headers,
    )
    assert looked_up.status_code == 200, looked_up.text
    body: dict[str, Any] = looked_up.json()[0]
    return body


def test_a_scraped_post_stores_its_counters_as_columns() -> None:
    row = _upsert(
        _scraped(
            {
                "kinds": ["photo"],
                "viewsCount": 9_700,
                "reactionCounts": CHIPS,
                "reactionsCount": 55,
            }
        )
    )

    assert row["views_count"] == 9_700
    # The Stars chip stays its own chip, flagged, never folded into emoji.
    assert row["reaction_counts"] == CHIPS
    assert row["views_observed_at"] == row["retrieved_at"]
    # Neither counter nor the total is stored in media any more.
    assert row["media"] == {"kinds": ["photo"]}


def test_a_post_the_page_showed_no_counters_for_is_still_observed() -> None:
    row = _upsert(_scraped(None))

    assert row["views_count"] is None
    assert row["reaction_counts"] is None
    assert row["views_observed_at"] == row["retrieved_at"]


def test_a_rescrape_replaces_the_counters() -> None:
    _upsert(_scraped({"kinds": [], "viewsCount": 100}))
    row = _upsert(_scraped({"kinds": [], "viewsCount": 250, "reactionCounts": CHIPS}))

    assert row["views_count"] == 250
    assert row["reaction_counts"] == CHIPS
    assert row["media"] == {"kinds": []}


def test_a_malformed_chip_is_dropped_on_write() -> None:
    """Import takes any JSON, and `PostResponse` declares `count` on a chip, so
    one bad chip kept here would 500 every read of a Post every Follower
    shares."""
    item = {
        **_scraped(None),
        "viewsCount": 5,
        "reactionCounts": [{"emoji": "🔥"}, {"count": True}, "x", *CHIPS],
    }

    assert _upsert(item)["reaction_counts"] == CHIPS


def test_a_legacy_row_answers_from_its_media_until_the_backfill_runs(
    client: TestClient, superuser_token_headers: dict[str, str]
) -> None:
    with Session(engine) as session:
        session.add(
            Post(
                channel_name=CHANNEL,
                post_id=9,
                text="old",
                retrieved_at=1_700_000_000_000,
                media={
                    "kinds": ["photo"],
                    "viewsCount": 3_860,
                    "reactionCounts": CHIPS,
                    "reactionsCount": 55,
                },
            )
        )
        session.commit()
    client.post(
        f"{PREFIX}/import",
        json={"data": {"channels": [{"id": CHANNEL, "name": CHANNEL}]}},
        headers=superuser_token_headers,
    )

    post = _lookup(client, superuser_token_headers)

    assert post["viewsCount"] == 3_860
    assert post["reactionCounts"] == CHIPS
    assert post["viewsObservedAt"] == 1_700_000_000_000
    assert post["media"] == {"kinds": ["photo"]}


def test_a_post_with_no_counters_anywhere_answers_null(
    client: TestClient, superuser_token_headers: dict[str, str]
) -> None:
    client.post(
        f"{PREFIX}/import",
        json={"data": {"channels": [{"id": CHANNEL, "name": CHANNEL}]}},
        headers=superuser_token_headers,
    )
    with Session(engine) as session:
        session.add(Post(channel_name=CHANNEL, post_id=9, text="old", media=None))
        session.commit()

    post = _lookup(client, superuser_token_headers)

    assert post["viewsCount"] is None
    assert post["reactionCounts"] is None
    assert post["viewsObservedAt"] is None


def test_counters_travel_through_import_the_api_and_export(
    client: TestClient, superuser_token_headers: dict[str, str]
) -> None:
    post = {
        "id": 9,
        "channelName": CHANNEL,
        "text": "hello",
        "date": "2026-09-01T00:00:00+00:00",
        "timestamp": 1_788_000_000_000,
        "media": {"kinds": ["photo"]},
        "viewsCount": 1_200,
        "reactionCounts": CHIPS,
        "viewsObservedAt": 1_788_000_600_000,
    }
    imported = client.post(
        f"{PREFIX}/import",
        json={
            "data": {"channels": [{"id": CHANNEL, "name": CHANNEL}], "posts": [post]}
        },
        headers=superuser_token_headers,
    )
    assert imported.status_code == 200, imported.text
    counters = {k: post[k] for k in ("viewsCount", "reactionCounts", "viewsObservedAt")}

    looked_up = _lookup(client, superuser_token_headers)
    assert {k: looked_up[k] for k in counters} == counters

    exported = client.get(f"{PREFIX}/export", headers=superuser_token_headers)
    row = next(p for p in exported.json()["data"]["posts"] if p["id"] == 9)
    assert {k: row[k] for k in counters} == counters
    assert row["media"] == {"kinds": ["photo"]}
