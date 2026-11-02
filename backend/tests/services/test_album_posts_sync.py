"""Each message of an Album is its own Post (ALB-01, ADR-046).

Drives one Channel's sync over the saved live pages, faked at the sync's page
fetch, and reads what it stored. The pages hold three Albums: durov 373-381
(nine videos), durov 510-511 (two photos) and TelegramTips 244-245 (two
videos).
"""

from __future__ import annotations

import asyncio
import uuid
from collections.abc import Iterator
from typing import Any

import pytest
from bs4 import BeautifulSoup
from sqlmodel import Session, col, select

from app.core.db import engine
from app.models_tg import Post
from app.services import scraper, sync_orchestrator
from app.services.follows import get_operator_user_id
from app.services.scraper_jobs import ChannelSyncState, SyncJobState
from app.services.walked_ranges import channel_ranges
from tests.utils.setting_groups import add_test_channel
from tests.utils.tg_html import load_live_fixture, recent_page


@pytest.fixture
def session() -> Iterator[Session]:
    with Session(engine) as s:
        yield s


_html = load_live_fixture


def _cut_above(html: str, newest: int) -> str:
    """The page with every widget newer than `newest` removed."""
    soup = BeautifulSoup(html, "html.parser")
    for el in soup.select(".tgme_widget_message"):
        if int(str(el.get("data-post")).split("/")[-1]) > newest:
            wrap = el.find_parent(class_="tgme_widget_message_wrap")
            (wrap or el).decompose()
    return str(soup)


def _sync(
    session: Session, monkeypatch: pytest.MonkeyPatch, html: str
) -> tuple[str, ChannelSyncState, list[dict[str, Any]]]:
    """Sync a new Channel whose newest page is `html` and has nothing below.

    Answers the Channel's name, its sync state and the page's parsed Posts.
    """
    owner = get_operator_user_id(session)
    assert owner is not None
    name = f"alb{uuid.uuid4().hex[:10]}"
    channel = add_test_channel(session, name, name=name, user_id=owner)
    parsed: list[dict[str, Any]] = []

    async def fetch(_ctx: Any, *, before_id: int | None, **_kw: Any) -> Any:
        if before_id is not None:
            return {"posts": [], "latestId": 0, "nextBeforeId": None}
        page = recent_page(html, name)
        parsed.extend(page["posts"])
        return page

    monkeypatch.setattr(sync_orchestrator, "_fetch_one_page", fetch)
    ch_state = ChannelSyncState(channel_id=channel.id, channel_name=name)
    job = SyncJobState(
        job_id=f"alb-{uuid.uuid4().hex[:8]}",
        source="test",
        channels={channel.id: ch_state},
        user_id=str(owner),
        sync_mode="individual",
    )
    asyncio.run(sync_orchestrator.sync_single_channel(job, ch_state, user_id=owner))
    assert ch_state.status == "success", ch_state.error
    return name, ch_state, parsed


def _stored(session: Session, name: str, ids: range) -> list[Post]:
    session.expire_all()
    return list(
        session.exec(
            select(Post)
            .where(Post.channel_name == name, col(Post.post_id).in_(list(ids)))
            .order_by(col(Post.post_id))
        ).all()
    )


@pytest.mark.parametrize(
    ("page", "album"),
    [
        ("durov_400.html", range(373, 382)),
        ("durov_root.html", range(510, 512)),
        ("TelegramTips_246.html", range(244, 246)),
    ],
)
def test_each_message_of_an_album_is_its_own_post(
    session: Session, monkeypatch: pytest.MonkeyPatch, page: str, album: range
) -> None:
    """One Post per message, each knowing its Album by the first id, with its
    own thumbnail; the shared values sit on the first Post alone, and every
    Post has the Album's date.

    **Mutation:** keep one Post per widget and only the first id is stored;
    copy the views onto every Post and a later Post has views.
    """
    name, _state, parsed = _sync(session, monkeypatch, _html(page))

    posts = _stored(session, name, album)
    assert [p.post_id for p in posts] == list(album)
    assert {p.album_id for p in posts} == {album[0]}
    first, *later = posts
    assert first.views_count is not None
    assert first.text and first.media and first.media.get("caption")
    for post in later:
        assert post.media is not None
        assert post.media.get("caption") is None
        assert post.media.get("isMediaOnly") is True
        assert post.views_count is None
        assert post.reaction_counts is None
        assert post.reply_to_post_id is None and post.reply_to is None
        assert post.forwarded_from is None and post.links is None
        assert (post.date, post.timestamp) == (first.date, first.timestamp)
    sources = [p.get("_thumbSourceUrl") for p in parsed if p["id"] in album]
    assert None not in sources and len(set(sources)) == len(album)
    paths = [(p.media or {}).get("thumbApiPath") for p in posts]
    assert None not in paths and len(set(paths)) == len(album)
    assert all((p.media or {}).get("groupedCount") == len(album) for p in posts)


def test_a_video_in_an_album_keeps_its_own_duration(
    session: Session, monkeypatch: pytest.MonkeyPatch
) -> None:
    """**Mutation:** give every Post the first video's duration and 374 reads 7."""
    name, _state, _parsed = _sync(session, monkeypatch, _html("durov_400.html"))

    durations = [
        (p.media or {}).get("durationSec")
        for p in _stored(session, name, range(373, 376))
    ]
    assert durations == [7, 9, 8]


def test_a_newest_page_ending_in_an_album_walks_to_its_last_id(
    session: Session, monkeypatch: pytest.MonkeyPatch
) -> None:
    """**Mutation:** read the newest id off the widgets alone and the walk
    and the latest id stop at 510."""
    page = _cut_above(_html("durov_512.html"), 510)
    name, state, _parsed = _sync(session, monkeypatch, page)

    (walked,) = channel_ranges(session, name)
    assert walked.hi_id == 511
    assert state.new_latest_id == 511


def test_a_directory_sample_keeps_an_album_as_one(
    monkeypatch: pytest.MonkeyPatch,
) -> None:
    """A probe samples what the preview shows, so posts per week and Reach
    read for an unfollowed Channel as before the split.

    **Mutation:** keep every Post as a sample and 511 is one.
    """

    async def fetch(_url: str, **_kw: Any) -> tuple[str, dict[str, Any]]:
        return _html("durov_root.html"), {}

    async def photo(_name: str, url: str | None, **_kw: Any) -> str | None:
        return url

    monkeypatch.setattr(scraper, "fetch_with_retry", fetch)
    monkeypatch.setattr(scraper, "resolve_cached_photo_url", photo)

    info = asyncio.run(scraper.get_channel_info("durov", with_samples=True))

    ids = [p["id"] for p in info["samples"]]
    assert 510 in ids and 511 not in ids
    assert len(ids) == 20


def _photo_first(html: str) -> str:
    """durov's nine-video Album with its first video swapped for a photo."""
    photo = BeautifulSoup(_html("durov_root.html"), "html.parser").select_one(
        "a.grouped_media_wrap"
    )
    assert photo is not None
    photo["href"] = "https://t.me/durov/373?single"
    soup = BeautifulSoup(html, "html.parser")
    first = soup.select_one("a.grouped_media_wrap")
    assert first is not None
    first.replace_with(photo)
    return str(soup)


def test_the_first_post_of_a_mixed_album_is_its_own_photo(
    session: Session, monkeypatch: pytest.MonkeyPatch
) -> None:
    """**Mutation:** read the first Post's media off the whole wrap and it is
    a video with the next video's duration and thumbnail."""
    name, _state, parsed = _sync(
        session, monkeypatch, _photo_first(_html("durov_400.html"))
    )

    first, second = _stored(session, name, range(373, 375))
    assert first.media is not None and second.media is not None
    assert "video" not in first.media["kinds"] and "photo" in first.media["kinds"]
    assert first.media.get("durationSec") is None
    assert second.media["kinds"] == ["grouped", "video"]
    sources = {p["id"]: p.get("_thumbSourceUrl") for p in parsed}
    assert sources[373] and str(sources[373]).endswith(".jpg")
    assert sources[373] != sources[374]
