"""Discover candidate aggregation, ported from the frontend implementation.

These cases mirror frontend/src/lib/posts/discover-candidates.test.ts. The
aggregation moved server-side; the counting semantics must not change with it.
"""

from __future__ import annotations

from typing import Any

from sqlmodel import Session

from app.core.db import engine
from app.models_tg import Post
from app.services.discover import (
    compute_discover_candidates,
    extract_mentions,
    post_references,
)
from tests.utils.setting_groups import add_test_channel


def _post(
    post_id: int,
    channel_name: str,
    timestamp: int,
    *,
    text: str | None = None,
    forwarded_from: str | None = None,
    forwarded_from_name: str | None = None,
    links: list[dict[str, Any]] | None = None,
    reply_to: dict[str, Any] | None = None,
) -> Post:
    return Post(
        channel_name=channel_name,
        post_id=post_id,
        text=text if text is not None else f"Post {post_id}",
        timestamp=timestamp,
        forwarded_from=forwarded_from,
        forwarded_from_name=forwarded_from_name,
        links=links,
        reply_to=reply_to,
    )


def _run(
    posts: list[Post],
    *,
    channels: list[str] | None = None,
    followed: list[str] | None = None,
    signals: set[str] | None = None,
) -> dict[str, Any]:
    with Session(engine) as session:
        for p in posts:
            session.add(p)
        session.commit()
        for name in followed or []:
            add_test_channel(session, name, name=name)
        session.commit()

        scope = channels if channels is not None else ["carrier"]
        return compute_discover_candidates(
            session,
            channel_names=scope,
            signals=signals,  # type: ignore[arg-type]
        )


# --- signal kinds ---------------------------------------------------------


def test_counts_forwards_mentions_and_links_separately() -> None:
    result = _run(
        [
            _post(
                1,
                "carrier",
                1000,
                forwarded_from="alpha_news",
                forwarded_from_name="Alpha News",
            ),
            _post(2, "carrier", 1100, text="shoutout to @alpha_news"),
            _post(3, "carrier", 1200, text="join https://t.me/alpha_news"),
        ]
    )

    candidates = result["candidates"]
    assert len(candidates) == 1
    assert candidates[0]["counts"] == {"forward": 1, "mention": 1, "link": 1}
    assert candidates[0]["total"] == 3
    assert candidates[0]["displayName"] == "Alpha News"


def test_mention_and_link_in_same_post_each_count_once() -> None:
    result = _run(
        [
            _post(
                1,
                "carrier",
                1000,
                text="@alpha_news is great, join https://t.me/alpha_news now",
            )
        ]
    )
    assert result["candidates"][0]["counts"] == {
        "forward": 0,
        "mention": 1,
        "link": 1,
    }


def test_repeated_mention_in_one_post_counts_once() -> None:
    result = _run(
        [_post(1, "carrier", 1000, text="@alpha_news @alpha_news @alpha_news")]
    )
    assert result["candidates"][0]["counts"]["mention"] == 1


def test_link_in_both_text_and_links_counts_once() -> None:
    result = _run(
        [
            _post(
                1,
                "carrier",
                1000,
                text="join https://t.me/alpha_news",
                links=[{"url": "https://t.me/alpha_news", "channel": "alpha_news"}],
            )
        ]
    )
    assert result["candidates"][0]["counts"]["link"] == 1


def test_masked_links_are_discovered() -> None:
    result = _run(
        [
            _post(
                1,
                "carrier",
                1000,
                text="click here",
                links=[{"url": "https://t.me/alpha_news", "channel": "alpha_news"}],
            )
        ]
    )
    assert result["candidates"][0]["counts"]["link"] == 1
    assert result["candidates"][0]["name"] == "alpha_news"


def test_disabled_kinds_are_not_counted() -> None:
    result = _run(
        [
            _post(1, "carrier", 1000, forwarded_from="alpha_news"),
            _post(2, "carrier", 1100, text="see @alpha_news"),
        ],
        signals={"forward"},
    )
    assert result["candidates"][0]["counts"] == {
        "forward": 1,
        "mention": 0,
        "link": 0,
    }


def test_no_signals_enabled_yields_no_candidates() -> None:
    result = _run([_post(1, "carrier", 1000, text="see @alpha_news")], signals=set())
    assert result["candidates"] == []


# --- scope counts ---------------------------------------------------------


def test_scope_counts_cover_all_kinds_even_when_signals_disabled() -> None:
    result = _run(
        [
            _post(1, "carrier", 1000, forwarded_from="alpha_news"),
            _post(2, "carrier", 1100, text="see @beta_news"),
            _post(3, "carrier", 1200, text="join https://t.me/gamma_news"),
        ],
        signals={"forward"},
    )
    assert result["scopeCounts"] == {
        "forwardPosts": 1,
        "mentionPosts": 1,
        "linkPosts": 1,
    }


# --- self references ------------------------------------------------------


def test_channel_referencing_itself_is_excluded() -> None:
    result = _run(
        [
            _post(
                1,
                "carrier",
                1000,
                text="we are @carrier — visit https://t.me/carrier",
                forwarded_from="carrier",
            )
        ]
    )
    assert result["candidates"] == []


def test_self_reference_is_case_insensitive() -> None:
    result = _run([_post(1, "carrier", 1000, text="we are @CARRIER")])
    assert result["candidates"] == []


# --- aggregation ----------------------------------------------------------


def test_seen_in_breaks_down_counts_per_carrier() -> None:
    result = _run(
        [
            _post(1, "carrier", 1000, text="see @alpha_news"),
            _post(2, "carrier", 1100, text="see @alpha_news"),
            _post(3, "other", 1200, text="see @alpha_news"),
        ],
        channels=["carrier", "other"],
    )

    candidate = result["candidates"][0]
    assert candidate["total"] == 3
    assert candidate["seenInCount"] == 2
    # Sorted by total desc, then channel name.
    assert [s["channelName"] for s in candidate["seenIn"]] == ["carrier", "other"]
    assert candidate["seenIn"][0]["total"] == 2


def test_handles_dedupe_case_insensitively_across_kinds() -> None:
    result = _run(
        [
            _post(1, "carrier", 1000, forwarded_from="Alpha_News"),
            _post(2, "carrier", 1100, text="see @alpha_news"),
            _post(3, "carrier", 1200, text="https://t.me/ALPHA_NEWS"),
        ]
    )
    assert len(result["candidates"]) == 1
    assert result["candidates"][0]["total"] == 3


def test_is_followed_reflects_channel_membership() -> None:
    result = _run(
        [
            _post(1, "carrier", 1000, text="see @known_channel"),
            _post(2, "carrier", 1100, text="see @unknown_channel"),
        ],
        followed=["known_channel"],
    )
    by_name = {c["name"]: c for c in result["candidates"]}
    assert by_name["known_channel"]["isFollowed"] is True
    assert by_name["unknown_channel"]["isFollowed"] is False


def test_last_seen_and_sample_post_track_the_newest() -> None:
    result = _run(
        [
            _post(1, "carrier", 1000, text="see @alpha_news"),
            _post(2, "carrier", 5000, text="see @alpha_news"),
        ]
    )
    candidate = result["candidates"][0]
    assert candidate["lastSeen"] == 5000
    assert candidate["samplePost"]["postId"] == 2


def test_candidates_sort_by_total_desc() -> None:
    result = _run(
        [
            _post(1, "carrier", 1000, text="see @alpha_news"),
            _post(2, "carrier", 1100, text="see @alpha_news"),
            _post(3, "carrier", 1200, text="see @beta_news"),
        ]
    )
    assert [c["name"] for c in result["candidates"]] == ["alpha_news", "beta_news"]


def test_empty_scope_returns_empty_result() -> None:
    result = _run([_post(1, "carrier", 1000, text="see @alpha_news")], channels=[])
    assert result["candidates"] == []
    assert result["scopeCounts"] == {
        "forwardPosts": 0,
        "mentionPosts": 0,
        "linkPosts": 0,
    }


def test_date_scope_excludes_out_of_range_posts() -> None:
    with Session(engine) as session:
        session.add(_post(1, "carrier", 1000, text="see @alpha_news"))
        session.add(_post(2, "carrier", 9000, text="see @beta_news"))
        session.commit()
        result = compute_discover_candidates(
            session,
            channel_names=["carrier"],
            start_date=5000,
            end_date=10000,
        )
    assert [c["name"] for c in result["candidates"]] == ["beta_news"]


# --- extractor edge cases -------------------------------------------------


def test_email_addresses_are_not_mentions() -> None:
    """The false-positive guard: `@` must not follow a word character."""
    assert extract_mentions("contact user@example.com today") == set()


def test_path_at_is_not_a_mention() -> None:
    assert extract_mentions("see foo/@alpha_news") == set()


def test_short_handles_are_rejected() -> None:
    assert extract_mentions("@abcd") == set()
    assert extract_mentions("@abcde") == {"abcde"}


def test_reserved_paths_are_not_candidates() -> None:
    post = _post(
        1,
        "carrier",
        1000,
        text="https://t.me/joinchat/AAAA https://t.me/addstickers/foo",
    )
    assert post_references(post) == {}


def test_invite_links_are_excluded() -> None:
    result = _run([_post(1, "carrier", 1000, text="https://t.me/joinchat/XYZabc123")])
    assert result["candidates"] == []


# --- replies as a discovery signal ----------------------------------------


def test_cross_channel_reply_counts_as_a_link() -> None:
    """Replying into another channel is a t.me reference like any other."""
    post = _post(
        1,
        "carrier",
        1_000,
        text="no links in the body",
        reply_to={"channel": "otherchannel", "url": "https://t.me/otherchannel/5"},
    )
    refs = post_references(post)
    assert refs == {"otherchannel": {"link"}}


def test_same_channel_reply_is_not_a_candidate() -> None:
    """The common case: a thread inside one channel discovers nothing."""
    post = _post(
        1,
        "carrier",
        1_000,
        reply_to={"channel": "carrier", "url": "https://t.me/carrier/5"},
    )
    assert post_references(post) == {}


def test_reply_without_a_resolvable_channel_is_ignored() -> None:
    """Private (`/c/…`) parents store no channel, and must not invent one."""
    post = _post(1, "carrier", 1_000, reply_to={"url": "https://t.me/c/123/5"})
    assert post_references(post) == {}


def test_reply_channel_reaches_the_aggregated_candidates() -> None:
    result = _run(
        [
            _post(
                1,
                "carrier",
                1_000,
                text="body",
                reply_to={"channel": "replytarget"},
            )
        ]
    )
    names = {c["name"].lower() for c in result["candidates"]}
    assert "replytarget" in names
