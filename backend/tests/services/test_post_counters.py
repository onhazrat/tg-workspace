"""A Post's View count and reaction chips are columns (REACH-01, ADR-024).

The parser still writes them into media; the Post write path is the one place
that lifts them out, and the read path reads the columns and nothing else
(REACH-08). The backfill that emptied the media keys is
`tests/scripts/test_move_post_counters_to_columns.py`; a Directory sample keeps
its counters in media, which `test_directory_samples.py` pins.

## Watched to fail

* stop stripping the keys in `_post_media_from_item` -> the scraped-Post test
* drop `**_counter_fields(...)` from the insert branch -> the scraped-Post test;
  from the update branch -> the re-scrape test
* drop the insert default for `views_observed_at` -> the no-counters test
* restore REACH-01's media fallback in `post_to_camel` -> the leftover-key
  test and the guard; fall back to `retrieved_at` -> the leftover-key test
* read `post["media"]["viewsCount"]` in `prompts/posts.py`, or name
  `MEDIA_COUNTER_KEYS` outside the write path -> the guard
* read `p.media.get("viewsCount")` in `posts.py::lookup_posts` -> the guard,
  because `posts.py` is excused read by read rather than whole (REACH-10)
* delete `views_of` -> the guard's stale-excuse check
* drop a field from `post_to_camel` or `PostResponse` -> the round-trip test
* keep a chip with no integer `count` -> the malformed-chip test
"""

from __future__ import annotations

import ast
from pathlib import Path
from typing import Any

from fastapi.testclient import TestClient
from sqlmodel import Session, select

from app.core.config import settings
from app.core.db import engine
from app.models_tg import Post
from app.schemas.post_media import MEDIA_COUNTER_KEYS
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


def test_a_leftover_media_key_is_ignored(
    client: TestClient, superuser_token_headers: dict[str, str]
) -> None:
    """A `NULL` column answers `null`, whatever media still holds."""
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

    assert post["viewsCount"] is None
    assert post["reactionCounts"] is None
    assert post["viewsObservedAt"] is None


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


APP_DIR = Path(__file__).resolve().parents[2] / "app"

#: Modules that may name a counter key however they like, each with a reason.
COUNTER_KEY_MODULES: dict[str, str] = {
    "services/post_media_parser.py": "the parser writes the keys into media",
    "schemas/post_media.py": "the parser's media shape and the key tuple",
    "schemas/posts.py": "the three columns' wire names on `PostResponse`",
}

#: Single reads anywhere else, keyed by module and the expression that reads.
#: Neither is a Post's media, and each says what it reads instead.
COUNTER_KEY_READS: dict[tuple[str, str], str] = {
    ("services/directory_statistics.py", "post.media.get('viewsCount')"): (
        "a Directory sample keeps its counters in media; it is not a Post"
    ),
    ("prompts/posts.py", "post.get('viewsCount')"): (
        "the top-level field `post_to_camel` builds from the column"
    ),
    # `posts.py` is listed read by read rather than excused whole: it holds the
    # feed and the lookup beside the write path (REACH-10).
    ("services/posts.py", "k not in MEDIA_COUNTER_KEYS"): (
        "`_post_media_from_item` strips the keys from media on write"
    ),
    ("services/posts.py", "media.get('viewsCount')"): (
        "`_counter_fields` lifts a scraped Post's View count out of media"
    ),
    ("services/posts.py", "media.get('reactionCounts')"): (
        "`_counter_fields` lifts a scraped Post's chips out of media"
    ),
    ("services/posts.py", "('viewsCount', 'reactionCounts', 'viewsObservedAt')"): (
        "`_counter_fields` asks whether an import item carries the top-level "
        "fields an export writes; not media"
    ),
    ("services/posts.py", "item.get('viewsCount')"): (
        "`_counter_fields` reads an import item's top-level field; not media"
    ),
    ("services/posts.py", "item.get('reactionCounts')"): (
        "`_counter_fields` reads an import item's top-level field; not media"
    ),
}


def _is_counter_key(node: ast.AST) -> bool:
    if isinstance(node, ast.Name):
        return node.id == "MEDIA_COUNTER_KEYS"
    return (
        isinstance(node, ast.Constant)
        and isinstance(node.value, str)
        and any(key in node.value for key in MEDIA_COUNTER_KEYS)
    )


def _counter_key_reads() -> set[tuple[str, str]]:
    """Every use of a counter key in `app/` that is not a dict literal's key.

    A dict literal's key is a write (`post_to_camel` builds its response that
    way). Anything else is a read: a `.get`, a subscript, a SQL `->>` inside a
    string, or the key tuple itself.
    """
    found: set[tuple[str, str]] = set()
    for path in APP_DIR.rglob("*.py"):
        module = path.relative_to(APP_DIR).as_posix()
        if module.startswith("alembic/") or module in COUNTER_KEY_MODULES:
            continue
        for parent in ast.walk(ast.parse(path.read_text())):
            if isinstance(parent, ast.Expr):
                continue  # a docstring names a key; it reads nothing
            keys = parent.keys if isinstance(parent, ast.Dict) else []
            found.update(
                (module, ast.unparse(parent))
                for node in ast.iter_child_nodes(parent)
                if _is_counter_key(node) and not any(node is k for k in keys)
            )
    return found


def test_nothing_reads_the_counter_keys_from_post_media() -> None:
    """REACH-08: the columns are a Post's only View count and reaction chips.

    REACH-01 read the media keys as a fallback while its backfill ran. The
    backfill has emptied them on staging, so a reader of Post media now finds
    nothing and shows a blank; a new one is refused here rather than found in
    the feed.
    """
    reads = _counter_key_reads()

    assert reads - COUNTER_KEY_READS.keys() == set()
    # Both directions: an excuse nothing needs any more is a leftover.
    assert COUNTER_KEY_READS.keys() - reads == set()
    for module in COUNTER_KEY_MODULES:
        assert (APP_DIR / module).exists(), module
