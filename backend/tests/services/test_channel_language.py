"""A Channel's Language is derived from its Posts (LANG-02, ADR-021).

Two seams. `derive_language` is the rule itself, a pure function LANG-05 reuses
for Directory samples, so its edges (the tie, the 100-Post window) are pinned
directly. Everything an Account sees is asserted through the Post write path,
which sync, import and the bulk route share: write Posts, read the Channel row.
The real bundled model reads the Posts, on the same clear-cut sentences as
`test_post_language.py`.

## Watched to fail

* count forwards alongside own Posts → the forwarding Persian Channel is `en`
* never fall back to forwards → the pure re-poster is null
* break a tie on the newest Post overall → the tie test picks `ru`
* break a tie on the oldest → the tie test picks `fa`
* drop the 100-Post window → the old majority outvotes the new one
* count `zxx`/`und` as codes → the photo Channel is `zxx`
* read every sampled Post as own → the forwarding Channel is `en`
* drop the sample's depth limit → the bounded-depth test
* follow the imported handles after writing the Posts → the import test
* never move the etag after an import → the import test
* skip the derivation on the write path → every write-path test
* touch the etag on every batch → the unchanged-answer test
* never touch the etag → the relabel test
* drop `language` from the server-managed set → the update route writes it
"""

from __future__ import annotations

from typing import Any

from fastapi.testclient import TestClient
from sqlmodel import Session, select

from app.core.config import settings
from app.core.db import engine
from app.models_tg import Channel, SyncMeta
from app.services.language import derive_language
from app.services.posts import bulk_upsert_posts_impl
from tests.utils.tenancy import follow_channels

CHANNEL = "languagechan"

PERSIAN = "امروز باران شدیدی در تهران بارید و بسیاری از خیابان‌ها را آب گرفت"
ENGLISH = "Heavy rain flooded many streets in the capital this morning, officials said"
RUSSIAN = "Сегодня утром сильный дождь затопил многие улицы столицы, сообщили власти"
PHOTO = {"kinds": ["photo"], "isMediaOnly": True}


# -- the rule ---------------------------------------------------------------


def test_the_most_common_own_code_wins() -> None:
    assert derive_language([("en", False), ("fa", False), ("fa", False)]) == "fa"


def test_a_tie_goes_to_the_newest_post_among_the_tied() -> None:
    """Newest first: `ru` is newest overall but not tied, so `en` wins."""
    posts = [("ru", False), ("en", False), ("fa", False), ("en", False)]
    assert derive_language([*posts, ("fa", False)]) == "en"


def test_only_the_newest_hundred_own_posts_count() -> None:
    """A Channel that switched language is judged on what it publishes now."""
    posts = [("en", False)] * 60 + [("fa", False)] * 40 + [("fa", False)] * 50
    assert derive_language(posts) == "en"


def test_the_window_counts_posts_that_carry_a_code() -> None:
    """Photos in between do not push readable Posts out of the window."""
    posts = [("zxx", False)] * 100 + [(None, False)] * 5 + [("fa", False)]
    assert derive_language([*posts, ("und", False)]) == "fa"


def test_forwards_count_only_when_there_are_no_own_posts() -> None:
    assert derive_language([("en", True), ("en", True), ("fa", False)]) == "fa"
    assert derive_language([("en", True), ("zxx", False)]) == "en"


def test_nothing_readable_is_no_language() -> None:
    assert derive_language([]) is None
    assert derive_language([("zxx", False), ("und", True), (None, False)]) is None


# -- through the write path -------------------------------------------------


def _item(post_id: int, text: str, **extra: Any) -> dict[str, Any]:
    return {
        "channelName": CHANNEL,
        "id": post_id,
        "text": text,
        "date": "2026-09-23T10:00:00+00:00",
        "timestamp": 1_790_000_000_000 + post_id,
        **extra,
    }


def _forward(post_id: int, text: str) -> dict[str, Any]:
    return _item(post_id, text, forwardedFrom="worldnews")


def _channel(session: Session, language: str | None = None) -> None:
    follow_channels(session, CHANNEL)
    channel = session.get(Channel, CHANNEL)
    assert channel is not None
    channel.language = language
    session.add(channel)
    session.commit()


def _write(session: Session, items: list[dict[str, Any]]) -> str | None:
    bulk_upsert_posts_impl(items, session)
    session.commit()
    session.expire_all()
    channel = session.get(Channel, CHANNEL)
    assert channel is not None
    return channel.language


def _etag(session: Session) -> str | None:
    session.expire_all()
    meta = session.get(SyncMeta, "channels")
    return meta.etag if meta else None


def test_a_channel_takes_the_language_most_of_its_posts_are_in() -> None:
    with Session(engine) as session:
        _channel(session)
        items = [_item(1, ENGLISH), _item(2, PERSIAN), _item(3, PERSIAN)]
        assert _write(session, items) == "fa"


def test_a_persian_channel_forwarding_english_news_stays_persian() -> None:
    with Session(engine) as session:
        _channel(session)
        items = [_item(1, PERSIAN), *(_forward(i, ENGLISH) for i in (2, 3, 4))]
        assert _write(session, items) == "fa"


def test_a_channel_that_only_forwards_takes_the_forwards_language() -> None:
    with Session(engine) as session:
        _channel(session)
        items = [_item(1, "[photo]", media=PHOTO), _forward(2, RUSSIAN)]
        assert _write(session, items) == "ru"


def test_a_channel_with_nothing_readable_has_no_language() -> None:
    """A label left by the retired detectors does not survive the derivation."""
    with Session(engine) as session:
        _channel(session, language="Persian")
        items = [_item(1, "[photo]", media=PHOTO), _item(2, "Good morning")]
        assert _write(session, items) is None


def test_a_channel_is_relabelled_when_it_changes_language() -> None:
    """And the Channels tab hears about it through the `channels` etag."""
    with Session(engine) as session:
        _channel(session)
        assert _write(session, [_item(i, PERSIAN) for i in (1, 2, 3)]) == "fa"
        before = _etag(session)

        assert _write(session, [_item(i, ENGLISH) for i in (4, 5, 6, 7)]) == "en"
        assert _etag(session) != before


def test_an_unchanged_answer_neither_writes_nor_announces() -> None:
    """Sync writes a page per run; the etag must not move for every one of them."""
    with Session(engine) as session:
        _channel(session)
        _write(session, [_item(1, PERSIAN)])
        before = _etag(session)
        channel = session.get(Channel, CHANNEL)
        assert channel is not None
        stamped = channel.updated_at

        assert _write(session, [_item(2, PERSIAN)]) == "fa"
        assert _etag(session) == before
        channel = session.get(Channel, CHANNEL)
        assert channel is not None
        assert channel.updated_at == stamped


def test_posts_for_an_unknown_channel_are_still_written() -> None:
    """The bulk route accepts Posts for a handle nobody created a Channel for."""
    with Session(engine) as session:
        assert bulk_upsert_posts_impl([_item(1, PERSIAN)], session) == 1
        session.commit()


def test_the_sample_reads_a_bounded_depth_of_newest_posts() -> None:
    """The cost cap, pinned: without it a sparse Channel scans its whole history.

    A Persian Post under a thousand newer captionless photos is past the depth,
    so the Channel has nothing readable in view.
    """
    photos = [_item(i, "[photo]", media=PHOTO) for i in range(2, 1002)]
    with Session(engine) as session:
        _channel(session)
        assert _write(session, [_item(1, PERSIAN)]) == "fa"
        assert _write(session, photos) is None


def test_a_posts_only_import_labels_the_channels_it_creates() -> None:
    """The import follows the handles its Posts name, then writes the Posts."""
    from app.services.data_import_export import import_data
    from app.services.follows import get_operator_user_id

    with Session(engine) as session:
        follow_channels(session)  # the operator's default group
        owner = get_operator_user_id(session)
        assert owner is not None
        before = _etag(session)
        import_data(session, {"posts": [_item(1, PERSIAN)]}, user_id=owner)
        session.expire_all()
        channel = session.get(Channel, CHANNEL)
        assert channel is not None
        assert channel.language == "fa"
        assert _etag(session) != before


def test_a_channel_update_carrying_a_language_is_refused_and_changes_nothing(
    client: TestClient, superuser_token_headers: dict[str, str]
) -> None:
    with Session(engine) as session:
        _channel(session, language="fa")

    response = client.put(
        f"{settings.API_V1_STR}/data/channels/{CHANNEL}",
        json={"id": CHANNEL, "name": CHANNEL, "language": "en"},
        headers=superuser_token_headers,
    )
    assert response.status_code == 400
    assert "language" in response.json()["detail"]

    with Session(engine) as session:
        channel = session.exec(select(Channel).where(Channel.id == CHANNEL)).one()
        assert channel.language == "fa"


def test_an_import_carrying_a_language_leaves_it_unchanged() -> None:
    from app.services.data_import_export import _import_channels
    from app.services.follows import get_operator_user_id

    with Session(engine) as session:
        _channel(session, language="fa")
        owner = get_operator_user_id(session)
        assert owner is not None
        _import_channels(
            session,
            [{"id": CHANNEL, "name": CHANNEL, "language": "en"}],
            user_id=owner,
        )
        session.commit()
        session.expire_all()
        channel = session.get(Channel, CHANNEL)
        assert channel is not None
        assert channel.language == "fa"
