"""Per-handle metadata probes (IDEA-011 D9).

The cases that matter are the ones where a wrong answer is *permanent*: a probe
verdict is cached indefinitely, so most of this file is about which fetch
outcomes are allowed to become a verdict at all.
"""

from __future__ import annotations

from datetime import timedelta

from sqlmodel import Session, select

from app.core.db import engine
from app.models_tg import DiscoverHandleProbe, Post, utc_now
from app.services.discover_probes import (
    clear_probes,
    handles_needing_probe,
    list_probes,
    probe_map,
    record_probe_result,
)
from app.services.discover_reports import create_report, get_report
from app.services.post_filters import PostFilters

OK_PAGE = {
    "isTelegramPage": True,
    "isUnavailableOnWebView": False,
    "kind": "channel",
    "displayName": "Alpha News",
    "subscribers": "12.3K",
    "latestId": 42,
}

BOT_PAGE = {
    "isTelegramPage": True,
    "isUnavailableOnWebView": True,
    "kind": "bot",
    "displayName": "Some Bot",
}


def _seed(session: Session, sources: list[str]) -> None:
    for i, source in enumerate(sources):
        session.add(
            Post(
                channel_name="carrier",
                post_id=i,
                text=f"Post {i}",
                timestamp=1000 + i,
                forwarded_from=source,
            )
        )
    session.commit()


# --------------------------------------------------------------------------- #
# What may become a verdict                                                     #
# --------------------------------------------------------------------------- #


def test_a_parsed_page_becomes_a_verdict() -> None:
    with Session(engine) as session:
        result = record_probe_result(session, "alpha_news", OK_PAGE)
        assert result["status"] == "ok"
        assert result["kind"] == "channel"
        assert result["subscribers"] == "12.3K"
        assert result["checkedAt"] is not None


def test_an_unfollowable_page_becomes_a_verdict() -> None:
    with Session(engine) as session:
        result = record_probe_result(session, "helper_bot", BOT_PAGE)
        assert result["status"] == "unavailable"
        assert result["kind"] == "bot"


def test_a_failed_fetch_never_becomes_a_verdict() -> None:
    """The core rule: a timeout must not be cached as "not followable".

    Caching it would hide a real channel from every future report, permanently
    and with nothing on screen to suggest anything went wrong.
    """
    with Session(engine) as session:
        result = record_probe_result(session, "alpha_news", None, error="timeout")
        assert result["status"] == "unknown"
        assert result["attempts"] == 1
        assert result["lastError"] == "timeout"
        assert result["checkedAt"] is None


def test_a_non_telegram_response_never_becomes_a_verdict() -> None:
    """A proxy block page parses fine and looks exactly like an empty handle."""
    with Session(engine) as session:
        result = record_probe_result(
            session,
            "alpha_news",
            {"isTelegramPage": False, "isUnavailableOnWebView": True},
        )
        assert result["status"] == "unknown"
        assert result["attempts"] == 1


def test_repeated_failures_accumulate_attempts() -> None:
    with Session(engine) as session:
        record_probe_result(session, "alpha_news", None, error="timeout")
        result = record_probe_result(session, "alpha_news", None, error="timeout")
        assert result["attempts"] == 2


def test_a_verdict_clears_the_failure_history() -> None:
    """Backoff throttles retries of an *unresolved* handle; this one resolved."""
    with Session(engine) as session:
        record_probe_result(session, "alpha_news", None, error="timeout")
        result = record_probe_result(session, "alpha_news", OK_PAGE)
        assert result["status"] == "ok"
        assert result["attempts"] == 0
        assert result["lastError"] is None


def test_an_unrecognized_kind_falls_back_to_unknown() -> None:
    with Session(engine) as session:
        result = record_probe_result(
            session,
            "alpha_news",
            {**OK_PAGE, "kind": "supergroup_channel_thing"},
        )
        assert result["kind"] == "unknown"
        # The structural verdict is unaffected by the cosmetic field.
        assert result["status"] == "ok"


def test_handles_are_normalized_like_candidate_names() -> None:
    with Session(engine) as session:
        record_probe_result(session, "@Alpha_News", OK_PAGE)
        assert probe_map(session, {"alpha_news"})["alpha_news"]["status"] == "ok"


# --------------------------------------------------------------------------- #
# What the sweep re-fetches                                                     #
# --------------------------------------------------------------------------- #


def test_unprobed_handles_are_queued() -> None:
    with Session(engine) as session:
        assert handles_needing_probe(session, ["alpha_news", "beta_daily"]) == [
            "alpha_news",
            "beta_daily",
        ]


def test_resolved_handles_are_never_requeued() -> None:
    """The whole point of the cache: one fetch per handle, forever."""
    with Session(engine) as session:
        record_probe_result(session, "alpha_news", OK_PAGE)
        record_probe_result(session, "helper_bot", BOT_PAGE)
        assert handles_needing_probe(session, ["alpha_news", "helper_bot"]) == []


def test_ranking_order_is_preserved() -> None:
    """Top candidates must resolve first, not after the single-reference tail."""
    with Session(engine) as session:
        ranked = ["gamma", "alpha", "beta"]
        assert handles_needing_probe(session, ranked) == ranked


def test_duplicate_handles_are_probed_once() -> None:
    with Session(engine) as session:
        assert handles_needing_probe(session, ["alpha", "@Alpha", "alpha"]) == ["alpha"]


def test_a_failed_handle_waits_for_its_backoff() -> None:
    with Session(engine) as session:
        record_probe_result(session, "alpha_news", None, error="timeout")
        assert handles_needing_probe(session, ["alpha_news"]) == []


def test_a_failed_handle_is_retried_once_the_backoff_elapses() -> None:
    with Session(engine) as session:
        record_probe_result(session, "alpha_news", None, error="timeout")
        later = utc_now() + timedelta(days=2)
        assert handles_needing_probe(session, ["alpha_news"], now=later) == [
            "alpha_news"
        ]


def test_backoff_grows_with_consecutive_failures() -> None:
    with Session(engine) as session:
        for _ in range(3):
            record_probe_result(session, "alpha_news", None, error="timeout")
        soon = utc_now() + timedelta(minutes=20)
        assert handles_needing_probe(session, ["alpha_news"], now=soon) == []


# --------------------------------------------------------------------------- #
# Recheck                                                                       #
# --------------------------------------------------------------------------- #


def test_recheck_requeues_a_resolved_handle() -> None:
    """The escape hatch that makes an indefinite cache safe to have."""
    with Session(engine) as session:
        record_probe_result(session, "alpha_news", BOT_PAGE)
        assert handles_needing_probe(session, ["alpha_news"]) == []

        assert clear_probes(session, ["@Alpha_News"]) == ["alpha_news"]
        assert handles_needing_probe(session, ["alpha_news"]) == ["alpha_news"]


def test_recheck_of_an_unprobed_handle_is_not_an_error() -> None:
    with Session(engine) as session:
        assert clear_probes(session, ["never_seen"]) == []


def test_recheck_can_overturn_a_verdict() -> None:
    with Session(engine) as session:
        record_probe_result(session, "alpha_news", BOT_PAGE)
        clear_probes(session, ["alpha_news"])
        result = record_probe_result(session, "alpha_news", OK_PAGE)
        assert result["status"] == "ok"


# --------------------------------------------------------------------------- #
# The read-time join                                                            #
# --------------------------------------------------------------------------- #


def test_reports_carry_the_probe_for_each_candidate() -> None:
    with Session(engine) as session:
        _seed(session, ["alpha_news", "helper_bot"])
        record_probe_result(session, "alpha_news", OK_PAGE)
        record_probe_result(session, "helper_bot", BOT_PAGE)

        report = create_report(
            session,
            channel_names=["carrier"],
            start_date=None,
            end_date=None,
            signals=None,
            filters=PostFilters(),
            max_per_channel=0,
        )
        by_name = {c["name"]: c for c in report["candidates"]}
        assert by_name["alpha_news"]["probe"]["status"] == "ok"
        assert by_name["helper_bot"]["probe"]["kind"] == "bot"


def test_an_unprobed_candidate_has_no_probe_rather_than_a_verdict() -> None:
    """ "Not checked yet" and "confirmed unfollowable" must not look the same."""
    with Session(engine) as session:
        _seed(session, ["alpha_news"])
        report = create_report(
            session,
            channel_names=["carrier"],
            start_date=None,
            end_date=None,
            signals=None,
            filters=PostFilters(),
            max_per_channel=0,
        )
        assert report["candidates"][0]["probe"] is None


def test_probing_applies_to_reports_generated_before_it() -> None:
    """Like isFollowed/isIgnored, a probe is live state, not frozen history."""
    with Session(engine) as session:
        _seed(session, ["helper_bot"])
        report = create_report(
            session,
            channel_names=["carrier"],
            start_date=None,
            end_date=None,
            signals=None,
            filters=PostFilters(),
            max_per_channel=0,
        )
        assert report["candidates"][0]["probe"] is None

        record_probe_result(session, "helper_bot", BOT_PAGE)

        refetched = get_report(session, report["id"])
        assert refetched["candidates"][0]["probe"]["status"] == "unavailable"


def test_probes_are_independent_of_dismissals() -> None:
    """Separate stores: an automated verdict must not read as a chosen one."""
    with Session(engine) as session:
        _seed(session, ["helper_bot"])
        record_probe_result(session, "helper_bot", BOT_PAGE)

        report = create_report(
            session,
            channel_names=["carrier"],
            start_date=None,
            end_date=None,
            signals=None,
            filters=PostFilters(),
            max_per_channel=0,
        )
        candidate = report["candidates"][0]
        assert candidate["probe"]["status"] == "unavailable"
        assert candidate["isIgnored"] is False


def test_list_probes_filters_by_status() -> None:
    with Session(engine) as session:
        record_probe_result(session, "alpha_news", OK_PAGE)
        record_probe_result(session, "helper_bot", BOT_PAGE)
        unavailable = list_probes(session, status="unavailable")
        assert [row["handle"] for row in unavailable] == ["helper_bot"]
        assert len(list_probes(session)) == 2


def test_probe_map_is_scoped_to_the_handles_asked_about() -> None:
    with Session(engine) as session:
        record_probe_result(session, "alpha_news", OK_PAGE)
        record_probe_result(session, "helper_bot", BOT_PAGE)
        assert set(probe_map(session, {"alpha_news"})) == {"alpha_news"}
        assert probe_map(session, set()) == {}


def test_probe_rows_survive_being_written_twice() -> None:
    """Re-probing updates in place rather than colliding on the primary key."""
    with Session(engine) as session:
        record_probe_result(session, "alpha_news", OK_PAGE)
        record_probe_result(session, "alpha_news", BOT_PAGE)
        rows = session.exec(select(DiscoverHandleProbe)).all()
        assert len(rows) == 1
        assert rows[0].status == "unavailable"
