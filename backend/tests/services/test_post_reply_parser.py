"""Tests for reply metadata extraction from Telegram message widgets."""

from __future__ import annotations

from app.services.post_reply_parser import extract_reply
from tests.utils.tg_html import (
    body_html,
    load_live_fixture,
    message_widget,
    reply_widget,
    widget_by_post_id,
    widgets,
)


class TestExtractReply:
    def test_returns_nothing_for_a_non_reply(self) -> None:
        el = message_widget(body_html("just a post"))
        assert extract_reply(el) == (None, None)

    def test_extracts_id_channel_author_and_quote(self) -> None:
        el = reply_widget(
            parent_id=53018,
            channel="abdimedianet",
            author="AbdiMedia",
            quote="parent excerpt text",
        )
        post_id, reply = extract_reply(el)
        assert post_id == 53018
        assert reply == {
            "channel": "abdimedianet",
            "authorName": "AbdiMedia",
            "text": "parent excerpt text",
            "url": "https://t.me/abdimedianet/53018",
        }

    def test_quote_is_read_from_the_reply_block_not_the_body(self) -> None:
        el = reply_widget(quote="the quote", body="the body")
        _post_id, reply = extract_reply(el)
        assert reply is not None
        assert reply["text"] == "the quote"

    def test_cross_channel_reply_keeps_the_parent_channel(self) -> None:
        el = reply_widget(parent_id=7, channel="otherchannel", data_post="ch/9")
        post_id, reply = extract_reply(el)
        assert post_id == 7
        assert reply is not None
        assert reply["channel"] == "otherchannel"

    def test_private_parent_omits_the_channel(self) -> None:
        """`t.me/c/<id>/<post>` is a private link, never a followable handle."""
        el = message_widget(
            '<a class="tgme_widget_message_reply" href="https://t.me/c/1234/56">'
            '<div class="tgme_widget_message_text js-message_reply_text">q</div></a>'
            + body_html("body")
        )
        post_id, reply = extract_reply(el)
        assert post_id == 56
        assert reply is not None
        assert "channel" not in reply

    def test_invite_parent_omits_the_channel(self) -> None:
        el = message_widget(
            '<a class="tgme_widget_message_reply" href="https://t.me/joinchat/AbCd">'
            '<div class="tgme_widget_message_text js-message_reply_text">q</div></a>'
            + body_html("body")
        )
        _post_id, reply = extract_reply(el)
        assert reply is not None
        assert "channel" not in reply

    def test_non_telegram_href_is_rejected(self) -> None:
        el = message_widget(
            '<a class="tgme_widget_message_reply" href="https://evil.example.com/x/1">'
            '<div class="tgme_widget_message_text js-message_reply_text">q</div></a>'
            + body_html("body")
        )
        post_id, reply = extract_reply(el)
        assert post_id is None
        assert reply is not None
        assert "url" not in reply
        assert "channel" not in reply

    def test_reply_block_without_a_trailing_id_yields_no_post_id(self) -> None:
        el = message_widget(
            '<a class="tgme_widget_message_reply" href="https://t.me/durov">'
            '<div class="tgme_widget_message_text js-message_reply_text">q</div></a>'
            + body_html("body")
        )
        post_id, reply = extract_reply(el)
        assert post_id is None
        assert reply is not None
        assert reply["channel"] == "durov"

    def test_empty_reply_block_yields_no_metadata(self) -> None:
        el = message_widget(
            '<a class="tgme_widget_message_reply"></a>' + body_html("body")
        )
        assert extract_reply(el) == (None, None)


def test_extract_reply_on_live_contest_fixture() -> None:
    html = load_live_fixture("contest_root.html")
    found = {}
    for el in widgets(html):
        data_post = el.get("data-post")
        if not data_post:
            continue
        post_id = int(str(data_post).rsplit("/", 1)[-1])
        parent_id, _reply = extract_reply(el)
        if parent_id is not None:
            found[post_id] = parent_id
    assert found == {444: 443, 450: 449, 454: 453}


def test_live_reply_metadata_is_fully_populated() -> None:
    el = widget_by_post_id(load_live_fixture("contest_root.html"), 444)
    post_id, reply = extract_reply(el)
    assert post_id == 443
    assert reply is not None
    assert reply["channel"] == "contest"
    assert reply["authorName"] == "Telegram Contests"
    assert reply["text"].startswith("ContestBot is now ready")
    assert reply["url"] == "https://t.me/contest/443"
