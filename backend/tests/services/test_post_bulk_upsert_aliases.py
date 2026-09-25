"""Which spellings `bulk_upsert_posts_impl` reads, and what an absent key means.

The scraper and an export round trip send camelCase, but `POST /data/import`
and `/data/posts/bulk` take any JSON, so every field is also read under its
snake_case column name. The two branches disagree on purpose about absence: an
insert defaults a missing field, an update leaves the stored value alone for the
key-guarded fields and overwrites the rest. Nothing else pinned the snake half
or the per-field guards, so a normaliser that read one spelling fewer, or
guarded one field more, would have passed the suite.
"""

from __future__ import annotations

from typing import Any

from sqlmodel import Session, select

from app.core.db import engine
from app.models_tg import Post
from app.services.posts import bulk_upsert_posts_impl

CHANNEL = "aliaschan"
REPLY = {"channel": "other", "authorName": "a", "text": "t", "url": "u"}
SPAN = {"offset": 0, "length": 4, "url": "https://t.me/x"}


def _post(session: Session, post_id: int) -> Post:
    return session.exec(
        select(Post).where(Post.channel_name == CHANNEL, Post.post_id == post_id)
    ).one()


def _upsert(items: list[dict[str, Any]], **kwargs: Any) -> None:
    with Session(engine) as session:
        bulk_upsert_posts_impl(items, session, **kwargs)
        session.commit()


def test_an_insert_reads_every_field_under_its_snake_case_name() -> None:
    _upsert(
        [
            {
                "channel_name": CHANNEL,
                "post_id": 1,
                "text": "body",
                "date": "d",
                "timestamp": 5,
                "forwarded_from": "src",
                "forwarded_from_name": "Source",
                "forwarded_from_post_id": 9,
                "reply_to_post_id": 3,
                "reply_to": REPLY,
                "link_spans": [SPAN, {"offset": True, "length": 1, "url": "x"}],
                "retrieval_job_id": "job",
                "retrieval_pass": "pass",
                "retrieval_source": "src",
            }
        ],
        retrieval_job_id="kw-job",
    )
    with Session(engine) as session:
        post = _post(session, 1)
        assert (post.text, post.date, post.timestamp) == ("body", "d", 5)
        assert (post.forwarded_from, post.forwarded_from_name) == ("src", "Source")
        assert (post.forwarded_from_post_id, post.reply_to_post_id) == (9, 3)
        assert post.reply_to == REPLY
        assert post.link_spans == [SPAN]
        assert (post.retrieval_job_id, post.retrieval_pass) == ("job", "pass")
        assert post.retrieval_source == "src"


def test_an_insert_defaults_what_the_item_leaves_out() -> None:
    _upsert(
        [{"channelName": CHANNEL, "id": 1, "forwardedFrom": "", "media": "nope"}],
        retrieval_job_id="kw-job",
        retrieval_pass="kw-pass",
        retrieval_source="kw-src",
    )
    with Session(engine) as session:
        post = _post(session, 1)
        assert (post.text, post.date, post.timestamp) == ("", "", 0)
        # An empty camelCase value falls through to the (absent) snake one.
        assert post.forwarded_from is None
        assert post.media is None
        assert post.links is None
        assert post.link_spans is None
        assert post.reply_to is None
        assert post.forwarded_from_post_id is None
        assert post.retrieval_job_id == "kw-job"
        assert post.retrieval_pass == "kw-pass"
        assert post.retrieval_source == "kw-src"


def test_an_update_keeps_the_guarded_fields_the_item_leaves_out() -> None:
    _upsert(
        [
            {
                "channelName": CHANNEL,
                "id": 1,
                "text": "same words",
                "date": "d",
                "timestamp": 5,
                "forwardedFrom": "src",
                "forwardedFromName": "Source",
                "forwardedFromPostId": 9,
                "replyToPostId": 3,
                "media": {"kinds": ["photo"]},
                "links": ["x"],
                "linkSpans": [SPAN],
                "replyTo": REPLY,
            }
        ]
    )
    # Only the key names the unguarded fields answer to; the text is unchanged,
    # so the stored spans survive too.
    _upsert([{"channel_name": CHANNEL, "post_id": 1, "text": "same words"}])
    with Session(engine) as session:
        post = _post(session, 1)
        assert (post.date, post.timestamp) == ("d", 5)
        assert post.forwarded_from_post_id == 9
        assert post.media == {"kinds": ["photo"]}
        assert post.links == ["x"]
        assert post.link_spans == [SPAN]
        assert post.reply_to == REPLY
        # Unguarded: an absent key overwrites with nothing.
        assert post.forwarded_from is None
        assert post.forwarded_from_name is None
        assert post.reply_to_post_id is None


def test_an_update_reads_the_snake_case_names_it_guards_on() -> None:
    _upsert([{"channelName": CHANNEL, "id": 1, "text": "t", "replyTo": REPLY}])
    _upsert(
        [
            {
                "channel_name": CHANNEL,
                "post_id": 1,
                "text": "t",
                "forwarded_from": "src",
                "forwarded_from_name": "Source",
                "forwarded_from_post_id": 9,
                "reply_to_post_id": 3,
                "link_spans": [SPAN],
                # The one guard that reads a single spelling: `replyTo` alone
                # decides, so a snake-only reply leaves the stored one.
                "reply_to": {"channel": "ignored"},
            }
        ]
    )
    with Session(engine) as session:
        post = _post(session, 1)
        assert (post.forwarded_from, post.forwarded_from_name) == ("src", "Source")
        assert (post.forwarded_from_post_id, post.reply_to_post_id) == (9, 3)
        assert post.link_spans == [SPAN]
        assert post.reply_to == REPLY


def test_an_update_with_new_words_and_no_spans_drops_the_spans() -> None:
    _upsert([{"channelName": CHANNEL, "id": 1, "text": "old", "linkSpans": [SPAN]}])
    _upsert([{"channelName": CHANNEL, "id": 1, "text": "new"}])
    with Session(engine) as session:
        assert _post(session, 1).link_spans is None
