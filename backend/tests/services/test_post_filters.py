"""SQL parity for the ported Posts-tab view filters.

Each case asserts that `apply_post_filters` selects exactly the posts the
frontend `buildFilteredPostsFromRaw` would keep for the same filter value. The
media cases are the parity-risky ones: `media` is a JSON column and
`media_only` folds together a JSON flag, a sentinel text, and a regex.
"""

from __future__ import annotations

from typing import Any

from sqlmodel import Session, select

from app.core.db import engine
from app.models_tg import Post
from app.services.post_filters import PostFilters, apply_post_filters


def _add(session: Session, post_id: int, **kw: Any) -> None:
    session.add(
        Post(
            channel_name=kw.pop("channel_name", "carrier"),
            post_id=post_id,
            text=kw.pop("text", f"post {post_id}"),
            timestamp=kw.pop("timestamp", 1000 + post_id),
            **kw,
        )
    )


def _ids(session: Session, filters: PostFilters, **kw: Any) -> set[int]:
    stmt = apply_post_filters(select(Post), filters, **kw)
    return {p.post_id for p in session.exec(stmt).all()}


def test_keyword_matches_text_or_channel_case_insensitively() -> None:
    with Session(engine) as session:
        _add(session, 1, text="Cheap VPN here")
        _add(session, 2, text="unrelated", channel_name="vpndaily")
        _add(session, 3, text="nothing", channel_name="carrier")
        session.commit()
        # channel_name filter must also see channel 2's row via its name.
        assert _ids(session, PostFilters(keyword="vpn")) == {1, 2}
        assert _ids(session, PostFilters(keyword="VPN")) == {1, 2}
        assert _ids(session, PostFilters(keyword="   ")) == {1, 2, 3}


def test_forwarded_states() -> None:
    with Session(engine) as session:
        _add(session, 1, forwarded_from=None)
        _add(session, 2, forwarded_from="SourceA")
        _add(session, 3, forwarded_from="FollowedSrc")
        session.commit()
        assert _ids(session, PostFilters(forwarded="all")) == {1, 2, 3}
        assert _ids(session, PostFilters(forwarded="forwarded")) == {2, 3}
        assert _ids(session, PostFilters(forwarded="original")) == {1}
        # unfollowed_forwarded excludes forwards from followed channels
        # (compared case-insensitively, matching the frontend).
        followed = frozenset({"followedsrc"})
        assert _ids(
            session,
            PostFilters(forwarded="unfollowed_forwarded"),
            followed_names=followed,
        ) == {2}


def test_media_text_only_vs_media_only_kinds() -> None:
    with Session(engine) as session:
        _add(session, 1, text="plain text", media=None)
        _add(session, 2, text="empty kinds", media={"kinds": []})
        _add(session, 3, text="a photo caption", media={"kinds": ["photo"]})
        _add(session, 4, text="a video caption", media={"kinds": ["video"]})
        session.commit()
        assert _ids(session, PostFilters(media="text_only")) == {1, 2}
        assert _ids(session, PostFilters(media="photo")) == {3}
        assert _ids(session, PostFilters(media="video")) == {4}
        assert _ids(session, PostFilters(media="all")) == {1, 2, 3, 4}


def test_media_only_three_ways() -> None:
    """media_only fires on the JSON flag, the sentinel text, or the regex."""
    with Session(engine) as session:
        # (a) explicit isMediaOnly flag
        _add(
            session,
            1,
            text="has caption",
            media={"kinds": ["photo"], "isMediaOnly": True},
        )
        # (b) sentinel placeholder text + media present
        _add(session, 2, text="[Media/No Text Content]", media={"kinds": ["video"]})
        # (c) regex over trimmed text, media present
        _add(session, 3, text="  [Photo Album] extra", media={"kinds": ["photo"]})
        # not media-only: has media but a real caption and no flag
        _add(session, 4, text="a normal caption", media={"kinds": ["photo"]})
        # not media-only: regex matches but there is no media at all
        _add(session, 5, text="[photo]", media=None)
        session.commit()
        assert _ids(session, PostFilters(media="media_only")) == {1, 2, 3}


def test_media_grouped_by_kind_or_count() -> None:
    with Session(engine) as session:
        _add(session, 1, media={"kinds": ["grouped", "photo"]})
        _add(session, 2, media={"kinds": ["photo"], "groupedCount": 3})
        _add(session, 3, media={"kinds": ["photo"], "groupedCount": 1})
        _add(session, 4, media={"kinds": ["photo"]})
        session.commit()
        assert _ids(session, PostFilters(media="grouped")) == {1, 2}


def test_link_preview_kind() -> None:
    with Session(engine) as session:
        _add(session, 1, media={"kinds": ["link_preview"]})
        _add(session, 2, media={"kinds": ["photo"]})
        session.commit()
        assert _ids(session, PostFilters(media="link_preview")) == {1}


def test_combined_filters_intersect() -> None:
    with Session(engine) as session:
        _add(
            session,
            1,
            text="vpn news",
            forwarded_from="src",
            media={"kinds": ["photo"]},
        )
        _add(
            session, 2, text="vpn news", forwarded_from=None, media={"kinds": ["photo"]}
        )
        _add(session, 3, text="other", forwarded_from="src", media={"kinds": ["photo"]})
        session.commit()
        got = _ids(
            session,
            PostFilters(keyword="vpn", forwarded="forwarded", media="photo"),
        )
        assert got == {1}


def test_noop_filter_selects_everything() -> None:
    with Session(engine) as session:
        for i in range(3):
            _add(session, i)
        session.commit()
        assert PostFilters().is_noop() is True
        assert _ids(session, PostFilters()) == {0, 1, 2}
