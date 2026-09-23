"""A Post carries its Language (LANG-01, ADR-021).

One seam, as the spec names it: the Post write path, which sync, import and the
bulk route all share. Every assertion reads the stored row, because the row is
what translation and the Channel derivation will read. The real bundled model
runs here; the sentences are clear-cut so a model update cannot flake them.

The two `und` fixtures are chosen to sit far from the other rule's boundary:
"Good morning" scores `en` at 0.70, so only the letter minimum makes it `und`,
and the list of brand names is 42 letters with no language above 0.24, so only
the score floor does. "Срочно" was tried and dropped: it scores 0.49, which is
a fixture a model update could flip.

## Watched to fail

Per `CLAUDE.md`, each rule was mutated and a test here went red:

* skip removing URLs and @mentions → the noisy Persian Post reads as English
* read `text` instead of the media block's caption → the captionless photo
  reads `[photo]` as words
* drop the letter minimum → "Good morning" is `en`
* drop the score floor → the list of names gets a code
* answer `und` for a Post with no letters → the emoji-only Posts are not `zxx`
* test the stripped text for emptiness instead of counting letters → `❤️❤️`
  and the other marked emoji are `und`
* read the legacy placeholder as words → it is `und`, not `zxx`
* re-read on every re-scrape → the sentinel is overwritten
* re-read only unread Posts → the edited Post and the added caption keep
  their old answers
* skip unread Posts on re-scrape → the unread Post stays null
* trust the payload's `language`, on insert or on update → the import tests
* leave `fast-langdetect`'s 80-character default → the English headline wins
* drop `language` from `post_to_camel` → the lookup route test
"""

from __future__ import annotations

from typing import Any

from fastapi.testclient import TestClient
from sqlmodel import Session, select

from app.core.config import settings
from app.core.db import engine
from app.models_tg import Post
from app.services.posts import bulk_upsert_posts_impl
from tests.utils.tenancy import follow_channels

CHANNEL = "languagechan"

PERSIAN = "امروز باران شدیدی در تهران بارید و بسیاری از خیابان‌ها را آب گرفت"
ENGLISH = "Heavy rain flooded many streets in the capital this morning, officials said"
RUSSIAN = "Сегодня утром сильный дождь затопил многие улицы столицы, сообщили власти"


def _item(post_id: int, text: str, **extra: Any) -> dict[str, Any]:
    return {
        "channelName": CHANNEL,
        "id": post_id,
        "text": text,
        "date": "2026-09-23T10:00:00+00:00",
        "timestamp": 1_790_000_000_000 + post_id,
        **extra,
    }


def _language(session: Session, post_id: int) -> str | None:
    return session.exec(
        select(Post.language).where(
            Post.channel_name == CHANNEL, Post.post_id == post_id
        )
    ).one()


def test_a_new_post_is_written_with_its_language() -> None:
    with Session(engine) as session:
        bulk_upsert_posts_impl(
            [_item(1, PERSIAN), _item(2, ENGLISH), _item(3, RUSSIAN)], session
        )
        session.commit()
        assert [_language(session, i) for i in (1, 2, 3)] == ["fa", "en", "ru"]


def test_a_captionless_photo_has_no_words() -> None:
    """Its stored text is the parser's `[photo]`, which is not English."""
    photo = {"kinds": ["photo"], "isMediaOnly": True, "viewsCount": 1200}
    with Session(engine) as session:
        bulk_upsert_posts_impl([_item(1, "[photo]", media=photo)], session)
        session.commit()
        assert _language(session, 1) == "zxx"


def test_a_captioned_photo_is_read_from_its_caption() -> None:
    photo = {"kinds": ["photo"], "caption": PERSIAN, "isMediaOnly": False}
    with Session(engine) as session:
        bulk_upsert_posts_impl([_item(1, PERSIAN, media=photo)], session)
        session.commit()
        assert _language(session, 1) == "fa"


def test_a_post_with_nothing_but_emoji_has_no_words() -> None:
    """Variation selectors, keycap marks and joiners are not letters either."""
    emoji = ["🔥🔥🔥 👇", "❤️❤️", "👨‍💻 🔥", "1️⃣ 2️⃣"]
    with Session(engine) as session:
        bulk_upsert_posts_impl(
            [_item(i, text) for i, text in enumerate(emoji, start=1)], session
        )
        session.commit()
        assert [_language(session, i) for i in range(1, 5)] == ["zxx"] * 4


def test_a_post_too_short_to_place_is_undetermined() -> None:
    """The model answers `en` at 0.70 here; eleven letters is still too few."""
    with Session(engine) as session:
        bulk_upsert_posts_impl([_item(1, "Good morning")], session)
        session.commit()
        assert _language(session, 1) == "und"


def test_words_the_model_cannot_place_are_undetermined() -> None:
    """Long enough to ask, but no language scores above 0.24 for a list of names."""
    names = "Toyota Samsung Apple Google Microsoft Nokia Sony"
    with Session(engine) as session:
        bulk_upsert_posts_impl([_item(1, names)], session)
        session.commit()
        assert _language(session, 1) == "und"


def test_the_legacy_placeholder_has_no_words() -> None:
    """What the parser stored for an unreadable Post before media was kept."""
    with Session(engine) as session:
        bulk_upsert_posts_impl([_item(1, "[Media/No Text Content]")], session)
        session.commit()
        assert _language(session, 1) == "zxx"


def test_links_mentions_and_hashtag_markers_do_not_outvote_the_words() -> None:
    """Twelve English-looking tokens around one short Persian sentence."""
    noisy = (
        "https://www.example.com/news/world/2026/09/23/breaking-story-update "
        "@worldnews_channel @breaking_updates_live "
        "خبر فوری از تهران درباره سیل امروز "
        "#breaking_news #tehran https://t.me/worldnews_channel/4821"
    )
    with Session(engine) as session:
        bulk_upsert_posts_impl([_item(1, noisy)], session)
        session.commit()
        assert _language(session, 1) == "fa"


def test_the_whole_post_is_read_not_its_first_line() -> None:
    """`fast-langdetect` truncates to 80 characters unless told otherwise.

    An English headline of more than 80 characters over a Persian body would
    then read as English.
    """
    headline = (
        "Exclusive report from our correspondent on the ground in the capital today"
    )
    body = " ".join([PERSIAN] * 4)
    with Session(engine) as session:
        bulk_upsert_posts_impl([_item(1, f"{headline} {headline}\n{body}")], session)
        session.commit()
        assert _language(session, 1) == "fa"


def test_an_imported_language_is_ignored() -> None:
    """Every Language in the deployment comes from the one detector."""
    with Session(engine) as session:
        bulk_upsert_posts_impl([_item(1, PERSIAN, language="en")], session)
        session.commit()
        assert _language(session, 1) == "fa"


def _set_language(session: Session, post_id: int, value: str | None) -> None:
    post = session.exec(
        select(Post).where(Post.channel_name == CHANNEL, Post.post_id == post_id)
    ).one()
    post.language = value
    session.add(post)
    session.commit()


def test_an_unchanged_rescrape_leaves_the_language_alone() -> None:
    """Sync rewrites the newest page of every followed Channel on every run.

    A stored sentinel the detector could never produce is how the test tells
    "left alone" from "read again to the same answer".
    """
    with Session(engine) as session:
        bulk_upsert_posts_impl([_item(1, PERSIAN)], session)
        session.commit()
        _set_language(session, 1, "sentinel")

        bulk_upsert_posts_impl([_item(1, PERSIAN)], session)
        session.commit()
        assert _language(session, 1) == "sentinel"


def test_a_post_edited_on_telegram_is_read_again() -> None:
    with Session(engine) as session:
        bulk_upsert_posts_impl([_item(1, PERSIAN)], session)
        session.commit()

        bulk_upsert_posts_impl([_item(1, ENGLISH)], session)
        session.commit()
        assert _language(session, 1) == "en"


def test_a_caption_added_to_a_photo_is_read() -> None:
    """The text can stay the same while the words change: media carries them."""
    bare = {"kinds": ["photo"], "isMediaOnly": True}
    captioned = {"kinds": ["photo"], "caption": PERSIAN, "isMediaOnly": False}
    with Session(engine) as session:
        bulk_upsert_posts_impl([_item(1, "[photo]", media=bare)], session)
        session.commit()

        bulk_upsert_posts_impl([_item(1, "[photo]", media=captioned)], session)
        session.commit()
        assert _language(session, 1) == "fa"


def test_an_unread_post_is_read_when_it_is_rescraped() -> None:
    """A Post stored before LANG-01 need not wait for the walk if sync sees it."""
    with Session(engine) as session:
        bulk_upsert_posts_impl([_item(1, PERSIAN)], session)
        session.commit()
        _set_language(session, 1, None)

        bulk_upsert_posts_impl([_item(1, PERSIAN)], session)
        session.commit()
        assert _language(session, 1) == "fa"


def test_a_rescrape_carrying_a_language_is_ignored() -> None:
    with Session(engine) as session:
        bulk_upsert_posts_impl([_item(1, PERSIAN)], session)
        session.commit()

        bulk_upsert_posts_impl([_item(1, ENGLISH, language="fa")], session)
        session.commit()
        assert _language(session, 1) == "en"


def test_the_bulk_route_and_the_lookup_route_carry_the_language(
    client: TestClient,
) -> None:
    """The write path is shared, so the bulk route reads too; the read shows it."""
    data = f"{settings.API_V1_STR}/data"
    login = client.post(
        f"{settings.API_V1_STR}/login/access-token",
        data={
            "username": settings.FIRST_SUPERUSER,
            "password": settings.FIRST_SUPERUSER_PASSWORD,
        },
    )
    headers = {"Authorization": f"Bearer {login.json()['access_token']}"}
    client.post(
        f"{data}/posts/bulk", json=[_item(1, PERSIAN, language="en")], headers=headers
    )
    with Session(engine) as session:
        follow_channels(session, CHANNEL)

    body = client.post(
        f"{data}/posts/lookup",
        json={"posts": [{"channelName": CHANNEL, "postId": 1}]},
        headers=headers,
    ).json()
    assert [post["language"] for post in body] == ["fa"]
