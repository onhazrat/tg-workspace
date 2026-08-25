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
    DEFAULT_PROBE_PRIORITY,
    dequeue_handles,
    enqueue_handles,
    handles_needing_probe,
    list_probes,
    probe_map,
    queue_counts,
    record_probe_result,
    requeue_probes,
)
from app.services.discover_reports import create_report, get_report
from app.services.post_filters import PostFilters
from tests.utils.tenancy import ANY_READER

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

        assert requeue_probes(session, ["@Alpha_News"]) == ["alpha_news"]
        assert handles_needing_probe(session, ["alpha_news"]) == ["alpha_news"]


def test_recheck_leaves_the_handle_in_the_queue() -> None:
    """The trap in moving to a queue: forgetting is not the same as requeuing.

    Recheck used to *delete* the row. Now that a row is both the cached answer
    and the work item, deleting one would take the handle out of the queue
    entirely and nothing would ever fetch it again — the recheck would look like
    it worked and then silently never resolve.
    """
    with Session(engine) as session:
        record_probe_result(session, "alpha_news", BOT_PAGE)
        requeue_probes(session, ["alpha_news"])
        assert dequeue_handles(session, limit=10) == ["alpha_news"]


def test_recheck_jumps_the_queue() -> None:
    """The operator is looking at that row; it must not wait behind a report."""
    with Session(engine) as session:
        enqueue_handles(session, [f"bulk_{i}" for i in range(5)])
        record_probe_result(session, "alpha_news", BOT_PAGE)
        requeue_probes(session, ["alpha_news"])
        assert dequeue_handles(session, limit=1) == ["alpha_news"]


def test_recheck_of_an_unprobed_handle_queues_it() -> None:
    """Recheck is offered on rows whose verdict has not arrived yet."""
    with Session(engine) as session:
        assert requeue_probes(session, ["never_seen"]) == ["never_seen"]
        assert dequeue_handles(session, limit=10) == ["never_seen"]


def test_recheck_can_overturn_a_verdict() -> None:
    with Session(engine) as session:
        record_probe_result(session, "alpha_news", BOT_PAGE)
        requeue_probes(session, ["alpha_news"])
        result = record_probe_result(session, "alpha_news", OK_PAGE)
        assert result["status"] == "ok"


def test_recheck_clears_the_stale_metadata_too() -> None:
    """A cleared verdict must not leave the old display name behind."""
    with Session(engine) as session:
        record_probe_result(session, "alpha_news", OK_PAGE)
        requeue_probes(session, ["alpha_news"])
        row = session.get(DiscoverHandleProbe, "alpha_news")
        assert row is not None
        assert row.status == "unknown"
        assert row.display_name is None
        assert row.subscribers is None
        assert row.checked_at is None
        # And the read-time join drops it, so the row goes back to reading as
        # "not checked yet" rather than as a fresh inconclusive verdict.
        assert probe_map(session, {"alpha_news"}) == {}


# --------------------------------------------------------------------------- #
# The queue                                                                     #
# --------------------------------------------------------------------------- #


def test_enqueue_records_rank_as_drain_order() -> None:
    with Session(engine) as session:
        assert enqueue_handles(session, ["top", "middle", "tail"]) == 3
        assert dequeue_handles(session, limit=10) == ["top", "middle", "tail"]


def test_enqueue_normalizes_and_dedupes() -> None:
    with Session(engine) as session:
        assert enqueue_handles(session, ["@Alpha", "alpha", "", "  "]) == 1
        assert dequeue_handles(session, limit=10) == ["alpha"]


def test_enqueue_skips_handles_that_already_have_a_verdict() -> None:
    """Re-generating a report over the same channels must cost nothing."""
    with Session(engine) as session:
        record_probe_result(session, "alpha_news", OK_PAGE)
        record_probe_result(session, "helper_bot", BOT_PAGE)
        assert enqueue_handles(session, ["alpha_news", "helper_bot", "fresh"]) == 1
        assert dequeue_handles(session, limit=10) == ["fresh"]


def _priority(session: Session, handle: str) -> int:
    row = session.get(DiscoverHandleProbe, handle)
    assert row is not None
    return row.priority


def test_a_better_rank_in_a_later_report_wins() -> None:
    """Being near the top of *any* report is enough to be probed early."""
    with Session(engine) as session:
        enqueue_handles(session, ["a", "b", "c", "promoted"])
        assert _priority(session, "promoted") == 3
        enqueue_handles(session, ["promoted"])
        assert _priority(session, "promoted") == 0


def test_a_worse_rank_in_a_later_report_does_not_demote() -> None:
    with Session(engine) as session:
        enqueue_handles(session, ["important"])
        enqueue_handles(session, ["a", "b", "important"])
        assert _priority(session, "important") == 0


def test_dequeue_respects_the_batch_bound() -> None:
    with Session(engine) as session:
        enqueue_handles(session, [f"h{i}" for i in range(10)])
        assert len(dequeue_handles(session, limit=3)) == 3
        assert dequeue_handles(session, limit=0) == []


def test_dequeue_skips_a_handle_inside_its_backoff() -> None:
    with Session(engine) as session:
        enqueue_handles(session, ["flaky"])
        record_probe_result(session, "flaky", None, error="timeout")
        assert dequeue_handles(session, limit=10) == []
        later = utc_now() + timedelta(days=2)
        assert dequeue_handles(session, limit=10, now=later) == ["flaky"]


def test_dequeue_is_empty_once_everything_is_resolved() -> None:
    with Session(engine) as session:
        enqueue_handles(session, ["alpha_news"])
        record_probe_result(session, "alpha_news", OK_PAGE)
        assert dequeue_handles(session, limit=10) == []


def test_rows_predating_the_queue_still_drain_last() -> None:
    """Migrated rows carry the sentinel priority, not rank 0."""
    with Session(engine) as session:
        session.add(DiscoverHandleProbe(handle="legacy", status="unknown"))
        session.commit()
        enqueue_handles(session, ["ranked"])
        assert dequeue_handles(session, limit=10) == ["ranked", "legacy"]
        legacy = session.get(DiscoverHandleProbe, "legacy")
        assert legacy is not None
        assert legacy.priority == DEFAULT_PROBE_PRIORITY


def test_queue_counts_separate_pending_from_failing() -> None:
    """A failing handle retries forever, so it must not hold a progress bar open."""
    with Session(engine) as session:
        enqueue_handles(session, ["waiting", "flaky"])
        record_probe_result(session, "flaky", None, error="timeout")
        record_probe_result(session, "alpha_news", OK_PAGE)
        record_probe_result(session, "helper_bot", BOT_PAGE)

        assert queue_counts(session) == {
            "queued": 1,
            "retrying": 1,
            "resolved": 1,
            "unavailable": 1,
        }


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
            user_id=ANY_READER,
        )
        by_name = {c["name"]: c for c in report["candidates"]}
        assert by_name["alpha_news"]["probe"]["status"] == "ok"
        assert by_name["helper_bot"]["probe"]["kind"] == "bot"


def test_a_queued_candidate_still_reads_as_not_checked() -> None:
    """A queue entry is not an answer.

    Generating a report enqueues every candidate, which creates a probe row for
    each one straight away — the table is the queue. A candidate waiting its turn
    must keep reading as "not checked yet", not as an inconclusive result, or the
    UI would show a verdict for something nothing has looked at.
    """
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
            user_id=ANY_READER,
        )
        assert report["candidates"][0]["probe"] is None
        # The row exists, and is queued.
        assert dequeue_handles(session, limit=10) == ["alpha_news"]


def test_generating_a_report_queues_its_candidates() -> None:
    with Session(engine) as session:
        _seed(session, ["alpha_news", "helper_bot"])
        create_report(
            session,
            channel_names=["carrier"],
            start_date=None,
            end_date=None,
            signals=None,
            filters=PostFilters(),
            max_per_channel=0,
            user_id=ANY_READER,
        )
        assert set(dequeue_handles(session, limit=10)) == {"alpha_news", "helper_bot"}


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
            user_id=ANY_READER,
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
            user_id=ANY_READER,
        )
        assert report["candidates"][0]["probe"] is None

        record_probe_result(session, "helper_bot", BOT_PAGE)

        refetched = get_report(session, report["id"], user_id=ANY_READER)
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
            user_id=ANY_READER,
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


def test_list_probes_is_paged() -> None:
    """This cache is never pruned, so the read has to be bounded."""
    with Session(engine) as session:
        enqueue_handles(session, [f"h{i:02d}" for i in range(5)])
        page = list_probes(session, limit=2)
        assert [row["handle"] for row in page] == ["h00", "h01"]
        assert [row["handle"] for row in list_probes(session, limit=2, offset=2)] == [
            "h02",
            "h03",
        ]


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
