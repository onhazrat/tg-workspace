"""Albums stored as one Post before ALB-01 are split into their Posts (ALB-02).

Seeds an Album the way the sync stored it before ALB-01, one Post with a photo
count and no Album membership, fakes the sync's page fetch with the saved live
pages, and runs the split job: durov 510-511 (two photos) and durov 373-381
(nine videos).
"""

from __future__ import annotations

import asyncio
import uuid
from collections.abc import Iterator
from typing import Any

import pytest
from sqlmodel import Session, col, select

from app.core.db import engine
from app.core.request_recording import RequestKind, RequestKindDisabled
from app.models_tg import Channel, Post
from app.services import sync_orchestrator
from app.services.channels import channel_sync_claim_holder, try_claim_channel_sync
from app.services.follows import get_operator_user_id
from app.services.posts import bulk_upsert_posts_impl
from app.services.quota import Budget, QuotaCeilingReached
from tests.utils.setting_groups import add_test_channel
from tests.utils.tg_html import load_live_fixture, recent_page

DAY_MS = 24 * 60 * 60 * 1000


@pytest.fixture
def session() -> Iterator[Session]:
    with Session(engine) as s:
        yield s


@pytest.fixture
def name(session: Session) -> str:
    owner = get_operator_user_id(session)
    assert owner is not None
    handle = f"spl{uuid.uuid4().hex[:10]}"
    add_test_channel(session, handle, name=handle, user_id=owner)
    return handle


def _page(file: str, name: str, *, age_ms: int = 0) -> list[dict[str, Any]]:
    return list(recent_page(load_live_fixture(file), name, age_ms=age_ms)["posts"])


def _store_as_one_post(
    session: Session,
    name: str,
    posts: list[dict[str, Any]],
    first: int,
    **media: Any,
) -> None:
    """The Album's first Post as the sync stored it before ALB-01, seen at 7
    views, with `media` over what the page shows."""
    (post,) = [dict(p) for p in posts if p["id"] == first]
    post.pop("albumId")
    post["media"] = {**post["media"], "viewsCount": 7, **media}
    bulk_upsert_posts_impl(sync_orchestrator._posts_to_save(name, [post]), session)
    session.commit()


def _fake_pages(
    monkeypatch: pytest.MonkeyPatch, pages: dict[int, list[dict[str, Any]] | Exception]
) -> list[int | None]:
    """Answer each `before_id` with its page, or raise its error; record the asks."""
    asked: list[int | None] = []

    async def fetch(_ctx: Any, *, before_id: int | None, **_kw: Any) -> Any:
        asked.append(before_id)
        page = pages.get(before_id or 0, [])
        if isinstance(page, Exception):
            raise page
        return {"posts": page, "latestId": 0, "nextBeforeId": None}

    monkeypatch.setattr(sync_orchestrator, "_fetch_one_page", fetch)
    return asked


def _split() -> sync_orchestrator.AlbumSplit:
    return asyncio.run(sync_orchestrator.split_stored_albums())


def _stored(session: Session, name: str) -> dict[int, Post]:
    session.expire_all()
    rows = session.exec(select(Post).where(col(Post.channel_name) == name)).all()
    return {p.post_id: p for p in rows}


def test_a_stored_album_is_split_into_its_posts(
    session: Session, monkeypatch: pytest.MonkeyPatch, name: str
) -> None:
    """**Mutation:** skip the Album's first Post on the write and 510 keeps no
    membership."""
    root = _page("durov_root.html", name)
    _store_as_one_post(session, name, root, 510)
    asked = _fake_pages(monkeypatch, {512: root})

    report = _split()

    assert (report.split, report.left) == (1, 0)
    assert asked == [512]
    posts = _stored(session, name)
    assert sorted(posts) == [510, 511]
    first, later = posts[510], posts[511]
    assert (first.album_id, later.album_id) == (510, 510)
    assert first.views_count == 7 and first.text
    assert later.views_count is None and later.reaction_counts is None
    assert later.reply_to_post_id is None and later.forwarded_from is None
    assert later.links is None and (later.media or {}).get("isMediaOnly") is True
    assert (later.media or {}).get("thumbApiPath")
    assert (later.media or {}).get("albumPlace") == 2
    assert later.timestamp == first.timestamp


def test_a_second_run_writes_nothing(
    session: Session, monkeypatch: pytest.MonkeyPatch, name: str
) -> None:
    """**Mutation:** select Albums by their photo count alone, split or not,
    and the second run walks 510's page again."""
    root = _page("durov_root.html", name)
    _store_as_one_post(session, name, root, 510)
    asked = _fake_pages(monkeypatch, {512: root})
    _split()

    again = _split()

    assert (again.albums, again.split, again.left) == (0, 0, 0)
    assert asked == [512]


def _without_thumb(name: str) -> list[dict[str, Any]]:
    """durov's root page with 511's thumbnail gone."""
    posts = _page("durov_root.html", name)
    for p in posts:
        if p["id"] == 511:
            p.pop("_thumbSourceUrl")
    return posts


def _store_unfollowed(session: Session, channel_id: str, name: str) -> None:
    """A Channel row nobody follows, holding a stored Album of its own."""
    session.add(Channel(id=channel_id, name=name))
    session.commit()
    _store_as_one_post(session, name, _page("durov_root.html", name), 510)


@pytest.mark.parametrize(
    "answer",
    [
        sync_orchestrator.SyncScrapeError("HTTP 502"),
        "durov_400.html",
        _without_thumb,
    ],
    ids=["page fails", "page no longer shows it", "a photo has no thumbnail"],
)
def test_an_album_whose_page_fails_or_no_longer_shows_it_stays_one_post(
    session: Session,
    monkeypatch: pytest.MonkeyPatch,
    name: str,
    answer: Any,
) -> None:
    """No Post is made without its thumbnail.

    **Mutation:** let a page error end the job and it raises; count only
    failed pages as left and the moved page leaves nothing; split an Album
    whatever its thumbnails and 511 is written without one.
    """
    _store_as_one_post(session, name, _page("durov_root.html", name), 510)
    if isinstance(answer, str):
        page = _page(answer, name)
    elif isinstance(answer, Exception):
        page = answer
    else:
        page = answer(name)
    _fake_pages(monkeypatch, {512: page})

    report = _split()

    assert (report.split, report.left) == (0, 1)
    posts = _stored(session, name)
    assert list(posts) == [510] and posts[510].album_id is None


def test_one_page_splits_every_album_it_holds(
    session: Session, monkeypatch: pytest.MonkeyPatch, name: str
) -> None:
    """**Mutation:** fetch a page per Album and 373's page is asked for too."""
    both = _page("durov_root.html", name) + _page("durov_400.html", name)
    _store_as_one_post(session, name, both, 510)
    _store_as_one_post(session, name, both, 373)
    asked = _fake_pages(monkeypatch, {512: both})

    report = _split()

    assert (report.split, report.left) == (2, 0)
    assert asked == [512]
    posts = _stored(session, name)
    assert [p for p in posts if posts[p].album_id == 373] == list(range(373, 382))


def test_an_interrupted_run_resumes_without_redoing_finished_albums(
    session: Session, monkeypatch: pytest.MonkeyPatch, name: str
) -> None:
    """**Mutation:** select Albums by their photo count alone, split or not,
    and the resumed run walks 510's page again."""
    root, older = _page("durov_root.html", name), _page("durov_400.html", name)
    _store_as_one_post(session, name, root, 510)
    _store_as_one_post(session, name, older, 373)
    _fake_pages(monkeypatch, {512: root, 382: RuntimeError("killed")})
    with pytest.raises(RuntimeError):
        _split()

    asked = _fake_pages(monkeypatch, {512: root, 382: older})
    report = _split()

    assert asked == [382]
    assert (report.split, report.left) == (1, 0)
    assert {p.album_id for p in _stored(session, name).values()} == {510, 373}


def test_only_albums_within_retention_are_walked(
    session: Session, monkeypatch: pytest.MonkeyPatch, name: str
) -> None:
    """**Mutation:** drop the retention floor and the old Album's page is asked
    for."""
    days = sync_orchestrator.settings.RETENTION_POST_DAYS_DEFAULT
    _store_as_one_post(session, name, _page("durov_root.html", name), 510)
    old = _page("durov_400.html", name, age_ms=(days + 1) * DAY_MS)
    _store_as_one_post(session, name, old, 373)
    asked = _fake_pages(monkeypatch, {512: _page("durov_root.html", name)})

    report = _split()

    assert asked == [512]
    assert (report.albums, report.split, report.left) == (1, 1, 0)


def test_past_the_ceiling_nothing_is_fetched(
    session: Session, monkeypatch: pytest.MonkeyPatch, name: str
) -> None:
    """The split pays from the auto Budget like a scheduled sync, and stops at
    its ceiling.

    **Mutation:** skip the ceiling check and 510's page is asked for.
    """
    _store_as_one_post(session, name, _page("durov_root.html", name), 510)
    asked = _fake_pages(monkeypatch, {512: _page("durov_root.html", name)})

    def refuse(*_a: Any, **_kw: Any) -> None:
        raise QuotaCeilingReached(Budget.AUTO_SYNC)

    monkeypatch.setattr(sync_orchestrator, "assert_within_ceiling", refuse)

    report = _split()

    assert asked == []
    assert (report.split, report.left) == (0, 1)


def test_a_dry_run_counts_the_albums_and_fetches_nothing(
    session: Session, monkeypatch: pytest.MonkeyPatch, name: str
) -> None:
    """**Mutation:** ignore `dry_run` and 510's page is asked for."""
    _store_as_one_post(session, name, _page("durov_root.html", name), 510)
    asked = _fake_pages(monkeypatch, {512: _page("durov_root.html", name)})

    report = asyncio.run(sync_orchestrator.split_stored_albums(dry_run=True))

    assert asked == []
    assert (report.albums, report.split, report.left) == (1, 0, 0)


def test_a_page_showing_part_of_an_album_leaves_it(
    session: Session, monkeypatch: pytest.MonkeyPatch, name: str
) -> None:
    """**Mutation:** split an Album whatever its stored size and 510 is split
    with one photo missing for good."""
    root = _page("durov_root.html", name)
    _store_as_one_post(session, name, root, 510, groupedCount=3)
    _fake_pages(monkeypatch, {513: root})

    report = _split()

    assert (report.split, report.left) == (0, 1)
    assert list(_stored(session, name)) == [510]


def test_a_name_held_by_two_channels_is_walked_once(
    session: Session, monkeypatch: pytest.MonkeyPatch, name: str
) -> None:
    """`Channel.name` is not unique.

    **Mutation:** join the Posts to their Channels by name and the Album is
    counted and walked twice.
    """
    root = _page("durov_root.html", name)
    _store_as_one_post(session, name, root, 510)
    session.add(Channel(id=f"{name}-twin", name=name))
    session.commit()
    asked = _fake_pages(monkeypatch, {512: root})

    report = _split()

    assert asked == [512]
    assert (report.albums, report.split) == (1, 1)


def test_an_unfollowed_channel_is_not_walked(
    session: Session, monkeypatch: pytest.MonkeyPatch
) -> None:
    """ADR-046 leaves Channels nobody follows to retention.

    **Mutation:** walk them too and the job fails on a Channel with no payer.
    """
    _store_unfollowed(session, "unfollowed-alb", "unfollowed-alb")
    asked = _fake_pages(monkeypatch, {})

    report = _split()

    assert asked == []
    assert (report.albums, report.split, report.left) == (0, 0, 0)


def test_a_channel_another_sync_holds_is_left_and_the_claim_given_back(
    session: Session, monkeypatch: pytest.MonkeyPatch, name: str
) -> None:
    """One sync per Channel at a time, and the split takes the same claim.

    **Mutation:** skip the claim and the held Channel's page is asked for;
    keep the claim after the walk and the Channel stays held.
    """
    other = f"{name}x"
    add_test_channel(session, other, name=other, user_id=get_operator_user_id(session))
    root = _page("durov_root.html", name)
    _store_as_one_post(session, name, root, 510)
    _store_as_one_post(session, other, _page("durov_root.html", other), 510)
    assert try_claim_channel_sync(other, holder="a-sync")
    asked = _fake_pages(monkeypatch, {512: root})

    report = _split()

    assert asked == [512]
    assert (report.split, report.left) == (1, 1)
    assert channel_sync_claim_holder(name) is None
    assert channel_sync_claim_holder(other) == "a-sync"


def test_a_walk_stops_at_the_syncs_page_cap(
    session: Session, monkeypatch: pytest.MonkeyPatch, name: str
) -> None:
    """**Mutation:** drop the cap and 373's page is asked for too."""
    root, older = _page("durov_root.html", name), _page("durov_400.html", name)
    _store_as_one_post(session, name, root, 510)
    _store_as_one_post(session, name, older, 373)
    asked = _fake_pages(monkeypatch, {512: root, 382: older})
    monkeypatch.setattr(sync_orchestrator.settings, "SCRAPER_ITERATION_LIMIT", 1)

    report = _split()

    assert asked == [512]
    assert (report.split, report.left) == (1, 1)


def test_a_disabled_auto_kind_refuses_before_any_page(
    session: Session, monkeypatch: pytest.MonkeyPatch, name: str
) -> None:
    """**Mutation:** skip the kind check and 510's page is asked for."""
    _store_as_one_post(session, name, _page("durov_root.html", name), 510)
    asked = _fake_pages(monkeypatch, {512: _page("durov_root.html", name)})

    def refuse(kind: RequestKind) -> None:
        raise RequestKindDisabled(kind)

    monkeypatch.setattr(sync_orchestrator, "assert_kind_enabled", refuse)

    with pytest.raises(RequestKindDisabled):
        _split()
    assert asked == []
