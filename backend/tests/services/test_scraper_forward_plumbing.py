"""A forward records which Post it came from (CRG-03).

The scraper read the forward attribution's href for its first path segment and
threw the rest away, so a forward knew its source Channel and never its source
Post. A link did better by accident — its parser drops the id too, but the raw
href survives on `Post.links`, so CRG-01 could recover it there. A forward's
href survived nowhere, which is why this is a parse change and a column rather
than a backfill.

Two seams, in the shape `test_scraper_reply_plumbing.py` takes: the HTML parse
itself, and the dict hops between it and the two tables that store it. Each hop
drops an unknown key in silence, so the plumbing is worth its own assertions.

## Watched to fail

* read the href with `extract_channel_name_from_href` again (handle only) →
  `test_a_forward_carries_the_post_it_came_from` fails
* keep `extract_channel_name_from_href` and drop the `is_channel_handle` test →
  the private-channel test fails, and a phantom `@c` becomes a follow candidate
* take the handle but keep the id when the handle is reserved → the private and
  invite tests fail on their second assertion, which is the "refused together"
  rule the ticket asks for
* match the host by substring rather than against the configured domains →
  `test_a_masquerading_host_is_not_a_forward` fails
* drop `forwardedFromPostId` from `_posts_to_save` → the save-payload test fails
* drop it from `channel_directory_samples._row` → the sample assertion in
  `test_directory_samples.py` fails
* drop it from either `bulk_upsert_posts_impl` branch → the upsert test fails,
  on the insert half or on the re-scrape half respectively
* drop the key guard on the update half (assign unconditionally) → the
  export-round-trip test fails, which is the one that costs data
* guard the update half on a truth test instead (`if item.get(...)`) → the
  lost-link test fails, because a scrape that no longer sees an id must clear it
* restore `isdigit` in `extract_channel_post_from_href` → the superscript test
  fails with a `ValueError` rather than an assertion
* emit the key when there is no id (`post["forwardedFromPostId"] = None`) → the
  bare-handle test fails, and every non-forward Post grows a null key
"""

from __future__ import annotations

from typing import Any

from bs4 import Tag
from sqlmodel import Session, select

from app.core.db import engine
from app.models_tg import Post
from app.services.posts import bulk_upsert_posts_impl
from app.services.scraper import _parse_posts_from_html, make_soup
from app.services.sync_orchestrator import _posts_to_save
from tests.utils.tg_html import body_html, message_widget, widgets

CHANNEL = "sourcechan"


def _stored(session: Session) -> Post:
    return session.exec(
        select(Post).where(Post.channel_name == CHANNEL, Post.post_id == 9)
    ).one()


def _forward_widget(href: str, *, data_post: str = "ch/9") -> Tag:
    """A message widget forwarded from `href`, as t.me renders one.

    The attribution is an anchor whose href is the **source Post**, not the
    source channel page — which is the whole reason this ticket exists.
    """
    return message_widget(
        f'<div class="tgme_widget_message_forwarded_from">'
        f'<a class="tgme_widget_message_forwarded_from_name" href="{href}">'
        f"<span>Source Channel</span></a></div>" + body_html("forwarded body"),
        data_post=data_post,
    )


def _parse(el: Tag) -> dict[str, Any]:
    posts, _next = _parse_posts_from_html(make_soup(str(el)), 0, set())
    assert len(posts) == 1
    return posts[0]


def test_a_forward_carries_the_post_it_came_from() -> None:
    post = _parse(_forward_widget("https://t.me/alphachan/4271"))

    assert post["forwardedFrom"] == "alphachan"
    assert post["forwardedFromPostId"] == 4271


def test_a_forward_from_a_private_channel_stores_neither() -> None:
    """`t.me/c/<chat>/<post>` is a private link, never a followable handle.

    The id is worth nothing without somewhere to resolve it, so the pair is
    refused together rather than leaving an id hanging off a phantom `@c`.
    """
    post = _parse(_forward_widget("https://t.me/c/1234567890/88"))

    assert "forwardedFrom" not in post
    assert "forwardedFromPostId" not in post


def test_a_forward_behind_an_invite_link_stores_neither() -> None:
    post = _parse(_forward_widget("https://t.me/joinchat/AbCdEf"))

    assert "forwardedFrom" not in post
    assert "forwardedFromPostId" not in post


def test_a_masquerading_host_is_not_a_forward() -> None:
    """The host is matched against the configured domains, not searched for."""
    post = _parse(_forward_widget("https://evil.example.com/t.me/alphachan/7"))

    assert "forwardedFrom" not in post
    assert "forwardedFromPostId" not in post


def test_a_superscript_post_segment_does_not_raise_out_of_the_page() -> None:
    """`"²".isdigit()` is true and `int("²")` is a `ValueError`.

    The href is scraped HTML the channel controls, so an exception here would
    fail the whole page for one crafted link rather than that one Post.
    `extract_channel_post_from_href` uses `isdecimal`, which is exactly the set
    `int` accepts, so this reads as a Channel with no Post.
    """
    post = _parse(_forward_widget("https://t.me/alphachan/²"))

    assert post["forwardedFrom"] == "alphachan"
    assert "forwardedFromPostId" not in post


def test_a_forward_to_a_channel_page_keeps_the_handle_and_no_id() -> None:
    """Telegram links the channel alone when the source Post is unlinkable.

    The handle is still worth storing; the absent key is what tells CRG-01's
    extractor to write a Reference naming the Channel and no Post.
    """
    post = _parse(_forward_widget("https://t.me/alphachan"))

    assert post["forwardedFrom"] == "alphachan"
    assert "forwardedFromPostId" not in post


def test_a_non_forward_carries_no_forward_keys() -> None:
    posts, _next = _parse_posts_from_html(
        make_soup(str(message_widget(body_html("plain post"), data_post="ch/3"))),
        0,
        set(),
    )

    assert "forwardedFrom" not in posts[0]
    assert "forwardedFromPostId" not in posts[0]


def test_posts_to_save_forwards_the_post_id() -> None:
    """`_posts_to_save` is an allowlist — a missing key is dropped in silence."""
    parsed = _parse(_forward_widget("https://t.me/alphachan/4271"))

    saved = _posts_to_save(CHANNEL, [parsed])

    assert saved[0]["forwardedFromPostId"] == 4271


def test_the_post_row_keeps_the_id_through_an_upsert_and_a_re_scrape() -> None:
    """The last hop, and the one an existing Post travels twice.

    Sync re-scrapes the newest page of every followed Channel, so a Post
    scraped before CRG-03 and still on that page gains the **column** next time
    it is read. It does not gain the Reference: nothing resets
    `references_extracted`, so an edge already extracted with a null target
    Post keeps it. The corpus-wide claim the ticket makes is about the column.
    """
    parsed = _parse(_forward_widget("https://t.me/alphachan/4271"))
    saved = _posts_to_save(CHANNEL, [parsed])

    with Session(engine) as session:
        bulk_upsert_posts_impl([{**saved[0], "forwardedFromPostId": None}], session)
        session.commit()
        assert _stored(session).forwarded_from_post_id is None

        bulk_upsert_posts_impl(saved, session)
        session.commit()
        assert _stored(session).forwarded_from_post_id == 4271


def test_a_scrape_that_lost_the_link_clears_the_id() -> None:
    """`_posts_to_save` always emits the key, so the scrape path still overwrites.

    A forward whose attribution stops linking its source is a Post whose id we
    no longer know, not one to keep a stale answer for.
    """
    with_id = _posts_to_save(
        CHANNEL, [_parse(_forward_widget("https://t.me/alphachan/4271"))]
    )
    without_link = _posts_to_save(
        CHANNEL, [_parse(_forward_widget("https://t.me/alphachan"))]
    )
    assert "forwardedFromPostId" in without_link[0]

    with Session(engine) as session:
        bulk_upsert_posts_impl(with_id, session)
        session.commit()
        bulk_upsert_posts_impl(without_link, session)
        session.commit()

        assert _stored(session).forwarded_from_post_id is None


def test_a_payload_that_never_mentions_the_id_leaves_it_alone() -> None:
    """An export round trip must not null the one column it cannot carry.

    `post_to_camel` emits a fixed seventeen keys and this is not among them, so
    `POST /data/import` hands `bulk_upsert_posts_impl` a Post with no
    `forwardedFromPostId` at all. Overwriting on an absent key would destroy
    every id CRG-03 has collected, with no href left anywhere to recover it.
    `POST /data/posts/bulk` from a client older than this change is the same
    payload.
    """
    saved = _posts_to_save(
        CHANNEL, [_parse(_forward_widget("https://t.me/alphachan/4271"))]
    )
    restored = {k: v for k, v in saved[0].items() if k != "forwardedFromPostId"}

    with Session(engine) as session:
        bulk_upsert_posts_impl(saved, session)
        session.commit()
        bulk_upsert_posts_impl([restored], session)
        session.commit()

        assert _stored(session).forwarded_from_post_id == 4271


def test_a_widget_with_no_href_keeps_the_display_name_alone() -> None:
    """A forward from a deleted or hidden source has a name and no link."""
    el = widgets(
        '<div class="tgme_widget_message" data-post="ch/9">'
        '<div class="tgme_widget_message_forwarded_from">'
        '<span class="tgme_widget_message_forwarded_from_name">Someone</span>'
        "</div>" + body_html("body") + "</div>"
    )[0]

    post = _parse(el)

    assert post["forwardedFromName"] == "Someone"
    assert "forwardedFrom" not in post
    assert "forwardedFromPostId" not in post
