"""Searching the Directory over HTTP (DIR-04, ADR-027).

`POST /data/directory/list` with a `search` finds Channels by words in their
name, bio and recent Posts. The corpus below is written through the real write
path, a recorded probe result per entry, so a writer that forgot the search
index fails here rather than in a test that inserted index rows itself.

| entry          | Language | name                | bio                   | Posts say                                   | subscribers |
|----------------|----------|---------------------|-----------------------|---------------------------------------------|-------------|
| ds_ru          | ru       | Russkiy Dnevnik     |                       | "... новостей о политике ..."               | 5000        |
| ds_fa          | fa       | Kucheh              |                       | "کتاب‌های ... ملی ..." (Persian ک, ی, ZWNJ)  | 5000        |
| ds_zh          | zh       | Zhongwen            |                       | "...电报频道发布了很多科技新闻..."            | 5000        |
| ds_typo        | en       | Telegraphist Weekly |                       | English filler                              | 5000        |
| ds_name        | en       | Blockchain Corner   |                       | English filler                              | 5000        |
| ds_bio         | en       | Bio Only            | "all about blockchain"| English filler                              | 5000        |
| ds_posts       | en       | Posts Only          |                       | "... blockchain ..."                        | 5000        |
| ds_quasar_big  | en       | Sky Big             |                       | "... quasar ..."                            | 1000000     |
| ds_quasar_small| en       | Sky Small           |                       | "... quasar ..."                            | 100         |

## Watched to fail

Each mutation was applied alone and this module went red:
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
#: Persian keheh (ک) and Persian yeh (ی), and a zero-width non-joiner in کتاب‌های.
FA = "کتاب‌های جدید درباره تاریخ ایران در کتابخانه ملی منتشر شد"
ZH = "今天电报频道发布了很多科技新闻和市场分析报告"

#: handle -> (display name, bio, Post text, subscribers)
ENTRIES: dict[str, tuple[str, str | None, str, int]] = {
    "ds_ru": ("Russkiy Dnevnik", None, RU, 5000),
    "ds_fa": ("Kucheh", None, FA, 5000),
    "ds_zh": ("Zhongwen", None, ZH, 5000),
    "ds_typo": ("Telegraphist Weekly", None, EN, 5000),
    "ds_name": ("Blockchain Corner", None, EN, 5000),
    "ds_bio": ("Bio Only", "All about blockchain, every day", EN, 5000),
    "ds_posts": ("Posts Only", None, f"{EN}. Then blockchain news arrived", 5000),
    "ds_quasar_big": ("Sky Big", None, f"{EN}. A quasar was seen", 1_000_000),
    "ds_quasar_small": ("Sky Small", None, f"{EN}. A quasar was seen", 100),
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
