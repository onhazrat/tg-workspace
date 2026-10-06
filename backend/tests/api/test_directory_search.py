"""Searching the Directory over HTTP (DIR-04, ADR-027).

`POST /data/directory/list` with a `search` finds Channels by words in their
name, bio and recent Posts. The corpus below is written through the real write
path, a recorded probe result per entry, so a writer that forgot the search
index fails here rather than in a test that inserted index rows itself.

| entry          | Language | name                | bio                   | Posts say                                   | subscribers |
|----------------|----------|---------------------|-----------------------|---------------------------------------------|-------------|
| ds_ru          | ru       | Russkiy Dnevnik     |                       | "... новостей о политике ..."               | 5000        |
| ds_fa          | fa       | Kucheh              |                       | "کتاب\u200cهای ... ملی ..." (Persian ک, ی, ZWNJ)  | 5000        |
| ds_zh          | zh       | Zhongwen            |                       | "...电报频道发布了很多科技新闻..."            | 5000        |
| ds_typo        | en       | Telegraphist Weekly |                       | English filler                              | 5000        |
| ds_name        | en       | Blockchain Corner   |                       | English filler                              | 5000        |
| ds_bio         | en       | Bio Only            | "all about blockchain"| English filler                              | 5000        |
| ds_posts       | en       | Posts Only          |                       | "... blockchain ..."                        | 5000        |
| ds_sky_wide    | en       | Sky Big             |                       | "... quasar ..."                            | 1000000     |
| ds_sky_small   | en       | Sky Small           |                       | "... quasar ..."                            | 100         |
| ds_long        | en       | Long                |                       | 700 characters, "nebula" in the middle      | 5000        |

## Watched to fail

Each mutation was applied alone and this module went red:

* drop the keheh fold, or the yeh fold -> the Persian letter-variant cases
* keep the zero-width non-joiner -> the Persian compound case
* index a CJK run whole (no pairs) -> the Chinese cases
* no prefix, a prefix on every word, a prefix below three characters -> the
  prefix cases, one each
* keep a word one configuration drops as a stop word -> "the quasar"
* drop such a word under every configuration, or read the relaxed query for
  rows of any configuration -> "only" plus a Persian word
* drop the trigram match -> the typo case; run it on every field -> the typo
  case and the bio and Posts field limits
* drop the weight labels -> the field limits
* rank without the log of subscribers -> the relevance order
* leave the search out of the totals and the page -> almost everything
* quote matches without `showMatches` -> the switch-off case
* cut snippets from the folded text -> the snippet cases
* mark overlapping pairs separately -> the Chinese snippet
"""

from __future__ import annotations

import time
from collections.abc import Iterator
from typing import Any

import pytest
from fastapi.testclient import TestClient
from sqlmodel import Session

from app.core.config import settings
from app.core.db import engine
from app.services import directory_reads
from app.services.channel_directory import record_probe_result
from tests.utils.utils import get_superuser_token_headers

DIRECTORY = f"{settings.API_V1_STR}/data/directory"
DAY = 24 * 3_600_000

EN = "The weather was calm today and the market opened quietly in the morning"
RU = "Сегодня в мире много важных новостей о политике и экономике страны"
#: Persian keheh (ک) and Persian yeh (ی), and a zero-width non-joiner in کتاب\u200cهای.
FA = "کتاب\u200cهای جدید درباره تاریخ ایران در کتابخانه ملی منتشر شد"
ZH = "今天电报频道发布了很多科技新闻和市场分析报告"
LONG = ". ".join([EN] * 5)

#: handle -> (display name, bio, Post text, subscribers)
ENTRIES: dict[str, tuple[str, str | None, str, int]] = {
    "ds_ru": ("Russkiy Dnevnik", None, RU, 5000),
    "ds_fa": ("Kucheh", None, FA, 5000),
    "ds_zh": ("Zhongwen", None, ZH, 5000),
    "ds_typo": ("Telegraphist Weekly", None, EN, 5000),
    "ds_name": ("Blockchain Corner", None, EN, 5000),
    "ds_bio": ("Bio Only", "All about blockchain, every day", EN, 5000),
    "ds_posts": ("Posts Only", None, f"{EN}. Then blockchain news arrived", 5000),
    "ds_sky_wide": ("Sky Big", None, f"{EN}. A quasar was seen", 1_000_000),
    "ds_sky_small": ("Sky Small", None, f"{EN}. A quasar was seen", 100),
    "ds_long": ("Long", None, f"{LONG}. A nebula glowed. {LONG}", 5000),
}


def probe_page(
    handle: str, name: str, bio: str | None, words: str, subscribers: int
) -> dict[str, Any]:
    """A parsed Telegram page with three sample Posts saying `words`."""
    now = int(time.time() * 1000)
    return {
        "isTelegramPage": True,
        "kind": "channel",
        "displayName": name,
        "bio": bio,
        "subscribers": subscribers,
        "samples": [
            {
                "id": i + 1,
                "text": words,
                "date": "2026-10-01T00:00:00+00:00",
                "timestamp": now - (i + 1) * DAY,
                "channelName": handle,
                "media": {"kinds": [], "viewsCount": 100, "caption": words},
            }
            for i in range(3)
        ],
    }


@pytest.fixture
def operator(client: TestClient) -> Iterator[dict[str, str]]:
    directory_reads.forget_cached_counts()
    with Session(engine) as session:
        for handle, (name, bio, words, subscribers) in ENTRIES.items():
            record_probe_result(
                session, handle, probe_page(handle, name, bio, words, subscribers)
            )
    yield get_superuser_token_headers(client)
    directory_reads.forget_cached_counts()


def _list(client: TestClient, headers: dict[str, str], **body: Any) -> dict[str, Any]:
    response = client.post(f"{DIRECTORY}/list", json=body, headers=headers)
    assert response.status_code == 200, response.text
    return dict(response.json())


def _found(
    client: TestClient,
    headers: dict[str, str],
    text: str,
    *,
    fields: list[str] | None = None,
    **body: Any,
) -> list[str]:
    search: dict[str, Any] = {"text": text}
    if fields is not None:
        search["fields"] = fields
    page = _list(client, headers, search=search, sort="relevance", **body)
    return [row["handle"] for row in page["rows"]]


def test_a_russian_word_form_finds_another_form_of_the_word(
    client: TestClient, operator: dict[str, str]
) -> None:
    # The Post says "новостей"; "новости" stems to the same word.
    assert _found(client, operator, "новости") == ["ds_ru"]


@pytest.mark.parametrize(
    "typed",
    [
        "كتاب",  # Arabic kaf where the Post wrote Persian keheh
        # Arabic yeh where the Post wrote Persian yeh. Two words, because the
        # arabic stemmer cuts a final yeh and a prefix would then match anyway.
        "جديد تاريخ",
        "کتاب\u200cهای",  # the compound as written, joined by a ZWNJ
    ],
)
def test_a_persian_letter_variant_or_compound_finds_the_post(
    client: TestClient, operator: dict[str, str], typed: str
) -> None:
    assert _found(client, operator, typed) == ["ds_fa"]


def test_a_chinese_word_inside_a_run_is_found(
    client: TestClient, operator: dict[str, str]
) -> None:
    # 新闻 sits inside one unbroken run of the Post.
    assert _found(client, operator, "新闻") == ["ds_zh"]
    assert _found(client, operator, "科技新闻") == ["ds_zh"]
    assert _found(client, operator, "新技") == []


def test_a_name_typed_with_a_typo_still_finds_the_channel(
    client: TestClient, operator: dict[str, str]
) -> None:
    assert _found(client, operator, "telegrapist") == ["ds_typo"]
    # The typo match reads names only.
    assert _found(client, operator, "telegrapist", fields=["posts"]) == []


@pytest.mark.parametrize(
    ("fields", "expected"),
    [
        # Every field, a name match (weight A) first.
        (None, {"ds_name", "ds_bio", "ds_posts"}),
        (["name"], {"ds_name"}),
        (["bio"], {"ds_bio"}),
        (["posts"], {"ds_posts"}),
        (["name", "posts"], {"ds_name", "ds_posts"}),
    ],
)
def test_the_fields_limit_where_a_word_is_looked_for(
    client: TestClient,
    operator: dict[str, str],
    fields: list[str] | None,
    expected: set[str],
) -> None:
    assert set(_found(client, operator, "blockchain", fields=fields)) == expected


@pytest.mark.parametrize(
    ("typed", "expected"),
    [
        ("quasar", ["ds_sky_wide", "ds_sky_small"]),
        # The last word is a prefix from three characters...
        ("qua", ["ds_sky_wide", "ds_sky_small"]),
        # ...and not below it.
        ("qu", []),
        # Every other word matches whole.
        ("qua seen", []),
        ("seen qua", ["ds_sky_wide", "ds_sky_small"]),
        # A stop word in one configuration does not hide that configuration's rows.
        ("the quasar", ["ds_sky_wide", "ds_sky_small"]),
        # ...and stays required under every configuration that keeps it: the
        # Persian row is indexed with `simple`, which holds "only" as a word.
        ("only \u06a9\u062a\u0627\u0628", []),
    ],
)
def test_the_last_word_is_a_prefix_from_three_characters(
    client: TestClient, operator: dict[str, str], typed: str, expected: list[str]
) -> None:
    assert _found(client, operator, typed) == expected


def test_relevance_is_match_strength_times_the_log_of_subscribers(
    client: TestClient, operator: dict[str, str]
) -> None:
    # The same Posts: the bigger Channel first, in either order of probing.
    assert _found(client, operator, "quasar") == ["ds_sky_wide", "ds_sky_small"]
    # The same size: a word in the name outranks one in the bio, and that one
    # outranks one in a Post.
    assert _found(client, operator, "blockchain") == ["ds_name", "ds_bio", "ds_posts"]


def _marked(parts: list[dict[str, Any]] | None) -> str | None:
    """A snippet as text with the matched words in brackets."""
    if parts is None:
        return None
    return "".join(f"[{p['text']}]" if p["hit"] else p["text"] for p in parts)


def _matches(
    client: TestClient, headers: dict[str, str], text: str, **body: Any
) -> dict[str, Any]:
    page = _list(client, headers, search={"text": text}, sort="relevance", **body)
    return {row["handle"]: row["match"] for row in page["rows"]}


def test_show_matches_quotes_the_bio_and_the_newest_matching_post(
    client: TestClient, operator: dict[str, str]
) -> None:
    matches = _matches(client, operator, "blockchain", showMatches=True)
    assert _marked(matches["ds_bio"]["bio"]) == "All about [blockchain], every day"
    assert matches["ds_bio"]["post"] is None
    post = matches["ds_posts"]["post"]
    # The newest of the three samples, and the stemmed word marked whole.
    assert post["postId"] == 3
    assert _marked(post["parts"]).endswith("Then [blockchain] news arrived")
    assert matches["ds_posts"]["bio"] is None
    # A name match quotes nothing: the name is on the row already.
    assert matches["ds_name"] == {"bio": None, "post": None}


def test_a_snippet_marks_a_word_form_a_letter_variant_and_a_pair(
    client: TestClient, operator: dict[str, str]
) -> None:
    ru = _matches(client, operator, "новости", showMatches=True)["ds_ru"]["post"]
    assert "[новостей]" in _marked(ru["parts"])
    fa = _matches(client, operator, "كتاب", showMatches=True)["ds_fa"]["post"]
    # The Post's own spelling is quoted, not the folded one.
    assert _marked(fa["parts"]).startswith("[کتاب]\u200cهای")
    zh = _matches(client, operator, "科技新闻", showMatches=True)["ds_zh"]["post"]
    assert "很多[科技新闻]和" in _marked(zh["parts"])


def test_a_snippet_is_cut_around_the_match_of_a_long_post(
    client: TestClient, operator: dict[str, str]
) -> None:
    post = _matches(client, operator, "nebula", showMatches=True)["ds_long"]["post"]
    marked = _marked(post["parts"])
    assert "A [nebula] glowed" in marked
    assert marked.startswith("…") and marked.endswith("…")
    assert len(marked) < 300


def test_show_matches_off_quotes_nothing(
    client: TestClient, operator: dict[str, str]
) -> None:
    assert set(_matches(client, operator, "blockchain").values()) == {None}
    # Nor does it without a search.
    page = _list(client, operator, showMatches=True)
    assert {row["match"] for row in page["rows"]} == {None}


def test_a_search_combines_with_every_condition(
    client: TestClient, operator: dict[str, str]
) -> None:
    small = {
        "kind": "group",
        "id": "root",
        "op": "and",
        "children": [
            {
                "kind": "atom",
                "id": "a",
                "cond": {"type": "measure", "measure": "subscribers", "max": 1000},
            }
        ],
    }
    page = _list(
        client, operator, search={"text": "quasar"}, filter=small, sort="relevance"
    )
    assert [row["handle"] for row in page["rows"]] == ["ds_sky_small"]
    assert page["total"] == 1
    count = client.post(
        f"{DIRECTORY}/count",
        json={"search": {"text": "quasar"}},
        headers=operator,
    )
    assert count.json() == {"total": 2}


def test_a_search_sorts_by_any_sort_and_relevance_needs_one(
    client: TestClient, operator: dict[str, str]
) -> None:
    page = _list(
        client,
        operator,
        search={"text": "quasar"},
        sort="subscribers",
        descending=False,
    )
    assert [row["handle"] for row in page["rows"]] == [
        "ds_sky_small",
        "ds_sky_wide",
    ]
    # Relevance with nothing searched falls back to the handle.
    page = _list(client, operator, sort="relevance")
    assert [row["handle"] for row in page["rows"]] == sorted(ENTRIES)
