"""A Post keeps its Links as positions over its plain text (LINK-01, ADR-022).

The body is stored as plain text, so every `<a href>` in it used to be reduced
to its words and a masked Link lost its destination for good. `Post.links`
kept some hrefs, but only Telegram-hosted ones, deduped by Channel and without
positions, because it feeds References rather than the feed.

Three seams: the HTML parse itself, the dict hops between it and the stored
row (the shape `test_scraper_forward_plumbing.py` takes), and the API an
import writes and an export reads. The renderer's half is
`frontend/src/lib/posts/render-post-text.test.ts`.

## Watched to fail

* count code points instead of UTF-16 units → the emoji test and the
  live-fixture test fail
* forget the whitespace `.strip()` removed → the stripped-body test fails
* read the whole widget instead of `message_body_element` → the reply-excerpt
  test fails, because the reply preview is itself an anchor
* drop the `<br>` flattening → the line-break test fails
* skip `tg://` hrefs at parse time → the verbatim test fails
* store "no Links" as null → the empty-list test fails
* drop the key from `_posts_to_save`, or from either `bulk_upsert_posts_impl`
  branch → the upsert tests fail
* assign without the key guard → the same-words test fails, which is the one
  that costs data on an export round trip
* keep the old positions when the words change → the new-words test fails
* drop the field from `post_to_camel` or `PostResponse` → the import/API/export
  test fails
* keep every entry an import sends, let a bool pass as an int, or stop checking
  `url` → the malformed-entry test fails
"""

from __future__ import annotations

from typing import Any

from bs4 import Tag
from fastapi.testclient import TestClient
from sqlmodel import Session, select

from app.core.config import settings
from app.core.db import engine
from app.models_tg import Post
from app.services.posts import bulk_upsert_posts_impl
from app.services.scraper import _parse_posts_from_html, make_soup
from app.services.sync_orchestrator import _posts_to_save
from app.services.telegram_html import attr_str, message_body_element
from tests.utils.tg_html import (
    body_html,
    live_fixture_paths,
    message_widget,
    reply_widget,
)


def _parse(el: Tag) -> dict[str, Any]:
    posts, _next = _parse_posts_from_html(make_soup(str(el)), 0, set())
    assert len(posts) == 1
    return posts[0]


def _body(inner: str) -> tuple[str, list[dict[str, Any]]]:
    post = _parse(message_widget(body_html(inner)))
    return post["text"], post["linkSpans"]


def _words(text: str, span: dict[str, Any]) -> str:
    """A Link's words, sliced in UTF-16 units the way the browser slices them."""
    units = text.encode("utf-16-le")
    start = 2 * span["offset"]
    return units[start : start + 2 * span["length"]].decode("utf-16-le")


def test_a_masked_link_keeps_its_destination() -> None:
    post = _parse(
        message_widget(
            body_html(
                'Read <a href="https://example.com/a" target="_blank" '
                "onclick=\"return confirm('Open this link?')\"><b>the docs</b></a> now"
            )
        )
    )

    assert post["text"] == "Read the docs now"
    assert post["linkSpans"] == [
        {"offset": 5, "length": 8, "url": "https://example.com/a"}
    ]


def test_a_bare_address_keeps_the_href_telegram_wrote() -> None:
    """The words drop the scheme and the slash; the stored url does not."""
    text, spans = _body(
        '<a href="http://telegram.org/" target="_blank" rel="noopener">'
        "telegram.org</a> is up"
    )

    assert text == "telegram.org is up"
    assert spans == [{"offset": 0, "length": 12, "url": "http://telegram.org/"}]


def test_a_mention_is_a_link() -> None:
    text, spans = _body(
        'ask <a href="https://t.me/BotFather" target="_blank">@BotFather</a>'
    )

    assert text == "ask @BotFather"
    assert spans == [{"offset": 4, "length": 10, "url": "https://t.me/BotFather"}]


def test_a_link_no_browser_can_open_is_still_stored_verbatim() -> None:
    """Whether `tg://` is clickable is the renderer's decision, not the row's."""
    _text, spans = _body(
        '<a href="tg://premium_offer?ref=premium"><b>Subscribe</b></a>'
    )

    assert spans == [
        {"offset": 0, "length": 9, "url": "tg://premium_offer?ref=premium"}
    ]


def test_a_masked_link_can_be_one_character() -> None:
    text, spans = _body('links<a href="https://t.me/addtheme/RetroGreen">.</a>')

    assert text == "links."
    assert spans == [
        {"offset": 5, "length": 1, "url": "https://t.me/addtheme/RetroGreen"}
    ]


def test_positions_count_utf16_units() -> None:
    """An emoji is one code point and two UTF-16 units, so code points would say 2."""
    text, spans = _body('\U0001f525 <a href="https://example.com/">go</a>')

    assert text == "\U0001f525 go"
    assert spans == [{"offset": 3, "length": 2, "url": "https://example.com/"}]


def test_positions_are_measured_after_the_body_is_stripped() -> None:
    text, spans = _body('\n   <a href="https://example.com/x">first</a> word')

    assert text == "first word"
    assert spans == [{"offset": 0, "length": 5, "url": "https://example.com/x"}]


def test_a_line_break_counts_as_one_newline() -> None:
    text, spans = _body('line<br/><a href="https://example.com/">next</a>')

    assert text == "line\nnext"
    assert spans == [{"offset": 5, "length": 4, "url": "https://example.com/"}]


def test_the_replied_to_excerpt_is_not_the_posts_own_words() -> None:
    """The reply preview is itself an anchor, and it comes first in the DOM."""
    post = _parse(reply_widget(body='plain <a href="https://example.com/b">body</a>'))

    assert post["text"] == "plain body"
    assert post["linkSpans"] == [
        {"offset": 6, "length": 4, "url": "https://example.com/b"}
    ]


def test_a_post_with_no_links_stores_an_empty_list() -> None:
    """Empty means Telegram marked nothing; an absent key would mean never read."""
    assert _body("nothing to click")[1] == []
    assert _parse(message_widget(""))["linkSpans"] == []


def _squash(words: str) -> str:
    return " ".join(words.split())


def test_every_live_link_lands_on_its_own_words() -> None:
    """Across every captured page, each Link slices out exactly its anchor's words.

    The stored text and the positions are read by two functions off one
    flattening, so this is what notices one of them changing without the other.
    """
    checked = 0
    for path in live_fixture_paths():
        soup = make_soup(path.read_text(encoding="utf-8"))
        bodies = {}
        for el in soup.select(".tgme_widget_message"):
            last = (attr_str(el.get("data-post")) or "").rsplit("/", 1)[-1]
            body = message_body_element(el)
            if last.isdecimal() and body is not None:
                bodies.setdefault(int(last), body)
        posts, _next = _parse_posts_from_html(soup, 0, set())
        for post in posts:
            body = bodies.get(post["id"])
            anchors = body.find_all("a", href=True) if body is not None else []
            expected = [_squash(a.get_text()) for a in anchors if a.get_text().strip()]
            words = [_squash(_words(post["text"], s)) for s in post["linkSpans"]]
            assert words == expected, (path.name, post["id"])
            checked += len(words)
    assert checked > 1000


CHANNEL = "linkchan"
MASKED = 'Read <a href="https://example.com/a"><b>the docs</b></a> now'


def _scraped(inner: str) -> dict[str, Any]:
    """One Post as the scrape path hands it to the upsert."""
    parsed = _parse(message_widget(body_html(inner), data_post=f"{CHANNEL}/9"))
    return _posts_to_save(CHANNEL, [parsed])[0]


def _upsert(session: Session, item: dict[str, Any]) -> Post:
    bulk_upsert_posts_impl([item], session)
    session.commit()
    return session.exec(
        select(Post).where(Post.channel_name == CHANNEL, Post.post_id == 9)
    ).one()


def test_a_scraped_post_stores_its_links() -> None:
    with Session(engine) as session:
        row = _upsert(session, _scraped(MASKED))

        assert row.link_spans == [
            {"offset": 5, "length": 8, "url": "https://example.com/a"}
        ]


def test_a_re_scrape_replaces_the_links() -> None:
    with Session(engine) as session:
        _upsert(session, _scraped(MASKED))
        row = _upsert(
            session, _scraped('Read <a href="https://example.com/b">docs</a>')
        )

        assert row.link_spans == [
            {"offset": 5, "length": 4, "url": "https://example.com/b"}
        ]


def _without_spans(item: dict[str, Any]) -> dict[str, Any]:
    """A payload from before LINK-01: an older export, or an older client."""
    return {k: v for k, v in item.items() if k != "linkSpans"}


def test_new_words_without_new_positions_clear_the_old_ones() -> None:
    """Positions measured against other words would link the wrong ones.

    Null rather than empty, so the renderer falls back to its regex and still
    links whatever bare addresses the new words carry.
    """
    with Session(engine) as session:
        _upsert(session, _scraped(MASKED))
        row = _upsert(
            session,
            {**_without_spans(_scraped(MASKED)), "text": "Entirely different words"},
        )

        assert row.link_spans is None


def test_links_travel_through_import_the_api_and_export(
    client: TestClient, superuser_token_headers: dict[str, str]
) -> None:
    """Masked Links cannot be re-derived from text, so an export must carry them."""
    prefix = f"{settings.API_V1_STR}/data"
    spans = [{"offset": 5, "length": 8, "url": "https://example.com/a"}]
    post = {
        "id": 7,
        "channelName": CHANNEL,
        "text": "Read the docs now",
        "date": "2026-09-01T00:00:00+00:00",
        "timestamp": 1_788_000_000_000,
        "linkSpans": spans,
    }
    imported = client.post(
        f"{prefix}/import",
        json={
            "data": {"channels": [{"id": CHANNEL, "name": CHANNEL}], "posts": [post]}
        },
        headers=superuser_token_headers,
    )
    assert imported.status_code == 200

    looked_up = client.post(
        f"{prefix}/posts/lookup",
        json={"posts": [{"channelName": CHANNEL, "postId": 7}]},
        headers=superuser_token_headers,
    ).json()
    assert looked_up[0]["linkSpans"] == spans

    exported = client.get(f"{prefix}/export", headers=superuser_token_headers)
    row = next(p for p in exported.json()["data"]["posts"] if p["id"] == 7)
    assert row["linkSpans"] == spans


def test_a_malformed_link_is_dropped_on_write() -> None:
    """Import and `/data/posts/bulk` take any JSON, and Posts are shared rows.

    `PostResponse` declares the entry shape, so one bad entry stored here would
    make every read of the Post a 500 for every account that follows it.
    """
    good = {"offset": 5, "length": 8, "url": "https://example.com/a"}
    with Session(engine) as session:
        row = _upsert(
            session,
            {
                **_scraped(MASKED),
                "linkSpans": [
                    "x",
                    {"offset": 1},
                    {**good, "offset": True},
                    {**good, "url": 7},
                    good,
                ],
            },
        )

        assert row.link_spans == [good]


def test_the_same_words_without_positions_keep_them() -> None:
    """An export round trip that cannot carry the column must not destroy it."""
    with Session(engine) as session:
        _upsert(session, _scraped(MASKED))
        row = _upsert(session, _without_spans(_scraped(MASKED)))

        assert row.link_spans == [
            {"offset": 5, "length": 8, "url": "https://example.com/a"}
        ]
